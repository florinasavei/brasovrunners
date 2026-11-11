import { and, eq, isNull } from "drizzle-orm";
import { events } from "@/db/schema/events";
import { registrationReconfirmations } from "@/db/schema/registration-reconfirmations";
import { registrations } from "@/db/schema/registrations";
import type { Database } from "@/db/types";
import { TOKEN_NOT_FOUND, type TokenRejection } from "@/modules/action-tokens/domain/token-state";
import { readActionTokenContext } from "@/modules/action-tokens/repository";
import { tokenAttemptAllowed } from "@/modules/action-tokens/throttle";
import { recordAuditEvent } from "@/modules/audit/repository";
import { isReconfirmStatus } from "@/modules/notifications/domain/cannot-come";
import { DomainError } from "@/shared/errors/domain-error";
import { managedRegistration } from "./manage-family";
import { findRegistrationById } from "./repository";

/**
 * «Da, vin la cursă» — the answer to «Cere reconfirmarea» (the decision «Cere reconfirmarea»; the owner's «…dar e
 * opțional», as the decision reads it: the club sees who pressed «Vin», and answering is optional).
 *
 * An organizer's message whose send ticked «Cere reconfirmarea» carries «Vin» beside «Nu mai pot ajunge», on the same
 * manage link (`#reconfirm`). The page's GET draws the question and writes nothing (BR-REQ-036-02 criterion 4); the
 * POST lands here — pressed by the button or, when the page opened at `#reconfirm`, by the page itself once
 * (`ui/ReconfirmOnArrival.tsx`: one press counts). The shape of `results-consent.ts`:
 *
 * 1. the attempt throttled per presented token (`tokenAttemptAllowed`);
 * 2. the `MANAGE_REGISTRATION` token **read, never spent** — the same page must still be able to cancel — through
 *    `readActionTokenContext`, the reader «Schimbă adresa» binds to the registration's current participant: a link
 *    sent to an address the registration has since left is answered as a missing token, and nothing is recorded;
 * 3. the person the press names checked against the link (`managedRegistration`, §547): the link's own registration,
 *    or another of the same address at the same event — a stranger's id is refused;
 * 4. one transaction: the registration locked and checked to be still on the address the token was read for (a
 *    «Schimbă adresa» that committed after the read is answered as a missing registration, nothing written), its state
 *    and its event checked, then every open ask of it answered — the answer is about the event, not about one email.
 *
 * **What it changes: nothing about the registration.** No state, place, hold, deadline, allocator or capacity term
 * reads `registration_reconfirmations`; only the backoffice and the person's own manage page do. A second press writes nothing and makes no audit row —
 * the first moment is kept, «set, not flip», because the club may already have acted on the first answer.
 *
 * **Which states answer.** Confirmed, owed the declaration, waiting (`RECONFIRM_STATUSES`), of an event still scheduled
 * and ahead. A waiting-list offer is pointed at its own email; a cancelled or expired registration, or an event started
 * or cancelled, is refused with nothing written.
 */

/** The refusal of an answer the registration or its event no longer takes. */
export const RECONFIRM_NOT_TAKEN = "reconfirm";

export type ReconfirmOutcome = { ok: true; changed: boolean; reconfirmedAt: Date | null };

/** Record the answer for one registration: every open ask answered once, audited only when one was. */
export async function recordReconfirmation<T extends Record<string, unknown>>(
  db: Database<T>,
  input: { registrationId: string; participantId: string; now: Date },
): Promise<{ changed: boolean; answered: number }> {
  return db.transaction(async (tx) => {
    const [current] = await tx.select().from(registrations).where(eq(registrations.id, input.registrationId)).for("update");
    // A «Schimbă adresa» that committed between the token's read and this lock: the link is no longer this registration's.
    if (!current || current.participantId !== input.participantId) throw new DomainError("NOT_FOUND", "no such registration on this address");
    const [event] = await tx
      .select({ startsAt: events.startsAt, eventStatus: events.eventStatus })
      .from(events)
      .where(eq(events.id, current.eventId))
      .limit(1);
    if (!isReconfirmStatus(current.status) || !event || event.eventStatus !== "SCHEDULED" || event.startsAt.getTime() <= input.now.getTime()) {
      throw new DomainError("VALIDATION_ERROR", "this registration no longer answers whether it comes", [RECONFIRM_NOT_TAKEN]);
    }
    const answered = await tx
      .update(registrationReconfirmations)
      .set({ reconfirmedAt: input.now })
      .where(and(eq(registrationReconfirmations.registrationId, current.id), isNull(registrationReconfirmations.reconfirmedAt)))
      .returning({ id: registrationReconfirmations.id });
    if (answered.length === 0) return { changed: false, answered: 0 };
    // The participant's own act: no staff actor, the door and how many asks it answered — never a name (§12.12).
    await recordAuditEvent(tx, {
      actorStaffUserId: null,
      participantId: current.participantId,
      action: "registration.reconfirmed",
      entityType: "registration",
      entityId: current.id,
      metadata: { via: "MANAGE_LINK", sends: answered.length },
      now: input.now,
    });
    return { changed: true, answered: answered.length };
  });
}

/**
 * From the registration's own manage page. Per person (§547): `registrationId` names another registration of the
 * same address at the same event; a stranger's id, or one at another event, gets NOT_FOUND. A registration nobody asked
 * is refused as one that no longer answers: there is no question to answer.
 */
export async function reconfirmFromManageLink<T extends Record<string, unknown>>(
  db: Database<T>,
  secret: string,
  now: Date,
  registrationId?: string,
): Promise<{ ok: true; changed: boolean } | TokenRejection> {
  if (!(await tokenAttemptAllowed(db, secret, now))) return TOKEN_NOT_FOUND;
  const context = await readActionTokenContext(db, { secret, purpose: "MANAGE_REGISTRATION", now });
  if (!context.ok) return context;
  if (!context.token.registrationId) return TOKEN_NOT_FOUND;

  const own = await findRegistrationById(db, context.token.registrationId);
  const target = own ? await managedRegistration(db, own, registrationId) : null;
  if (!target) throw new DomainError("NOT_FOUND", "not a registration this link manages");
  const [asked] = await db
    .select({ id: registrationReconfirmations.id })
    .from(registrationReconfirmations)
    .where(eq(registrationReconfirmations.registrationId, target.id))
    .limit(1);
  if (!asked) throw new DomainError("VALIDATION_ERROR", "nobody asked this registration whether it comes", [RECONFIRM_NOT_TAKEN]);

  const result = await recordReconfirmation(db, { registrationId: target.id, participantId: context.token.participantId, now });
  return { ok: true as const, changed: result.changed };
}
