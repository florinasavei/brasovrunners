import { eq } from "drizzle-orm";
import { events } from "@/db/schema/events";
import { participants } from "@/db/schema/participants";
import { registrations } from "@/db/schema/registrations";
import type { StaffUser } from "@/db/schema/staff-users";
import type { Database } from "@/db/types";
import { recordAuditEvent } from "@/modules/audit/repository";
import { findCurrentApprovedDocument, findFirstResultsNameAskNoticeVersion } from "@/modules/legal-documents/repository";
import { enqueueEmail } from "@/modules/notifications/outbox";
import { revalidatePublicContent } from "@/modules/public-cache/cache";
import { holdsResultsNameConsent, resultsNameConsentOffered } from "@/modules/results/domain/name-consent";
import { canRecordListWishAtDesk } from "@/modules/staff-identity/domain/roles";
import { DomainError } from "@/shared/errors/domain-error";
import { isUuid } from "@/shared/ids";
import { isNameHiddenByClub } from "./admin-repository";
import { isTerminalStatus } from "./domain/state-machine";
import { consentWord, listChoiceColumns } from "./list-consent";
import { readResultsNameConsentLine } from "./results-consent";

/**
 * «Anonim» → «Cu nume» at the race-day desk (§NNN, amending §143, §910, §1004 and BR-REQ-072-01 criterion 7): the runner standing at
 * the table says they want their name on the public list and in the results — or, the other way, that they no longer want it — and
 * the volunteer records it with the row's eye. The owner, 2026-11-20: «dacă cineva are semnul ăsta de „Anonim” trebuie să îl pot
 * schimba în „Cu nume” la click, dar cu acordul lor».
 *
 * **The person's own wish, recorded as theirs.** Nothing here is a staff decision: the eye asks first, naming the person and what
 * follows (`DeskRow.tsx`), and the write is the one the person's own doors make (`list-consent.ts#listChoiceColumns`) — never a
 * staff mark that shows a name. Who wrote it down is in the trail, and the person holds the way back:
 *
 * - **One transaction, the row locked**, so two presses at once write one change. "Set", not "flip": the form carries the wish it
 *   records, and a press that finds it already so writes nothing, emails nobody and records no row.
 * - **The results' name too, where the person's own page would ask it** (§879): showing, on a registration made under a privacy
 *   notice older than the first that described the results, while that question is put at all (`resultsNameConsentOffered` over
 *   `readResultsNameConsentLine`: the notice in force names `{{resultsNameAsk}}` and `{{results}}`, the event is a race), the yes
 *   `setResultsNameConsent` records — `results_name_consent`, `results_consent_version` the notice in force in the registration's
 *   language — unless it already holds one that counts (`holdsResultsNameConsent`). Asked of the same gate at every press; a gate
 *   that is shut sets nothing and refuses nothing — the list's wish is recorded alone. Hiding withdraws nothing of it: the results
 *   name a runner only while the list's tick is on (§808), as the person's own doors leave it.
 * - **One audit row**, `registration.list_consent_changed`, the action the person's doors write: `{ from, to, via: "DESK" }` and,
 *   where the results' yes was recorded with it, `resultsNameConsent: true` and the notice's version — never the name — and the
 *   staff member who recorded it as the actor (`actorStaffUserId`), where the person's own doors have none.
 * - **The person told at once, showing only** (`LIST_CONSENT_RECORDED`): one email to the registration's address, in its language,
 *   in the same transaction — «La masa de ridicare a numerelor ai cerut să apari cu numele… Dacă nu e așa, apasă aici» — carrying a
 *   `LIST_CONSENT` link minted at the send, the confirmation's own one-tap switch (`/registrations/list/[token]`). So the club holds
 *   the record and the person holds the undo. Hiding emails nobody: taking a name off needs no proof.
 * - **The club's hide stands** (§910, §948): a name an Administrator hid with «Apare pe site» unticked stays hidden — the press
 *   changes the person's own wish and nothing else, and says so (`hiddenByClub`, read as the desk reads it,
 *   `admin-repository.ts#isNameHiddenByClub`: one fact, never the mark it comes from).
 *
 * **Refused, nothing written:** a role below the desk (`canRecordListWishAtDesk`, asserted here as the action does — BR-REQ-060-01);
 * an unknown or malformed id; a registration that is over (`LIST_WISH_OVER`); one whose address was never confirmed
 * (`LIST_WISH_ADDRESS_UNCONFIRMED` — the email would be the one message this platform sends to an address nobody vouched for besides
 * the confirmation itself; «Confirmă pe hârtie» vouches for it first); an event completed or cancelled, whose desk is closed
 * (`LIST_WISH_DESK_CLOSED`, as a check-in is refused there).
 */

/** What the press did: the wish as it now stands, whether it changed, and what came with it. */
export type DeskListWishOutcome = {
  listed: boolean;
  changed: boolean;
  /** The results' name recorded with it (§879): only showing, under an older notice, while the question is put. */
  resultsConsent: boolean;
  /** The person's email queued (`LIST_CONSENT_RECORDED`): only showing, only when something changed. */
  emailed: boolean;
  /** An Administrator's «Apare pe site» unticked (§910, §948): the name stays hidden whatever the wish. */
  hiddenByClub: boolean;
};

/** The registration's own key for the email: one per recorded wish, so a retried request queues nothing twice. */
export function listConsentRecordedKey(registrationId: string, auditId: string): string {
  return `registration:${registrationId}:list-consent-recorded:${auditId}`;
}

export async function recordListWishAtDesk<T extends Record<string, unknown>>(
  db: Database<T>,
  actor: Pick<StaffUser, "id" | "role">,
  registrationId: string,
  listed: boolean,
  now: Date,
): Promise<DeskListWishOutcome> {
  if (!canRecordListWishAtDesk(actor.role)) throw new DomainError("FORBIDDEN", `role ${actor.role} may not record a wish at the desk`);
  if (!isUuid(registrationId)) throw new DomainError("NOT_FOUND", "no such registration");

  const outcome = await db.transaction(async (tx) => {
    const [current] = await tx.select().from(registrations).where(eq(registrations.id, registrationId)).for("update");
    if (!current) throw new DomainError("NOT_FOUND", "no such registration");
    if (isTerminalStatus(current.status)) throw new DomainError("LIST_WISH_OVER", `the registration is ${current.status}; the desk records no wish on it`);
    if (current.status === "PENDING_EMAIL_CONFIRMATION") {
      throw new DomainError("LIST_WISH_ADDRESS_UNCONFIRMED", "the address was never confirmed; confirm the registration first");
    }
    const [event] = await tx.select({ eventStatus: events.eventStatus }).from(events).where(eq(events.id, current.eventId)).limit(1);
    if (event?.eventStatus === "COMPLETED" || event?.eventStatus === "CANCELLED") {
      throw new DomainError("LIST_WISH_DESK_CLOSED", `the event is ${event.eventStatus}; the desk is closed`);
    }

    const hiddenByClub = await isNameHiddenByClub(tx, current.id);
    const wasListed = !current.listOptOut;
    if (wasListed === listed) return { listed, changed: false, resultsConsent: false, emailed: false, hiddenByClub };

    // The results' name, where the person's own page would put the question (§879) — read at every press, never remembered.
    let resultsVersion: number | null = null;
    if (listed) {
      const line = await readResultsNameConsentLine(tx, current.eventId, now);
      if (resultsNameConsentOffered(current.privacyNoticeVersion, line)) {
        const askLine = await findFirstResultsNameAskNoticeVersion(tx);
        const notice = askLine === null ? undefined : await findCurrentApprovedDocument(tx, "PRIVACY_NOTICE", current.locale, now);
        // A yes counts only under a notice at or above the first that named the tick (`holdsResultsNameConsent`): never one that counts for nothing.
        if (!holdsResultsNameConsent(current, askLine) && notice && askLine !== null && notice.version >= askLine) resultsVersion = notice.version;
      }
    }

    await tx
      .update(registrations)
      .set({ ...listChoiceColumns(listed, now), ...(resultsVersion === null ? {} : { resultsNameConsent: true, resultsConsentVersion: resultsVersion }) })
      .where(eq(registrations.id, current.id));

    // One row: the shape and the door, the staff member who wrote it down as the actor — never the name (AGENTS.md §12.12).
    const auditId = await recordAuditEvent(tx, {
      actorStaffUserId: actor.id,
      participantId: current.participantId,
      action: "registration.list_consent_changed",
      entityType: "registration",
      entityId: current.id,
      metadata: {
        from: consentWord(wasListed),
        to: consentWord(listed),
        via: "DESK",
        ...(resultsVersion === null ? {} : { resultsNameConsent: true, noticeVersion: resultsVersion }),
      },
      now,
    });

    // The person told at once, showing only: the record is the club's, the way back is theirs (`LIST_CONSENT_RECORDED`).
    let emailed = false;
    if (listed) {
      const [owner] = await tx.select({ deliveryEmail: participants.deliveryEmail }).from(participants).where(eq(participants.id, current.participantId)).limit(1);
      if (owner) {
        const row = await enqueueEmail(tx, {
          participantId: current.participantId,
          registrationId: current.id,
          messageType: "LIST_CONSENT_RECORDED",
          locale: current.locale,
          recipientEmail: owner.deliveryEmail,
          payload: {},
          idempotencyKey: listConsentRecordedKey(current.id, auditId),
          requestedByStaffUserId: actor.id,
          now,
        });
        emailed = row !== null;
      }
    }
    return { listed, changed: true, resultsConsent: resultsVersion !== null, emailed, hiddenByClub };
  });

  // Off the public list and the results (or on them) for the next visitor, after the commit (§333).
  if (outcome.changed) revalidatePublicContent("places");
  return outcome;
}
