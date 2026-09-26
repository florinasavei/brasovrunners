import { eq } from "drizzle-orm";
import { events } from "@/db/schema/events";
import type { Registration } from "@/db/schema/registrations";
import type { Database } from "@/db/types";
import { inReadOnlyTransaction } from "@/db/read-only";
import type { Locale } from "@/i18n/routing";
import { consumeActionToken, readActionTokenContext } from "@/modules/action-tokens/repository";
import { tokenAttemptAllowed } from "@/modules/action-tokens/throttle";
import { findEventNotificationDetails } from "@/modules/events/repository";
import { findParticipantById } from "@/modules/participants/repository";
import { DomainError } from "@/shared/errors/domain-error";
import { readAddressCap } from "./address-cap";
import { ANOTHER_LINK_INVALID } from "./domain/family";
import { birthDateText, deleteFamilyEntry, findFamilyEntryByToken, personOfEntry, registeredOnAddress } from "./family-entries";
import { familyRegistrationOpen } from "./family-gate";
import { publicFormEvent } from "./public-form-event";
import { confirmEmail, submitRegistration } from "./service";

/**
 * Another person on a registered address, confirmed from the inbox (§446, amending §389; the
 * owner, 2026-09-26: "în mail să îți afișez înscrierile și să zic «confirm că înscriu altă
 * persoană»").
 *
 * The public form, sent again from an address registered at the event with a *different person*
 * (`domain/family.ts`), kept the posted form (`family-entries.ts`) and emailed the address one
 * button. The button opens a page that shows what will happen and asks one press:
 *
 * - `readFamilyEntryLink` is the page's GET — the token read, charged one attempt (§39), never
 *   spent, all in one read-only transaction (GET never mutates, §12.8);
 * - `confirmFamilyEntry` is the press — the token spent, the registration created from the kept
 *   fields through `submitRegistration` (the ordinary door, under the event's lock and the club's
 *   limit per address), the address confirmed (`confirmEmail`: the press proved the inbox), so the
 *   new registration goes straight to its place and its own declaration email, or to the waiting
 *   list — and the entry deleted. One transaction: a refusal (this person is on the address
 *   already, the address is at its limit, the waiting list is full, the terms changed) takes the
 *   token's spend back with everything else, and the same link still works.
 *
 * Both take the database, so the concurrency suite can press several links at once against a real
 * server (`tests/concurrency/family.test.ts`); `token-actions.ts` hands them the application's.
 */

export type FamilyEntryLink =
  | {
      ok: true;
      /** The address the email went to: the new registration's too. */
      email: string;
      /** The event in the page's language when it has one, else the other's. */
      eventTitle: string | null;
      /** Who the address holds at the event now, as "Ana P." (`registeredOnAddress`). */
      registered: string[];
      /** The person the form named, in full, and the birth date as "12.03.2012". */
      personName: string;
      personBirthDate: string;
      /** An adult is asked the address holder's acknowledgement on the page (§421). */
      adult: boolean;
      /** The club's limit per address now, for the sentence that states it. */
      registrationsPerAddress: number;
    }
  | { ok: false };

export async function readFamilyEntryLink<T extends Record<string, unknown>>(
  db: Database<T>,
  secret: string,
  locale: Locale,
  now: Date,
): Promise<FamilyEntryLink> {
  if (!(await tokenAttemptAllowed(db, secret, now))) return { ok: false };
  const context = await readActionTokenContext(db, { secret, purpose: "REGISTER_ANOTHER_PERSON", now });
  if (!context.ok) return { ok: false };
  return inReadOnlyTransaction(db, async (tx) => {
    const entry = await findFamilyEntryByToken(tx, context.token.id);
    if (!entry || entry.expiresAt.getTime() <= now.getTime()) return { ok: false as const };
    // The flow is the schema's (`family-gate.ts`): while one address holds one registration, nothing here can be honoured.
    if (!(await familyRegistrationOpen(tx))) return { ok: false as const };
    const participant = await findParticipantById(tx, entry.participantId);
    if (!participant) return { ok: false as const };
    const details = await findEventNotificationDetails(tx, entry.eventId, locale);
    const person = personOfEntry(entry);
    return {
      ok: true as const,
      email: participant.deliveryEmail,
      eventTitle: details?.title ?? null,
      registered: await registeredOnAddress(tx, entry.eventId, entry.participantId),
      personName: person.legalName,
      personBirthDate: birthDateText(person.birthDate),
      adult: person.adult(now),
      registrationsPerAddress: (await readAddressCap(tx)).cap.registrationsPerAddress,
    };
  });
}

export type FamilyConfirmation = { ok: true; registration: Registration; email: string } | { ok: false };

export async function confirmFamilyEntry<T extends Record<string, unknown>>(
  db: Database<T>,
  secret: string,
  input: {
    /** The address holder's tick for an adult (§421): the person declares their own fitness when they sign. */
    fitnessAcknowledged: boolean;
  },
  now: Date,
): Promise<FamilyConfirmation> {
  if (!(await tokenAttemptAllowed(db, secret, now))) return { ok: false };

  return db.transaction(async (tx) => {
    const consumed = await consumeActionToken(tx, { secret, purpose: "REGISTER_ANOTHER_PERSON", now });
    if (!consumed.ok) return { ok: false as const };
    /*
      The entry this token was minted for. None — a link from an email sent before §446, which opened
      the form, or an entry the job has purged — and the link is simply one that no longer works:
      the spend stands, as it would for any link used once.
    */
    const entry = await findFamilyEntryByToken(tx, consumed.token.id);
    if (!entry || entry.expiresAt.getTime() <= now.getTime()) return { ok: false as const };

    const [row] = await tx.select().from(events).where(eq(events.id, entry.eventId)).limit(1);
    if (!row) throw new DomainError("VALIDATION_ERROR", "the event of this link is gone", [ANOTHER_LINK_INVALID]);
    const participant = await findParticipantById(tx, entry.participantId);
    if (!participant) throw new DomainError("VALIDATION_ERROR", "no such participant", [ANOTHER_LINK_INVALID]);
    // The whole row the allocator needs, the participation window included (§104, §420), as the form passes it.
    const event = publicFormEvent(row, row.publishedAt);

    const created = await submitRegistration(
      tx,
      event,
      // The address is the token's participant's, never one kept or posted (§389).
      { ...entry.fields, email: participant.deliveryEmail, fitnessAcknowledged: input.fitnessAcknowledged },
      now,
      "REAL",
      { source: "PUBLIC", createdByStaffUserId: null, anotherPerson: { participantId: participant.id } },
    );
    if (!created.registrationId) {
      // Every path behind the link creates or restarts a row, or refuses; nothing else is an answer.
      throw new DomainError("CONFLICT", "the confirmation created no registration");
    }
    /*
      The press proved the inbox: the address is confirmed here, as its own link would have done,
      and the allocator gives the new registration its place — the declaration to sign — or its
      place on the waiting list (`confirmEmail`, the same function, under the same lock).
    */
    const registration = await confirmEmail(tx, event, created.registrationId, now);
    await deleteFamilyEntry(tx, entry.id);
    return { ok: true as const, registration, email: participant.deliveryEmail };
  });
}
