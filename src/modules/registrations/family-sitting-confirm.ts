import { eq } from "drizzle-orm";
import { events } from "@/db/schema/events";
import { familySittings } from "@/db/schema/family-entries";
import type { Registration } from "@/db/schema/registrations";
import type { Database } from "@/db/types";
import { inReadOnlyTransaction } from "@/db/read-only";
import type { Locale } from "@/i18n/routing";
import { consumeActionToken, readActionTokenContext } from "@/modules/action-tokens/repository";
import { tokenAttemptAllowed } from "@/modules/action-tokens/throttle";
import { recordAuditEvent } from "@/modules/audit/repository";
import { findEventNotificationDetails } from "@/modules/events/repository";
import { findParticipantById } from "@/modules/participants/repository";
import { DomainError, isDomainError } from "@/shared/errors/domain-error";
import { readAddressCap } from "./address-cap";
import { ADDRESS_AT_CAP, ALREADY_ON_ADDRESS } from "./domain/family";
import { FAMILY_PASS_MINUTES } from "./domain/family-signing";
import { waitlistRefusalOf } from "./domain/waitlist";
import { adultOnTheFamilyForm } from "./fields";
import { deleteFamilyEntry, personOfEntry, registeredOnAddress } from "./family-entries";
import { familyRegistrationOpen } from "./family-gate";
import { findSittingByToken, sittingPeople, sittingStillOpen } from "./family-sitting";
import { publicFormEvent } from "./public-form-event";
import { confirmEmail, submitRegistration } from "./service";

/**
 * A family's one button (§NNN): the page the family message opens, and its press.
 *
 * The message — «Înscriere de familie: 3 persoane la …» — names everybody a sitting sent the form
 * for (`family-sitting.ts`): its new registrations, waiting for the address's confirmation, and its
 * kept forms, waiting for the address's say-so (§446). One token, single use, hashed at rest and
 * minted at send time (§12.8), scoped to the registration the sitting's link names.
 *
 * - `readFamilySittingLink` is the page's GET: the token read and the people listed, in a read-only
 *   transaction (GET never mutates). The page asks one throttled attempt per view in all — its own
 *   read of the single-person link (§446) and this one share it.
 * - `confirmFamilySitting` is the press: the token spent; the address confirmed, the sitting's
 *   registrations given their places (`confirmEmail`); each kept form ticked on the page registered
 *   and given its place (`submitRegistration` behind the link, then `confirmEmail`) — each in a
 *   savepoint of its own, so one refused person (the club's limit, the waiting list full, the terms
 *   changed since) is named and the others still join; a kept form unticked is deleted, as
 *   «Nu înscriu această persoană» deletes one (§468). The declaration requests wait the wizard's
 *   half hour (`FAMILY_PASS_MINUTES`) and go only to whoever is still unsigned then.
 *
 * Only the adult's acknowledgement refuses the whole press (§421): nothing is written, the token is
 * not spent, and the page says what to tick.
 */

export type FamilySittingPerson = {
  /** `r:<id>` for a registration of the sitting, `e:<id>` for a kept form: what the page posts back. */
  key: string;
  name: string;
  /** "YYYY-MM-DD", or "" when the row has none. */
  birthDate: string;
  /** A kept form of an adult: the address's holder acknowledges they will declare their own fitness (§421). */
  adultEntry: boolean;
  /** A kept form the page may leave unticked; a registration of the sitting is always confirmed. */
  optional: boolean;
};

export type FamilySittingLink =
  | {
      ok: true;
      email: string;
      eventTitle: string | null;
      people: FamilySittingPerson[];
      /** Who the address held at the event before the sitting, as "Ana P." (`registeredOnAddress`). */
      registered: string[];
      registrationsPerAddress: number;
    }
  | { ok: false };

export async function readFamilySittingLink<T extends Record<string, unknown>>(
  db: Database<T>,
  secret: string,
  locale: Locale,
  now: Date,
  options: { charge: boolean } = { charge: true },
): Promise<FamilySittingLink> {
  if (options.charge && !(await tokenAttemptAllowed(db, secret, now))) return { ok: false };
  const context = await readActionTokenContext(db, { secret, purpose: "REGISTER_ANOTHER_PERSON", now });
  if (!context.ok) return { ok: false };
  return inReadOnlyTransaction(db, async (tx) => {
    const sitting = await findSittingByToken(tx, context.token.id);
    if (!sitting || !sittingStillOpen(sitting, now)) return { ok: false as const };
    const participant = await findParticipantById(tx, sitting.participantId);
    if (!participant) return { ok: false as const };
    const people = await sittingPeople(tx, sitting, now);
    const listed = listPeople(people, now);
    if (listed.length === 0) return { ok: false as const };
    const details = await findEventNotificationDetails(tx, sitting.eventId, locale);
    return {
      ok: true as const,
      email: participant.deliveryEmail,
      eventTitle: details?.title ?? null,
      people: listed,
      registered: await registeredOnAddress(tx, sitting.eventId, sitting.participantId, sitting.registrationIds),
      registrationsPerAddress: (await readAddressCap(tx)).cap.registrationsPerAddress,
    };
  });
}

function listPeople(people: Awaited<ReturnType<typeof sittingPeople>>, now: Date): FamilySittingPerson[] {
  return [
    ...people.registrations.map((row) => ({
      key: `r:${row.id}`,
      name: row.registeredName,
      birthDate: row.birthDate ?? "",
      adultEntry: false,
      optional: false,
    })),
    ...people.entries.map((entry) => {
      const person = personOfEntry(entry);
      return {
        key: `e:${entry.id}`,
        name: person.legalName,
        birthDate: person.birthDate?.slice(0, 10) ?? "",
        adultEntry: person.adult(now),
        optional: true,
      };
    }),
  ];
}

/** Why one person of the family did not join at the press — a marker the page turns into a sentence, never a value. */
export type FamilySittingRefusal = typeof ADDRESS_AT_CAP | typeof ALREADY_ON_ADDRESS | "waitlist" | "other";

export type FamilySittingConfirmation =
  | {
      ok: true;
      participantId: string;
      eventId: string;
      registrations: Registration[];
      refused: FamilySittingRefusal[];
    }
  | { ok: false };

export async function confirmFamilySitting<T extends Record<string, unknown>>(
  db: Database<T>,
  secret: string,
  input: {
    /** The kept forms ticked on the page (`e:<id>` keys); the others are deleted, nobody registered for them. */
    includedKeys: readonly string[];
    /** The address holder's tick for the adults among them (§421). */
    fitnessAcknowledged: boolean;
  },
  now: Date,
): Promise<FamilySittingConfirmation> {
  if (!(await tokenAttemptAllowed(db, secret, now))) return { ok: false };

  return db.transaction(async (tx) => {
    const consumed = await consumeActionToken(tx, { secret, purpose: "REGISTER_ANOTHER_PERSON", now });
    if (!consumed.ok) return { ok: false as const };
    const sitting = await findSittingByToken(tx, consumed.token.id);
    if (!sitting || !sittingStillOpen(sitting, now)) return { ok: false as const };
    if (!(await familyRegistrationOpen(tx))) return { ok: false as const };

    const people = await sittingPeople(tx, sitting, now);
    const included = people.entries.filter((entry) => input.includedKeys.includes(`e:${entry.id}`));
    const left = people.entries.filter((entry) => !input.includedKeys.includes(`e:${entry.id}`));
    // The adults' own consents were never kept (§421): the holder acknowledges they give them at signing.
    if (!input.fitnessAcknowledged && included.some((entry) => adultOnTheFamilyForm(personOfEntry(entry).birthDate, now))) {
      throw new DomainError("VALIDATION_ERROR", "the address holder's acknowledgement for another adult is missing", ["fitnessAcknowledged"]);
    }

    const [row] = await tx.select().from(events).where(eq(events.id, sitting.eventId)).limit(1);
    const participant = await findParticipantById(tx, sitting.participantId);
    if (!row || !participant) return { ok: false as const };
    // The whole row the allocator needs, the participation window included (§104, §420), as the form passes it.
    const event = publicFormEvent(row, row.publishedAt);
    /*
      The wizard asks the signatures now; the emailed requests wait its half hour (§471) — and each
      place is held the club's minutes from the moment its request can leave, never from the press
      (`familyHeldDeclaration`, in `confirmEmail`): a request never arrives after its own hold.
    */
    const declarationNotBefore = new Date(now.getTime() + FAMILY_PASS_MINUTES * 60_000);

    const registrations: Registration[] = [];
    const refused: FamilySittingRefusal[] = [];
    /** One person, in a savepoint: a refusal takes back that person alone. */
    const one = async (work: (sp: typeof tx) => Promise<Registration>) => {
      try {
        const registration = await tx.transaction((sp) => work(sp as typeof tx));
        /*
          Confirmed means a place or the waiting list. A registration still waiting, or lapsed — the
          event cancelled since, or its own link's time up (`confirmEmail` answers so and writes the
          lapse) — did not join, and the page says so as it says any other refusal.
        */
        if (JOINED.includes(registration.status)) registrations.push(registration);
        else refused.push("other");
      } catch (error) {
        const marker = refusalOf(error);
        if (marker === null) throw error;
        refused.push(marker);
      }
    };

    // The sitting's own registrations first — they were registered first — then the kept forms, in the order sent.
    for (const pending of people.registrations) {
      await one((sp) => confirmEmail(sp, event, pending.id, now, { declarationNotBefore }));
    }
    for (const entry of included) {
      await one(async (sp) => {
        const created = await submitRegistration(
          sp,
          event,
          // The address is the sitting's participant's, never one kept or posted (§389).
          { ...entry.fields, email: participant.deliveryEmail, fitnessAcknowledged: input.fitnessAcknowledged },
          now,
          "REAL",
          { source: "PUBLIC", createdByStaffUserId: null, anotherPerson: { participantId: participant.id } },
        );
        if (!created.registrationId) throw new DomainError("CONFLICT", "the confirmation created no registration");
        return confirmEmail(sp, event, created.registrationId, now, { declarationNotBefore });
      });
      // Registered or refused, the kept form is spent with the token: what it held is not kept (§446).
      await deleteFamilyEntry(tx, entry.id);
    }
    for (const entry of left) {
      await deleteFamilyEntry(tx, entry.id);
      // As «Nu înscriu această persoană» (§468): who answered and where, never whom the form named.
      await recordAuditEvent(tx, {
        actorStaffUserId: null,
        participantId: entry.participantId,
        action: "event.family_entry_declined",
        entityType: "event",
        entityId: entry.eventId,
        metadata: { by: "family_sitting" },
        now,
      });
    }
    /*
      The family's order (§NNN, `compareFamilyOrder`): the sitting's own registrations, then every kept
      form's in the order the forms were sent — they share this press's `created_at`, so only this list
      orders them, for the family's confirmation, «Declarațiile de pe această adresă» and the wizard
      alike. Kept, ids only, until the day after the start, for those three to read.
    */
    const order = [...sitting.registrationIds, ...registrations.map((joined) => joined.id).filter((id) => !sitting.registrationIds.includes(id))];
    const keepUntil = new Date(Math.max(sitting.expiresAt.getTime(), row.startsAt.getTime() + 24 * 60 * 60_000));
    await tx.update(familySittings).set({ confirmedAt: now, registrationIds: order, expiresAt: keepUntil }).where(eq(familySittings.id, sitting.id));
    return { ok: true as const, participantId: participant.id, eventId: sitting.eventId, registrations, refused };
  });
}

/** The states a person of the family is in once the press gave them their place or their line. */
const JOINED: readonly Registration["status"][] = ["PENDING_DECLARATION", "WAITLISTED", "WAITLIST_OFFERED", "CONFIRMED"];

function refusalOf(error: unknown): FamilySittingRefusal | null {
  if (waitlistRefusalOf(error)) return "waitlist";
  if (!isDomainError(error)) return null;
  if (error.fields.includes(ADDRESS_AT_CAP)) return ADDRESS_AT_CAP;
  if (error.fields.includes(ALREADY_ON_ADDRESS)) return ALREADY_ON_ADDRESS;
  // The code and the fields, never a value (§14.5): the terms changed since, the age, the window closed.
  console.warn(`[family-sitting] one person refused at the press: ${error.code} ${error.fields.join(",")}`);
  return "other";
}
