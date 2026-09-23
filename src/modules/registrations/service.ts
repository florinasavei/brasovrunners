import { eq } from "drizzle-orm";
import { type Participant, participants } from "@/db/schema/participants";
import type {
  Registration,
  RegistrationKind,
  RegistrationSource,
} from "@/db/schema/registrations";
import { events } from "@/db/schema/events";
import { registrations } from "@/db/schema/registrations";
import type { Database, Transaction } from "@/db/types";
import { registrationHasClosed, registrationState } from "@/modules/events/domain/registration-window";
import { recordAuditEvent } from "@/modules/audit/repository";
import { findCurrentApprovedDocument } from "@/modules/legal-documents/repository";
import { readClubNotices } from "@/modules/notifications/club-notices";
import { confirmationNoticeRecipients, resolveDeclarationCopies } from "@/modules/notifications/domain/club-notices";
import { enqueueEmail, type OutboxRow } from "@/modules/notifications/outbox";
import { ensureProvisionalBibNumber, pickBibNumber } from "./bibs";
import { mergeFieldsIn } from "@/modules/legal-documents/domain/merge-fields";
import { newCheckinCode } from "./checkin-code";
import { canonicalizeEmail } from "@/modules/participants/domain/canonical-email";
import {
  findOrCreateParticipant,
  findParticipantByCanonicalEmail,
  markEmailVerified,
} from "@/modules/participants/repository";
import { consumeRateLimit } from "@/modules/rate-limit/service";
import { env } from "@/shared/config/env";
import { CLUB_NAME } from "@/theme/brand";
import { DomainError } from "@/shared/errors/domain-error";
import { computeOccupied, computePublicAvailability, hasDirectAvailability } from "./domain/capacity";
import { computeDeclarationHoldExpiry, computeWaitlistOfferExpiry, confirmationWindow } from "./domain/hold-deadlines";
import { deriveAllowedResendMessageType } from "./domain/resend";
import { expectedSignatureName, signatureNameMatches } from "./domain/signature-name";
import { allowedFromStatuses, isActiveStatus } from "./domain/state-machine";
import {
  declarationSigningSchema,
  isMinorOn,
  registrationSubmissionSchema,
  staffRegistrationSubmissionSchema,
} from "./fields";
import {
  composeLegalName,
  resolveDisplayName,
  type RegistrationEntryDetails,
} from "./names";
import * as repo from "./repository";

/**
 * The registration lifecycle (AGENTS.md §15.1-§15.7; BR-REQ-030/031/033/034/035/036).
 *
 * Priority-1 code, the same standing as `content/events/service.ts`. Every function is generic
 * over the caller's schema, for the same reason `content/events/service.ts` and
 * `modules/action-tokens/repository.ts` are: this module's transactions cross into
 * `notifications/outbox.ts` and `modules/legal-documents/repository.ts`, each with its own
 * fixed schema type, and one shared type parameter resolved at the outermost call is what lets
 * a single open transaction satisfy all of them — a locally fixed schema here would not
 * structurally match theirs.
 *
 * Two rules run through every exported function below:
 *
 *   1. Every capacity-changing decision runs inside one transaction that locks the `events`
 *      row first (`repo.lockEventForCapacity`) — the serialization point §10.6 requires — and
 *      re-evaluates hold expiry against `now` itself, never trusting that the maintenance job
 *      has run recently. Nothing here opens a second, nested transaction.
 *   2. No function here issues an email action token. A message that carries one is enqueued
 *      with no secret in its payload (`notifications/outbox.ts` explains why); the token is
 *      minted by the renderer at send time.
 */

/** Everything about the event that submission and allocation need beyond the public columns. */
export type EventForRegistration = {
  id: string;
  eventStatus: "SCHEDULED" | "CANCELLED" | "COMPLETED";
  registrationMode: "NONE" | "INTERNAL" | "EXTERNAL";
  startsAt: Date;
  registrationOpensAt: Date | null;
  registrationClosesAt: Date | null;
  capacity: number | null;
  raceId: string | null;
  publishedAt: Date | null;
  /** The participation window (§104); absent on a partial row means the thirty-minute hold. */
  confirmationOpensDaysBefore?: number | null;
  confirmationDeadlineDaysBefore?: number | null;
};

/**
 * The event as the allocator must see it once the row is locked: the caller's row, with every
 * field a capacity decision rests on as it stands *now*.
 *
 * The caller read the event before the lock. A `capacity` raised in the editor (§147) in
 * between would otherwise waitlist a person against the old number while the new places stood
 * free until the allocator's next visit; and since §160 the `starts_at` and the
 * `event_status` decide whether a lapsed declaration hold is released at all, so a race
 * brought forward or called off between the read and the lock must not be decided against the
 * row the page happened to render.
 */
function withLockedRow(
  event: EventForRegistration,
  locked: { capacity: number | null; startsAt: Date; eventStatus: EventForRegistration["eventStatus"] },
): EventForRegistration {
  return event.capacity === locked.capacity &&
    event.startsAt.getTime() === locked.startsAt.getTime() &&
    event.eventStatus === locked.eventStatus
    ? event
    : { ...event, capacity: locked.capacity, startsAt: locked.startsAt, eventStatus: locked.eventStatus };
}

function assertRegistrationOpen(event: EventForRegistration, now: Date, atTheDesk = false): void {
  if (event.registrationMode !== "INTERNAL") {
    throw new DomainError("VALIDATION_ERROR", "this event does not accept local registration");
  }
  if (atTheDesk) {
    if (event.eventStatus !== "SCHEDULED") {
      throw new DomainError("VALIDATION_ERROR", `the event is ${event.eventStatus}`);
    }
    return;
  }
  const state = registrationState(
    {
      registrationMode: event.registrationMode,
      eventStatus: event.eventStatus,
      startsAt: event.startsAt,
      registrationOpensAt: event.registrationOpensAt,
      registrationClosesAt: event.registrationClosesAt,
      publishedAt: event.publishedAt,
    },
    now,
  );
  if (state !== "OPEN") {
    throw new DomainError("VALIDATION_ERROR", `registration is not open for this event (${state})`);
  }
}

/**
 * The **final** race number to write when a registration is confirmed (`DECISIONS.md` §214).
 *
 * §87 drew one here, at "the moment the place is certain". That is no longer the moment the
 * number is certain, and the two had been the same thing only because nothing existed earlier.
 * Now a place-holding registration carries a provisional number from submission, and the entry
 * list is still moving — people cancel, holds lapse, the waiting list advances — so a number
 * written at confirmation would be a number printed with gaps in it.
 *
 * So, while the window is open, confirmation writes **nothing**: the provisional number stands,
 * the runner keeps seeing it, and the recompaction at close turns the whole list into one dense
 * sequence and emails it. `REGISTRATION_CONFIRMED` therefore carries no number before the
 * close, which is the trade the owner chose: a number that is emailed is a number that cannot
 * move afterwards.
 *
 * **Once the window has shut it draws immediately**, because by then the sequence is settled
 * and a late confirmation — somebody signing on paper at the desk, a walk-in on race day —
 * needs a bib in their hand within the minute. `pickBibNumber` gives it the lowest free final
 * number, which is the one the recompaction has not used.
 */
async function finalBibAtConfirmation<T extends Record<string, unknown>>(
  tx: Database<T>,
  event: EventForRegistration,
  current: Registration,
  now: Date,
): Promise<{ bibNumber: number | null; provisionalBibNumber?: null }> {
  // Never renumber: a number already given is that runner's, whatever else changes (§173).
  if (current.bibNumber !== null) return { bibNumber: current.bibNumber };
  // A test registration wears none, as in the batch assignment (`AGENTS.md` §12.6).
  if (current.kind !== "REAL") return { bibNumber: null };
  if (!registrationHasClosed(event, now)) return { bibNumber: null };

  /*
    Past the close, the number becomes final — and it is **their own provisional one** where
    they have one (§220).

    Drawing a fresh one would be wrong twice over now that `pickBibNumber` treats a held
    provisional number as taken: it would skip the number this very runner is looking at and
    hand them a different one, leaving their old number reserved to nobody. Adopting it is
    also what the runner expects — the desk screen has been showing it to them.

    The provisional column is emptied in the same statement, so one runner is left holding
    exactly one number, which is the invariant the settle keeps too.
  */
  if (current.provisionalBibNumber !== null) {
    return { bibNumber: current.provisionalBibNumber, provisionalBibNumber: null };
  }
  return { bibNumber: await pickBibNumber(tx, current.eventId), provisionalBibNumber: null };
}

async function deliveryEmailOf<T extends Record<string, unknown>>(
  db: Database<T>,
  participantId: string,
): Promise<string> {
  const [row] = await db
    .select({ deliveryEmail: participants.deliveryEmail })
    .from(participants)
    .where(eq(participants.id, participantId))
    .limit(1);
  if (!row) throw new DomainError("NOT_FOUND", "no such participant");
  return row.deliveryEmail;
}

/**
 * Allocate a place or add to the waiting list, for one registration already known to be past
 * email confirmation (AGENTS.md §15.2 steps 5-9, reused by the verified-restart path of §15.1
 * step 9 and by re-allocation in `signDeclaration`). The caller must already hold the
 * event-row lock.
 *
 * Returns the registration as it stands when the allocation is over: `PENDING_DECLARATION`
 * with a hold, `WAITLISTED`, or — when this registration is the first to wait behind a lapsed
 * hold that was being kept for want of a queue (§160) — `WAITLIST_OFFERED`, the offer email
 * already queued by `fillAvailableSpots`.
 */
async function allocateOrWaitlist<T extends Record<string, unknown>>(
  db: Transaction<T>,
  event: EventForRegistration,
  registrationId: string,
  now: Date,
): Promise<Registration> {
  await repo.expireStaleHolds(db, event, now);
  await fillAvailableSpots(db, event, now);

  const occupied = computeOccupied(await repo.countOccupied(db, event.id, now));
  const eligibleWaitlisted = await repo.countEligibleWaitlisted(db, event.id);
  const direct = hasDirectAvailability({ capacity: event.capacity, occupied, eligibleWaitlisted });

  const updated = direct
    ? await repo.transitionRegistration(db, {
        id: registrationId,
        to: "PENDING_DECLARATION",
        changes: {
          holdExpiresAt: computeDeclarationHoldExpiry({
            now,
            registrationClosesAt: event.registrationClosesAt,
            eventStartsAt: event.startsAt,
            // A week-before confirmation for a race still far off (§104); thirty minutes otherwise.
            window: confirmationWindow(event),
          }),
        },
        now,
      })
    : await repo.transitionRegistration(db, {
        id: registrationId,
        to: "WAITLISTED",
        changes: { waitlistedAt: now },
        now,
      });

  if (!updated) {
    throw new DomainError("CONFLICT", "this registration changed state concurrently");
  }

  // The queue has just grown by one (§160): a declaration hold past its deadline was kept
  // because the place was not wanted, and now one more person wants it. The same expiry and
  // the same allocator, once more under the same lock — one kept hold goes, the oldest
  // deadline first, and the place is offered to the front of the line, which is this
  // registration when it is alone there. Nothing is released when no hold has lapsed, so on
  // an event that is simply full this is one read and no write.
  if (updated.status === "WAITLISTED") {
    await fillAvailableSpots(db, event, now);
    return (await repo.findRegistrationById(db, registrationId)) ?? updated;
  }

  /*
    The place is held, so the number is (§214). Under the lock the caller is holding, which is
    why it is safe here and would not be in the service's outer scope.

    Dani, on why this cannot wait for a confirmation: "procesul trebuie să fie automat… vor fi
    gratis, cu număr limitat de înscrieri… ce discuții și hate ne luăm dacă nu l-am înscris pe
    unul la timp și i-a luat altul locul". The place was already held from submission; what was
    missing was anything the runner or the club could *see*, and a number is that thing.
  */
  await ensureProvisionalBibNumber(db, { eventId: event.id, registrationId, now });
  return (await repo.findRegistrationById(db, registrationId)) ?? updated;
}

/**
 * The message an allocation's outcome earns (§15.2 step 10): the declaration to sign, or
 * "you are on the waiting list". An offer made on the way (§160) already queued its own.
 */
async function enqueueAllocationEmail<T extends Record<string, unknown>>(
  db: Transaction<T>,
  allocated: Registration,
  recipientEmail: string,
  idempotencyKey: string,
  now: Date,
): Promise<void> {
  const messageType =
    allocated.status === "WAITLISTED" ? "WAITLIST_JOINED" : allocated.status === "PENDING_DECLARATION" ? "COMPLETE_DECLARATION" : null;
  if (!messageType) return;
  await enqueueEmail(db, {
    participantId: allocated.participantId,
    registrationId: allocated.id,
    messageType,
    locale: allocated.locale,
    recipientEmail,
    payload: {},
    idempotencyKey,
    now,
  });
}

/**
 * Offer the released or newly available places to the front of the queue (AGENTS.md §15.6).
 *
 * Called from inside every transaction that might free or add capacity: confirmation,
 * cancellation, an offer's decline or expiry, and a capacity raised in the editor (§147). The
 * caller must already hold the event-row lock; this does not take it itself, so it composes
 * safely with `allocateOrWaitlist`, which calls it after locking once. Returns how many offers
 * it made — the editor's "locuri oferite listei de așteptare: N" — which every other caller
 * ignores.
 */
export async function fillAvailableSpots<T extends Record<string, unknown>>(
  db: Transaction<T>,
  event: EventForRegistration,
  now: Date,
): Promise<number> {
  await repo.expireStaleHolds(db, event, now);

  // Nothing is ever waitlisted against an uncapped event, so an uncapped event has no queue to
  // fill — unless its cap was just lifted (§147), in which case everyone still waiting is
  // offered a place: the count is what bounds the loop, and it is zero on every other visit.
  const availablePlaces =
    event.capacity === null
      ? await repo.countEligibleWaitlisted(db, event.id)
      : Math.max(event.capacity - computeOccupied(await repo.countOccupied(db, event.id, now)), 0);
  if (availablePlaces <= 0) return 0;

  let offers = 0;
  const candidates = await repo.lockOldestWaitlisted(db, event.id, availablePlaces);
  for (const candidate of candidates) {
    const holdExpiresAt = computeWaitlistOfferExpiry({
      now,
      registrationClosesAt: event.registrationClosesAt,
      eventStartsAt: event.startsAt,
    });

    const offered = await repo.transitionRegistration(db, {
      id: candidate.id,
      to: "WAITLIST_OFFERED",
      fromStatuses: ["WAITLISTED"],
      changes: { offerCreatedAt: now, holdExpiresAt },
      now,
    });
    if (!offered) continue;

    await enqueueEmail(db, {
      participantId: offered.participantId,
      registrationId: offered.id,
      messageType: "WAITLIST_SPOT_OFFER",
      locale: offered.locale,
      recipientEmail: await deliveryEmailOf(db, offered.participantId),
      payload: {},
      idempotencyKey: `registration:${offered.id}:waitlist-offered:${now.toISOString()}`,
      now,
    });
    offers += 1;
  }
  return offers;
}

// --- §10.6 The public free-place count ---------------------------------------------------------

/**
 * The places a new registrant could receive right now (BR-REQ-034-01).
 *
 * A read, and only a read: §10.6 says the public count "never mutates state", so this does not
 * expire a lapsed hold on the way past — `countOccupied` compares an offer's `hold_expires_at`
 * against `now` itself, and counts a declaration hold for as long as it stands, because a
 * lapsed one is kept until somebody waits for the place (§160): the count says "full" and the
 * door says "waiting list", and the person who joins it is offered that place at once. It
 * takes no lock for the same reason: nothing is being decided here, and a page that blocked
 * behind a confirmation's row lock would be slower for no gain in truth. The number can be one
 * place stale the instant it is rendered, and the allocator is what actually holds the guarantee.
 *
 * This is the same formula the allocator uses, called from the same module, because a second
 * one written for the page is how a site ends up advertising a place that does not exist.
 * `kind` appears in neither: a `TEST` registration occupies a place exactly like a real one, so
 * the count a visitor reads is the count they can actually get (AGENTS.md §12.6).
 */
export async function readPublicAvailability<T extends Record<string, unknown>>(
  db: Database<T>,
  event: { id: string; capacity: number | null },
  now: Date,
): Promise<number | null> {
  if (event.capacity === null) return null;

  const occupied = computeOccupied(await repo.countOccupied(db, event.id, now));
  const eligibleWaitlisted = await repo.countEligibleWaitlisted(db, event.id);
  return computePublicAvailability({ capacity: event.capacity, occupied, eligibleWaitlisted });
}

// --- Spam defenses (AGENTS.md §19.4, WEEKEND.md) ---------------------------------------------

/**
 * Below this, a submission is treated as automated (§217).
 *
 * **One second, not three.** The owner, after the second person it cost: "so the anti-spam/bot
 * verification must be way more loose." The asymmetry is the argument — a lost registration is
 * the thing this site exists to prevent, and a spam registration is a row an Administrator
 * deletes in two seconds. Three seconds is well inside what a person with autofill, a saved
 * card of details, or a fast connection takes; one second is not reachable by hand and is still
 * the entire benefit, because a script that waits it out has been slowed exactly as much.
 *
 * The real bot defences on this form are the honeypot, Turnstile (§97, §216) and the
 * per-identity throttle (§19.4). This is the cheapest of the four and the only one that has
 * ever refused a real person.
 */
const MIN_SUBMISSION_SECONDS = 1;

/**
 * What the two public-form defences actually found (§194).
 *
 * They used to answer one question — "is this a bot" — and both answers were discarded in the
 * same silence. That cost a real participant: somebody registered on QA, saw "we have sent you a
 * confirmation link", and afterwards no registration, no outbox row and no log line existed
 * anywhere. Nothing recorded which check had fired, so nothing could be diagnosed; the only way
 * to find it was to read the code and eliminate every other path.
 *
 * They are still separated, because they are not equally certain and the **log** should say
 * which fired:
 *
 * - `trap` — the hidden field was filled. Almost always a machine; rarely a password manager
 *   or an accessibility tool that does not know the field is hidden.
 * - `too-fast` — the form was posted less than three seconds after it was rendered, or arrived
 *   with no render time at all. That is a *guess*, and a wrong guess about a person who typed
 *   quickly, used autofill, or came back to a cached page.
 *
 * **Neither is answered with silence** (§217). They produce the same refusal with the same
 * marker, so the caller — and therefore a script — cannot tell them apart, while the person
 * always gets a sentence and their answers back instead of a promise of an email nobody sent.
 */
export type SubmissionVerdict = "ok" | "trap" | "too-fast" | "autofill";

export function classifySubmission(
  input: { honeypot?: string; renderedAt?: string; email?: string; firstName?: string; lastName?: string },
  now: Date,
): SubmissionVerdict {
  const trap = (input.honeypot ?? "").trim();
  if (trap !== "") {
    /*
      A trap holding the person's **own** details is a password manager, not a bot (§282).

      The owner, 2026-09-22: "we need to test with auto-fill properly … I also want to give real
      people the option to fix it." A browser that autofills a form fills what it believes are
      the name and address fields, and an offscreen input is still an input — so what lands in
      the trap is that person's name or address, spelled exactly as they typed it above. A bot
      has no reason to put the submitted address in a field the form never showed; it puts a
      link, a keyword, or a random string.

      So the value is compared with what was submitted, and a match is reported as `autofill`,
      which the caller does not refuse. Anything else is still `trap`.
    */
    const own = [input.email, input.firstName, input.lastName]
      .filter((value): value is string => typeof value === "string" && value.trim() !== "")
      .map((value) => value.trim().toLowerCase());
    return own.includes(trap.toLowerCase()) ? "autofill" : "trap";
  }
  /*
    A missing or unparseable render time is **not** suspicious any more (§217).

    It used to be treated as a bot, on the reasoning that a submission which lost its timestamp
    had probably been assembled by something other than the form. In practice the things that
    lose it are a page restored from the back-forward cache, a browser extension that rewrites
    the DOM, a proxy that strips a hidden field, and a form posted from a tab open since
    yesterday — all of them people. There is nothing to time, so there is nothing to judge, and
    the honeypot and Turnstile are still in front of this.
  */
  const renderedAt = new Date(input.renderedAt ?? "");
  if (Number.isNaN(renderedAt.getTime())) return "ok";
  return now.getTime() - renderedAt.getTime() < MIN_SUBMISSION_SECONDS * 1000 ? "too-fast" : "ok";
}

/** Shared with the contact and interest forms (§146, §149), which keep the older, single answer. */
export function looksLikeSpam(input: { honeypot?: string; renderedAt?: string }, now: Date): boolean {
  const verdict = classifySubmission(input, now);
  return verdict !== "ok" && verdict !== "autofill";
}

/**
 * Whether a submission this form suspects is actually refused (§282).
 *
 * The suspicion and the consequence are separated because they answer different questions, and
 * only the second one can lose the club an entrant:
 *
 * - **Cloudflare outranks the hidden field.** Turnstile looked at this browser and passed it;
 *   the trap is a guess, and a guess does not overrule a measurement. A bot that can pass
 *   Turnstile was never going to be stopped by an offscreen input.
 * - **A second attempt is let through.** Somebody refused once is now a person who has been
 *   told they looked automated and has pressed the button again. If their browser refills the
 *   trap every time — which is exactly what a password manager does — refusing again would
 *   loop them forever, and the form's whole purpose is to take their entry.
 * - **Otherwise the verdict stands**, which is what still refuses a script that posts once with
 *   no token and a filled trap.
 */
export function refusesSubmission(input: {
  verdict: SubmissionVerdict;
  /** The hidden field's own switch (§282). Off, it suspects nothing. */
  honeypotOn?: boolean;
  /** What Cloudflare said, when it was asked at all. */
  turnstile: "passed" | "failed" | "unavailable" | "not_configured";
  /** This is the try after a refusal. */
  secondAttempt: boolean;
}): boolean {
  if (input.verdict === "ok" || input.verdict === "autofill") return false;
  // Switched off in the backoffice: the field is still rendered and still logged, and it stops
  // refusing anybody (§282). The timing guess and Turnstile are untouched by this switch.
  if (input.verdict === "trap" && input.honeypotOn === false) return false;
  /*
    A token Cloudflare **looked at and rejected** ends it, and no second press undoes that
    (§282; the owner: "nu vreau ca oamenii sa ajunga la ecranul asta si sa fi fost roboti").

    The escape below exists for a person the two guesses caught by accident. It must not become
    a way past the one check that actually measured this browser — otherwise a script posts
    twice and reaches the "check your email" screen, which costs the club a message out of a
    Mailgun allowance that is sixteen registrations a day on the free plan (§100).

    In practice the action refuses a failed token before this is reached; the rule is stated
    here as well because this function is where the decision is written down.
  */
  if (input.turnstile === "failed") return true;
  if (input.turnstile === "passed") return false;
  return !input.secondAttempt;
}

// --- §15.1 Registration submission ------------------------------------------------------------

export type SubmitRegistrationResult = { ok: true };

/**
 * How this submission arrived: the public form, or an organizer entering it for somebody
 * (BR-REQ-037-05, `DECISIONS.md` §33).
 *
 * It changes two things and no others: the spam defenses below, which have nothing to time or
 * to hide a honeypot in when a member of staff types the form; and the two columns that record
 * who put the row there. Every rule about places, order and consent is identical, which is the
 * whole point — a staff-entered registration is that person's registration, and the queue must
 * not be able to tell the difference.
 */
export type RegistrationOrigin = {
  source: RegistrationSource;
  createdByStaffUserId?: string | null;
  /**
   * The desk on race morning (BR-REQ-037-07): the window the public saw is closed, and the
   * person is standing there. Staff only — a public submission can never set it — and it
   * skips the window alone: the mode must still be INTERNAL, the event must still be
   * SCHEDULED, and the capacity lock is exactly the same.
   */
  atTheDesk?: boolean;
  /**
   * What the public form already learned before calling (§282): Cloudflare's verdict, and
   * whether this is the try after a refusal. Both are the caller's to know — the token is
   * verified in the action, over the network, and the attempt is a field on the form — and
   * both are ignored for a staff submission, which has no widget and no hidden field.
   */
  turnstile?: "passed" | "failed" | "unavailable" | "not_configured";
  secondAttempt?: boolean;
  /** Whether the club has the hidden field switched on (§282). */
  honeypotOn?: boolean;
};

const PUBLIC_ORIGIN: RegistrationOrigin = { source: "PUBLIC", createdByStaffUserId: null };

/** The queued row, or null when the idempotency key had already been used (`enqueueEmail`). */
async function enqueueVerificationEmail<T extends Record<string, unknown>>(
  db: Transaction<T>,
  participant: Participant,
  registration: Registration,
  now: Date,
): Promise<OutboxRow | null> {
  return enqueueEmail(db, {
    participantId: participant.id,
    registrationId: registration.id,
    messageType: "VERIFY_REGISTRATION_EMAIL",
    locale: registration.locale,
    recipientEmail: participant.deliveryEmail,
    payload: {},
    idempotencyKey: `registration:${registration.id}:verify-requested:${now.toISOString()}`,
    now,
  });
}

/**
 * "Send me that link again" — §19.4's second surface, the one its table listed as specified
 * and not built.
 *
 * The participant has an address and a problem: nothing arrived, or it arrived and was
 * deleted. Until now the only way back was to fill the whole registration form again, which
 * `submitRegistration` quietly treats as a resend for one status — and which is unreachable
 * once the registration window closes, even though a declaration hold outlives it.
 *
 * Three properties this function must keep, in order of how badly each fails:
 *
 * 1. **It answers identically whatever it finds.** A form that accepts an address nobody has
 *    proven they own is a membership oracle if it ever says "no such registration". So it
 *    returns nothing at all: not found, not active, nothing to resend, throttled — one answer,
 *    the same one, matching §15.1's generic response and §13.2's single invalid-or-expired.
 * 2. **It sends only what the current status allows**, via the same
 *    `deriveAllowedResendMessageType` the Administrator resend uses (§15.8). A participant
 *    cannot conjure a declaration link for a registration that is merely waitlisted, because
 *    nothing is waiting on them.
 * 3. **It never changes state.** No transition, no hold extension, no new token here — the
 *    token is minted by the renderer at send time, as it is for every other message (§14.5).
 */
export async function requestRegistrationLink<T extends Record<string, unknown>>(
  db: Database<T>,
  input: { email: string; eventId?: string },
  now: Date,
): Promise<void> {
  let identity;
  try {
    identity = canonicalizeEmail(input.email);
  } catch {
    // A malformed address is not a registration either, and saying so differently would be a
    // second answer. The form's own `type="email"` catches the honest typo before this.
    return;
  }

  // Counted before anything is looked up, so a script cannot use the lookup itself as the
  // signal, and counted even when refused (`consumeRateLimit`).
  const verdict = await consumeRateLimit(db, "link-request", identity.canonicalEmail, now);
  if (!verdict.allowed) return;

  const participant = await findParticipantByCanonicalEmail(db, identity.canonicalEmail);
  if (!participant) return;

  const registration = input.eventId
    ? await repo.findRegistrationByEventAndParticipant(db, input.eventId, participant.id)
    : await repo.findLatestActiveRegistrationForParticipant(db, participant.id);
  if (!registration || !isActiveStatus(registration.status)) return;

  const messageType = deriveAllowedResendMessageType(registration.status);
  if (!messageType) return;

  await db.transaction(async (tx) => {
    await enqueueEmail(tx, {
      participantId: participant.id,
      registrationId: registration.id,
      messageType,
      // The registration's language, not the language of the page they asked from: the row
      // records what they chose when they registered, and that is the one they read.
      locale: registration.locale,
      recipientEmail: participant.deliveryEmail,
      payload: {},
      // Per request, so two genuine asks an hour apart are two messages — the throttle above
      // is what bounds them, not a key collision that would silently swallow the second.
      idempotencyKey: `registration:${registration.id}:link-requested:${now.toISOString()}`,
      now,
    });
  });
}

/**
 * BR-REQ-030-01, BR-REQ-031-01, BR-REQ-033-01 criterion 1. Always answers the same generic
 * success (BR-REQ-031-01 criterion 3): a validation error surfaces only for the form being
 * malformed, never for what the submitted address turns out to mean.
 */
export async function submitRegistration<T extends Record<string, unknown>>(
  db: Database<T>,
  event: EventForRegistration,
  rawInput: unknown,
  now: Date,
  /**
   * `TEST` only ever arrives from `test-registrations.ts`, which is Administrator-only and
   * refused in production. It changes nothing below this line: the same allocator, the same
   * holds, the same queue — that is the entire point of it (AGENTS.md §12.6, `DECISIONS.md`
   * §30). It is carried into the row so the export can leave it out and every list can label it.
   */
  kind: RegistrationKind = "REAL",
  origin: RegistrationOrigin = PUBLIC_ORIGIN,
): Promise<SubmitRegistrationResult> {
  const atTheDesk = origin.source === "STAFF" && origin.atTheDesk === true;
  assertRegistrationOpen(event, now, atTheDesk);

  /**
   * Which details are insisted on depends on who is filling the form in, and on nothing
   * else (BR-REQ-031-04 criterion 5).
   *
   * A person entering their own registration answers every question. An organizer writing
   * down what somebody said on the telephone may not have been told a date of birth, and
   * refusing the row would lose the registration rather than improve the record. `kind` is
   * deliberately not consulted here: a TEST row carries a full set of synthetic details and
   * goes through exactly the path a real one does (AGENTS.md §12.6).
   */
  const schema =
    origin.source === "STAFF" ? staffRegistrationSubmissionSchema : registrationSubmissionSchema;
  const parsed = schema.safeParse(rawInput);
  if (!parsed.success) {
    throw new DomainError(
      "VALIDATION_ERROR",
      parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; "),
      // Paths only. The messages above are for logs; these reach a rendered page.
      [...new Set(parsed.error.issues.map((issue) => issue.path.join(".")))],
    );
  }
  const input = parsed.data;

  // Only the public form is defended this way. A staff-entered registration has no rendered
  // page behind it to have timed and no hidden field for a bot to fill, and the person typing
  // it has already been authenticated and authorized as an Administrator.
  if (origin.source === "PUBLIC") {
    const verdict = classifySubmission(input, now);
    /*
      Neither defence is answered with silence any more (§217, amending §194 and
      BR-REQ-031-01 criterion 3).

      The owner: "people need to know that they were identified as bots! it's very bad for a
      user to tell him he is waiting for an email but he never receives it!" He is right, and
      the rule is worth stating as an invariant rather than as a fix: **nothing may show the
      "check your email" screen unless a message was actually queued.** Telling somebody to
      wait for an email that was never sent is the worst answer this form can give — they wait,
      they give up, and the club never learns they tried.

      §194 kept the trap silent because a distinct error tells a script what to stop doing.
      That argument is sound and it is outweighed. A hidden field is filled by machines and
      *also*, rarely, by a password manager or an accessibility tool that does not know it is
      hidden — and that person was being told a lie with no way out of it. What a bot learns
      from the refusal is only "refused": both verdicts throw the **same** error with the same
      marker, so nothing says which check fired, and a script still has to wait out the timer
      either way. That is the whole of what a timing check ever bought.

      Both are logged with the verdict — the event and nothing about the person (§14.5) — so
      the club can see how often this happens without a database query, which is what made the
      last silent drop so expensive to find.
    */
    const refused = refusesSubmission({
      verdict,
      turnstile: origin.turnstile ?? "not_configured",
      secondAttempt: origin.secondAttempt === true,
      honeypotOn: origin.honeypotOn !== false,
    });
    if (refused) {
      console.warn(`[registration] refused as automated: ${verdict}, event ${event.id}`);
      throw new DomainError("VALIDATION_ERROR", `the submission looked automated (${verdict})`, [
        "tooFast",
      ]);
    }
    if (verdict !== "ok") {
      // Suspected and taken anyway — logged, because how often this happens is the only way to
      // tell a password manager filling the trap from a defence that has stopped working (§282).
      console.warn(
        `[registration] accepted despite ${verdict}: turnstile ${origin.turnstile ?? "not_configured"}, second attempt ${origin.secondAttempt === true}, event ${event.id}`,
      );
    }
  }

  const privacyNotice = await findCurrentApprovedDocument(db, "PRIVACY_NOTICE", input.locale, now);
  if (!privacyNotice) {
    throw new DomainError(
      "VALIDATION_ERROR",
      "no approved privacy notice exists yet; registration cannot be accepted",
    );
  }

  const identity = canonicalizeEmail(input.email);

  /**
   * The throttle of AGENTS.md §19.4, keyed on the canonical identity rather than an address as
   * typed — otherwise `ana.pop+1@`, `ana.pop+2@` and `anapop@` are three allowances for one
   * mailbox, which is the flood this exists to stop.
   *
   * **Refused out loud, like everything else on this form since §217** — and this one was
   * missed when the rest was fixed, which is the whole reason it is worth a paragraph.
   *
   * It used to return the generic success, justified in these words: "refused the same way the
   * honeypot and the timing check are refused". §217 reversed both of those, and left this
   * pointing at a rule that no longer existed. So the sixth submission in an hour produced no
   * registration, no email, no log line, and the "check your email" screen — the precise
   * failure that cost two participants, still live on the one guard nobody looked at.
   *
   * It leaks nothing. The bucket is keyed on the canonical identity of the address they have
   * just typed, so being told "you have sent several of these" is being told about themselves;
   * it says nothing about whether anybody else is registered, which is the oracle §19.4
   * actually forbids. The contact form has answered this way from the start, and
   * `rate-limit/service.ts` says why in as many words: "the sixth is told so plainly, because
   * a person is not a bot."
   *
   * Five an hour is also reachable by ordinary use — a re-test, a second family member on one
   * mailbox, somebody who cancelled and signed up again — which is exactly who must not be
   * met with silence.
   *
   * Staff-entered registrations skip it, like the spam checks above: an Administrator adding
   * people at a desk is the case this must not obstruct, and they are already authenticated
   * and authorized.
   */
  if (origin.source === "PUBLIC") {
    const verdict = await consumeRateLimit(db, "registration-submit", identity.canonicalEmail, now);
    if (!verdict.allowed) {
      // The event and the verdict, never the address (§14.5) — as the anti-bot refusals log.
      console.warn(`[registration] refused as throttled, event ${event.id}`);
      throw new DomainError(
        "VALIDATION_ERROR",
        `too many submissions from this identity; retry after ${verdict.retryAfter}s`,
        ["throttled"],
      );
    }
  }

  /**
   * The legal name of record, and the details beside it (BR-REQ-031-04, BR-REQ-031-05).
   *
   * Composed once, here, so the declaration, the emails and the backoffice all read one string
   * rather than three call sites each joining the parts their own way. The health consent
   * carries the privacy notice's version, the same way `resultsConsentVersion` does: the
   * wording a person agreed to is a historical fact, not the wording currently approved.
   */
  const legalName = composeLegalName(input.firstName, input.lastName);
  const healthNotes = input.healthConsent && input.healthNotes ? input.healthNotes : null;
  const details: RegistrationEntryDetails = {
    firstName: input.firstName,
    lastName: input.lastName,
    displayName: input.displayName ?? null,
    birthDate: input.birthDate ?? null,
    sex: input.sex ?? null,
    nationality: input.nationality ?? null,
    city: input.city ?? null,
    phone: input.phone ?? null,
    emergencyContactName: input.emergencyContactName ?? null,
    emergencyContactPhone: input.emergencyContactPhone ?? null,
    /**
     * A member's club is the club's own name (§215).
     *
     * The tick and this box are the same question asked twice (BR-REQ-031-06), and typing the
     * answer by hand is how one club became "BRASOV RUNNERS", "Brasov runners" and "BvR" in the
     * export. The form fills it in and locks it while the tick is on; this is the same rule on
     * the server, so a submission with JavaScript off — or from anything that is not the form —
     * records the same string. The tick still grants nothing (§48): this writes a name, not a
     * capability.
     *
     * The name is the platform's constant rather than the catalogue's: what is stored is a
     * fact about the club, not a translation, and it must not differ between a Romanian and an
     * English submission.
     */
    clubName: input.clubMemberDeclared ? CLUB_NAME : (input.clubName ?? null),
    // Kept only for a minor: an adult who typed a name into the folded field named nobody's guardian.
    guardianName: input.birthDate && isMinorOn(input.birthDate, now) && input.guardianName ? input.guardianName : null,
    stravaUrl: input.stravaUrl ?? null,
    instagramHandle: input.instagramHandle ?? null,
    clubMemberDeclared: input.clubMemberDeclared,
    tshirtSize: input.tshirtSize,
    healthNotes,
    healthConsentVersion: healthNotes ? privacyNotice.version : null,
    healthConsentAt: healthNotes ? now : null,
    // The statement itself, with the moment it was made (§171). A staff entry leaves it null:
    // the paper declaration at the desk carries it, and nobody declares it on another's behalf.
    fitnessDeclaredAt: input.fitnessDeclared ? now : null,
    rulesAcknowledgedAt: input.rulesAcknowledged ? now : null,
  };

  await db.transaction(async (tx) => {
    const participant = await findOrCreateParticipant(tx, identity, legalName, input.locale, now);
    const existing = await repo.findRegistrationByEventAndParticipant(tx, event.id, participant.id);

    if (existing && isActiveStatus(existing.status)) {
      /*
        Already registered at some stage (§199).

        The screen's answer is the generic one, always: telling a visitor "this address is
        already registered" would turn the public form into a way to ask who is entered, which
        is the oracle `AGENTS.md` §19.4 exists to refuse. The *useful* answer goes where it can
        safely go — the address itself, which only its owner reads.

        It used to be sent only while the first registration was still waiting for its email
        confirmation, on the reasoning that resubmitting helps only if the first message was
        lost. That leaves everybody else with nothing at all: somebody who confirmed a month ago,
        forgot, and filled the form again sees "we have sent you a confirmation link" and no
        message arrives, which reads exactly like a failure — and it is what happens to anybody
        re-entering a test registration.

        So: whatever the state can offer, it offers, through the same `deriveAllowedResendMessageType`
        the backoffice's "send it again" uses — the verification link, the declaration, the
        waiting-list offer, or the confirmation with its QR. A state with nothing to resend
        (WAITLISTED: nothing is waiting on the participant) still sends nothing, because there is
        nothing to say.

        The throttle in front of the form is what keeps this from being a mailer: the same person
        can only ask so often (§19.4), and each message goes to the address that asked for it.
      */
      /*
        A waiting-list entry has nothing to *re-send* and still owes an answer (§217).

        `deriveAllowedResendMessageType` returns null for WAITLISTED, and it is right to: the
        backoffice's "send it again" hands somebody a link they have to act on, and a person
        queued for a place has no link and nothing to do. But this is not the backoffice — it
        is somebody typing their address into the form a second time because they are not sure
        the first time worked, and answering that with the "check your email" screen and no
        message is the §217 failure exactly.

        So the public path sends `WAITLIST_JOINED` again, which is the message that answers the
        question actually being asked: you are on the list, this is your position, nothing is
        owed from you. The throttle above is what keeps this from becoming a mailer.
      */
      const messageType = existing.status === "WAITLISTED"
        ? ("WAITLIST_JOINED" as const)
        : deriveAllowedResendMessageType(existing.status);
      // Whether a row was actually queued, for the club's record below: a key already used — two
      // presses in the same millisecond — queues nothing, and the record must not say otherwise.
      let queued: OutboxRow | null = null;
      if (messageType === "VERIFY_REGISTRATION_EMAIL") {
        queued = await enqueueVerificationEmail(tx, participant, existing, now);
      } else if (messageType) {
        queued = await enqueueEmail(tx, {
          participantId: participant.id,
          registrationId: existing.id,
          messageType,
          // The registration's language, not the page's: the row records what they chose.
          locale: existing.locale,
          recipientEmail: participant.deliveryEmail,
          // Says, in the one place it may be said, that this is the registration they already
          // have rather than a new one (§235). The screen stays generic for everybody (§19.4).
          payload: { alreadyRegistered: true },
          // Per submission, so two genuine attempts an hour apart are two messages; the throttle
          // bounds them rather than a key collision silently swallowing the second.
          idempotencyKey: `registration:${existing.id}:resubmitted:${now.toISOString()}`,
          now,
        });
      }
      /*
        …and the club learns it too (§312).

        Amalia registered with her browser's autofill, twice; she was told in the second
        message that she already was (§235), and the club was told nothing — "she says she
        registered but I cannot find anything" had no answer on any screen. So every pass through
        this branch leaves one audit row on the registration it found, whatever the state and
        whether or not anything went out: the state it found and the message type re-sent, or
        null. The registration's page reads it as a line of its timeline and the list as a chip.

        What it deliberately is not:
        - *A second answer on the public screen.* The row is read only behind
          `canReadRegistrations`; the visitor's screen is byte for byte the one everybody gets,
          which is the oracle rule (§19.4) and the reason this is an audit row and not a flag
          the confirmation page could consult.
        - *Personal.* The participant is the row's own column; the metadata names a state and a
          message type, never what was typed (§12.12). A second name typed into the form is
          not recorded anywhere — the registration keeps the name it has.
        - *Another throttle.* The public form's per-identity bucket above already bounds how
          often one address reaches this line (§19.4), so the trail cannot be flooded faster
          than the inbox it mirrors.

        In the same transaction as the re-send, so the record and the message cannot disagree:
        either both happened or neither did.
      */
      await recordAuditEvent(tx, {
        // The person themselves, so no actor. A staff entry refuses a duplicate out loud before
        // calling in (`createRegistrationByStaff`) and reaches this line only by racing another
        // entry past that check — and then the row names who typed it, which is the truth.
        actorStaffUserId: origin.source === "STAFF" ? (origin.createdByStaffUserId ?? null) : null,
        participantId: participant.id,
        action: "registration.resubmitted",
        entityType: "registration",
        entityId: existing.id,
        metadata: { status: existing.status, resent: queued && messageType ? messageType : null },
        now,
      });
      return;
    }

    const carriedFields = {
      registeredName: legalName,
      // A restart records what the person answered *now*. Carrying last year's t-shirt size
      // forward because a cancelled row happened to hold one is not a kindness.
      ...details,
      displayName: resolveDisplayName({
        displayName: input.displayName,
        firstName: input.firstName,
        lastName: input.lastName,
        legalName,
      }),
      privacyNoticeVersion: privacyNotice.version,
      privacyAcknowledgedAt: now,
      resultsNameConsent: input.resultsNameConsent,
      resultsConsentVersion: privacyNotice.version,
      listOptOut: input.listOptOut,
      // Carried on a restart too: the row should say who put this registration here *now*, not
      // who put an earlier, cancelled one here months ago.
      source: origin.source,
      createdByStaffUserId: origin.createdByStaffUserId ?? null,
    };

    if (existing) {
      // A restart of a Cancelled or Expired registration (AGENTS.md §10.5). Never leapfrogs
      // the waiting list and never lands directly on Confirmed — `allocateOrWaitlist` is the
      // same allocator a first-time registration uses.
      if (!participant.emailVerifiedAt) {
        const restarted = await repo.transitionRegistration(tx, {
          id: existing.id,
          to: "PENDING_EMAIL_CONFIRMATION",
          changes: carriedFields,
          now,
        });
        if (restarted && !atTheDesk) await enqueueVerificationEmail(tx, participant, restarted, now);
        return;
      }

      await tx
        .update(registrations)
        .set({ ...carriedFields, updatedAt: now })
        .where(eq(registrations.id, existing.id));

      // The event row first, like every other allocation (rule 1 above, §10.6): a verified
      // participant's restart used to allocate against the capacity the page had read, with
      // no lock — the one door into the allocator that skipped the serialization point
      // (`DECISIONS.md` §151).
      const lockedEvent = await repo.lockEventForCapacity(tx, event.id);
      if (!lockedEvent) throw new DomainError("NOT_FOUND", "no such event");
      const allocated = await allocateOrWaitlist(tx, withLockedRow(event, lockedEvent), existing.id, now);
      await enqueueAllocationEmail(tx, allocated, participant.deliveryEmail, `registration:${allocated.id}:restart:${now.toISOString()}`, now);
      return;
    }

    /*
      The event row, locked, before the row that occupies one of its places is written (§214).

      Until now the insert was the one door into the allocator that took no lock, on the
      reasoning that the capacity *decision* happens later, at email confirmation. That is
      still true of the decision — and a `PENDING_EMAIL_CONFIRMATION` row occupies a place
      from the instant it exists (`ACTIVE_REGISTRATION_STATUSES`), so the number that goes
      with the place has to be drawn here, and a draw without the lock is two people reaching
      the same free number.

      It is the same serialization point every other allocation uses (§10.6, §151), so the
      cost is contention this event already has, not a new kind of it.
    */
    const lockedForCreate = await repo.lockEventForCapacity(tx, event.id);
    if (!lockedForCreate) throw new DomainError("NOT_FOUND", "no such event");

    const created = await repo.insertPendingEmailRegistration(tx, {
      eventId: event.id,
      participantId: participant.id,
      kind,
      locale: input.locale,
      registeredName: legalName,
      details,
      privacyNoticeVersion: privacyNotice.version,
      privacyAcknowledgedAt: now,
      raceId: event.raceId,
      resultsNameConsent: input.resultsNameConsent,
      resultsConsentVersion: privacyNotice.version,
      listOptOut: input.listOptOut,
      source: origin.source,
      createdByStaffUserId: origin.createdByStaffUserId ?? null,
      now,
    });
    // The number, at the moment the place is taken rather than at the moment it is confirmed
    // (§214). The runner sees it on the screen they land on, and the club sees it in the list
    // before anybody has signed anything — which is what "the process must be automatic" asks
    // for. It is never emailed, because it can still move when the numbers are settled.
    await ensureProvisionalBibNumber(tx, {
      eventId: event.id,
      registrationId: created.id,
      bibStartNumber: lockedForCreate.bibStartNumber,
      now,
    });

    // At the desk the address is about to be vouched for by the person typing it
    // (BR-REQ-037-07); a verification email to somebody standing in front of them is noise.
    if (!atTheDesk) await enqueueVerificationEmail(tx, participant, created, now);
  });

  return { ok: true };
}

// --- §15.2 Email confirmation ------------------------------------------------------------------

/** Consumed after the participant's `VERIFY_REGISTRATION_EMAIL` token is spent. */
export async function confirmEmail<T extends Record<string, unknown>>(
  db: Database<T>,
  event: EventForRegistration,
  registrationId: string,
  now: Date,
): Promise<Registration> {
  return db.transaction(async (tx) => {
    const lockedEvent = await repo.lockEventForCapacity(tx, event.id);
    if (!lockedEvent) throw new DomainError("NOT_FOUND", "no such event");

    const current = await repo.findRegistrationById(tx, registrationId);
    if (!current) throw new DomainError("NOT_FOUND", "no such registration");
    if (current.status !== "PENDING_EMAIL_CONFIRMATION") {
      // Already confirmed by an earlier click of the same link, or moved on since. Idempotent:
      // show the current state rather than erroring.
      return current;
    }

    await markEmailVerified(tx, current.participantId, now);
    const allocated = await allocateOrWaitlist(tx, withLockedRow(event, lockedEvent), current.id, now);
    await enqueueAllocationEmail(
      tx,
      allocated,
      await deliveryEmailOf(tx, current.participantId),
      `registration:${allocated.id}:email-confirmed:${now.toISOString()}`,
      now,
    );

    return allocated;
  });
}

// --- §15.3 Declaration signing, and offer acceptance (the same act) ------------------------

export async function signDeclaration<T extends Record<string, unknown>>(
  db: Database<T>,
  event: EventForRegistration,
  registrationId: string,
  rawInput: unknown,
  now: Date,
): Promise<Registration> {
  const parsed = declarationSigningSchema.safeParse(rawInput);
  if (!parsed.success) {
    throw new DomainError(
      "VALIDATION_ERROR",
      parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; "),
      // The field names, never the values (§14.5): a blank signature is answered on the page as
      // the signature it is, not as a broken link (§314).
      [...new Set(parsed.error.issues.map((issue) => String(issue.path[0] ?? "")).filter(Boolean))],
    );
  }

  return db.transaction(async (tx) => {
    const lockedEvent = await repo.lockEventForCapacity(tx, event.id);
    if (!lockedEvent) throw new DomainError("NOT_FOUND", "no such event");
    const locked = withLockedRow(event, lockedEvent);

    /**
     * The race is still to be run. A declaration signed against a called-off event would draw
     * a race number and send "you are in" for a race that will not happen — and since §160 the
     * link in the email lives until the start, so the window in which somebody could open it
     * after the cancellation is weeks rather than minutes. The event's own row, under the lock.
     */
    if (locked.eventStatus !== "SCHEDULED") {
      throw new DomainError("VALIDATION_ERROR", `the event is ${locked.eventStatus}`);
    }

    const before = await repo.findRegistrationById(tx, registrationId);
    if (!before) throw new DomainError("NOT_FOUND", "no such registration");
    if (before.status !== "PENDING_DECLARATION" && before.status !== "WAITLIST_OFFERED") {
      throw new DomainError("CONFLICT", `a declaration cannot be signed from status ${before.status}`);
    }

    /**
     * The signature is the declarant's name (§314, reversing that half of §283): the name given
     * at registration, or the parent's for a minor (§108) — the name the text above it already
     * prints as the one who declares. Asserted here, in the transaction that writes the
     * acceptance, and not only in the browser that refuses it first: a form with JavaScript off,
     * or a second caller, meets the same rule. A refusal is a throw, so the whole transaction
     * rolls back with it — the token spend included — and the same link signs with the right
     * name a moment later.
     *
     * Before the hold expiry and the re-allocation below, not after them (found in review): a
     * lapsed hold that re-allocates to the waiting list returns early, so a check placed later
     * never ran on that path, and the early return committed the token spend with a name nobody
     * had compared. Neither name changes under the expiry, so nothing is lost by asking first,
     * and a refused name never reaches the allocator.
     *
     * What is recorded stays what was typed, casing and diacritics and all: the rule decides
     * whether the signature is accepted, never what it says.
     */
    if (!signatureNameMatches(parsed.data.typedName, expectedSignatureName(before))) {
      throw new DomainError("VALIDATION_ERROR", "typedName: the signature is not the declarant's name", ["typedName"]);
    }

    // Re-verify the hold is still live at the moment of signing — never trusting that it was
    // live when the page was rendered (§15.3 step 6; §10.6: evaluated against `now`). A hold
    // past its deadline is still live while nobody waits for the place (§160): the signature
    // that comes late is the one the owner asked to be lenient about.
    await repo.expireStaleHolds(tx, locked, now);
    let current = await repo.findRegistrationById(tx, registrationId);
    if (!current) throw new DomainError("NOT_FOUND", "no such registration");

    if (current.status === "EXPIRED") {
      // The hold lapsed at the very moment of signing (§15.3 step 7): re-run allocation
      // rather than simply refusing a place that might still be free.
      current = await allocateOrWaitlist(tx, locked, registrationId, now);
      if (current.status === "WAITLISTED") return current; // no declaration requested yet
    }

    const document = await findCurrentApprovedDocument(tx, "EVENT_DECLARATION", current.locale, now);
    if (!document) {
      throw new DomainError("VALIDATION_ERROR", "no approved declaration exists for this locale");
    }

    /**
     * Bind the signature to the text that was read (BR-REQ-033-02 criterion 6, DECISIONS.md §57).
     * The page posts the id and hash of the version it rendered; a newer version approved in
     * between makes the two disagree, and recording the current one would stamp a text the
     * participant never saw — the defect §53 found. Refused with CONFLICT, which rolls back the
     * whole transaction, token spend included, so the same link re-renders the current text.
     */
    if (document.id !== parsed.data.documentId || document.contentSha256 !== parsed.data.contentSha256) {
      throw new DomainError(
        "CONFLICT",
        `DECLARATION_CHANGED: the declaration that was read is not the current approved version ${document.version}; the participant must read the current text and sign again`,
      );
    }

    // The identity document, when the declaration's own text names it (§95): the club hands
    // out kits against it, so a signature without one is not the declaration the club wrote.
    const asksForIdDocument = mergeFieldsIn(document.body).has("idDocument");
    if (asksForIdDocument && !parsed.data.idDocument) {
      throw new DomainError("VALIDATION_ERROR", "idDocument: the declaration names an identity document");
    }

    await repo.insertDeclarationAcceptance(tx, {
      registrationId: current.id,
      legalDocumentId: document.id,
      declarationVersion: document.version,
      contentSha256: document.contentSha256,
      locale: current.locale,
      typedName: parsed.data.typedName,
      idDocument: asksForIdDocument ? parsed.data.idDocument : null,
      acceptedAt: now,
    });

    const confirmed = await repo.transitionRegistration(tx, {
      id: current.id,
      to: "CONFIRMED",
      fromStatuses: ["PENDING_DECLARATION", "WAITLIST_OFFERED"],
      changes: {
        confirmedAt: now,
        holdExpiresAt: null,
        checkinCode: current.checkinCode ?? newCheckinCode(),
        // The race number, once the list is settled (§214, amending §87): nothing while the
        // window is open — the provisional number stands and the recompaction at close gives
        // the final one — and the next free number immediately once it has shut.
        ...(await finalBibAtConfirmation(tx, event, current, now)),
      },
      now,
    });
    if (!confirmed) throw new DomainError("CONFLICT", "this registration changed state concurrently");

    await enqueueEmail(tx, {
      participantId: confirmed.participantId,
      registrationId: confirmed.id,
      messageType: "REGISTRATION_CONFIRMED",
      locale: confirmed.locale,
      recipientEmail: await deliveryEmailOf(tx, confirmed.participantId),
      payload: {},
      idempotencyKey: `registration:${confirmed.id}:confirmed:${now.toISOString()}`,
      now,
    });
    await enqueueDeclarationCopies(tx, confirmed, now);
    await enqueueClubConfirmationNotice(tx, confirmed, now);

    // The expiry above may have released somebody *else's* lapsed hold to the queue — this
    // signature is the capacity-changing transaction that saw it, and no other will until the
    // job's next tick. Offer what it freed before the lock is let go (AGENTS.md §10.6).
    await fillAvailableSpots(tx, locked, now);

    return confirmed;
  });
}

/**
 * The club's copy of a signed declaration (§99, §244): the same PDF to the mailbox the club
 * named on `/admin/emails`, with the copies it asked for. The participant's own copy rides on
 * the confirmation since §126 — the PDF attached to the one message they keep — rather than as
 * a message of its own (the owner: "we need to minimize the number of emails"). The copy
 * carries no action link (a manage token in the club's mailbox would be a secret handed to the
 * wrong person, §12.8) and is not sent for a test registration: a synthetic runner's
 * declaration is not a record the club keeps.
 *
 * The `cc` and `bcc` lists travel in the payload rather than being looked up at send time, so
 * the row is a faithful record of what this confirmation asked for: a list edited tomorrow
 * changes tomorrow's copies, not the ones already queued.
 */
async function enqueueDeclarationCopies<T extends Record<string, unknown>>(
  tx: Transaction<T>,
  confirmed: Registration,
  now: Date,
): Promise<void> {
  if (confirmed.kind !== "REAL") return;
  const copies = resolveDeclarationCopies(await readClubNotices(tx), env.DECLARATIONS_ARCHIVE_TO);
  if (!copies.to) return;
  await enqueueEmail(tx, {
    participantId: confirmed.participantId,
    registrationId: confirmed.id,
    messageType: "DECLARATION_ARCHIVE",
    // The club reads Romanian; the message is bilingual regardless (§96).
    locale: "ro",
    recipientEmail: copies.to,
    payload: { cc: [...copies.cc], bcc: [...copies.bcc] },
    idempotencyKey: `registration:${confirmed.id}:declaration-archive:${now.toISOString()}`,
    now,
  });
}

/**
 * "Somebody has confirmed" (§245): one message to each mailbox the club named, with the
 * runner's name, the event and the number — and nothing a participant could act on.
 *
 * One row per address rather than one row with copies, unlike the declaration above: these are
 * separate notices to separate people, none of whom needs to see who else was told, and a
 * failure to reach one mailbox should not hold up another. A test registration is invisible
 * here as everywhere the club is told something (§12.6).
 */
async function enqueueClubConfirmationNotice<T extends Record<string, unknown>>(
  tx: Transaction<T>,
  confirmed: Registration,
  now: Date,
): Promise<void> {
  if (confirmed.kind !== "REAL") return;
  const recipients = confirmationNoticeRecipients(await readClubNotices(tx));
  for (const recipient of recipients) {
    await enqueueEmail(tx, {
      participantId: confirmed.participantId,
      registrationId: confirmed.id,
      messageType: "CLUB_CONFIRMATION_NOTICE",
      locale: "ro",
      recipientEmail: recipient,
      payload: {},
      // One notice per mailbox per confirmation: the address is part of the trigger, or the
      // second recipient's row would collide with the first's key and never be written.
      idempotencyKey: `registration:${confirmed.id}:club-confirmed:${recipient.toLowerCase()}:${now.toISOString()}`,
      now,
    });
  }
}

// --- §15.5 Self-unregistration, and offer decline (the same transition) ---------------------

/** A confirmed registration made before codes existed gets one the first time it is needed. */
export async function ensureCheckinCode<T extends Record<string, unknown>>(
  db: Database<T>,
  registrationId: string,
): Promise<string> {
  const current = await repo.findRegistrationById(db, registrationId);
  if (!current) throw new DomainError("NOT_FOUND", "no such registration");
  if (current.checkinCode) return current.checkinCode;
  const code = newCheckinCode();
  await db.update(registrations).set({ checkinCode: code }).where(eq(registrations.id, registrationId));
  return code;
}

type StaffActor = { id: string };

/**
 * The declaration, signed on paper at the desk and recorded by a member of staff
 * (BR-REQ-037-07, `DECISIONS.md` §67).
 *
 * The participant still signs — a printed copy of the current approved version, which the
 * desk holds — and what staff record is that fact, under their own id. The row is the same
 * shape as an email-link acceptance with `method = PAPER`, so everything downstream (the
 * version it binds, the hash, the count on the legal page) reads it identically. No approved
 * declaration means no confirmation, exactly as for the email path.
 */
async function acceptDeclarationOnPaper<T extends Record<string, unknown>>(
  tx: Transaction<T>,
  event: EventForRegistration,
  current: Registration,
  actor: StaffActor,
  now: Date,
): Promise<Registration> {
  const document = await findCurrentApprovedDocument(tx, "EVENT_DECLARATION", current.locale, now);
  if (!document) {
    throw new DomainError("VALIDATION_ERROR", "no approved declaration exists for this locale");
  }
  await repo.insertDeclarationAcceptance(tx, {
    registrationId: current.id,
    legalDocumentId: document.id,
    declarationVersion: document.version,
    contentSha256: document.contentSha256,
    locale: current.locale,
    typedName: current.registeredName,
    acceptedAt: now,
    method: "PAPER",
    attestedByStaffUserId: actor.id,
  });
  const confirmed = await repo.transitionRegistration(tx, {
    id: current.id,
    to: "CONFIRMED",
    fromStatuses: ["PENDING_DECLARATION", "WAITLIST_OFFERED"],
    changes: {
      confirmedAt: now,
      holdExpiresAt: null,
      checkinCode: current.checkinCode ?? newCheckinCode(),
      // As in `signDeclaration` (§214): nothing while the window is open, the next free
      // number once it has shut — which is every walk-in confirmed at the desk on race day.
      ...(await finalBibAtConfirmation(tx, event, current, now)),
    },
    now,
  });
  if (!confirmed) throw new DomainError("CONFLICT", "this registration changed state concurrently");

  await enqueueEmail(tx, {
    participantId: confirmed.participantId,
    registrationId: confirmed.id,
    messageType: "REGISTRATION_CONFIRMED",
    locale: confirmed.locale,
    recipientEmail: await deliveryEmailOf(tx, confirmed.participantId),
    payload: {},
    idempotencyKey: `registration:${confirmed.id}:confirmed:${now.toISOString()}`,
    now,
  });
  // The copy of the paper declaration's record, by email, as after an electronic signature (§95).
  await enqueueDeclarationCopies(tx, confirmed, now);
  await enqueueClubConfirmationNotice(tx, confirmed, now);
  return confirmed;
}

/**
 * Confirm a registration at the desk, from whatever pending state it is in (BR-REQ-037-07).
 *
 * The same allocator, the same lock, the same queue: a person whose address was vouched for by
 * staff still waits their turn if the event is full — this returns WAITLISTED then, and says
 * so. What it skips is the two emails: the address is attested by the member of staff whose id
 * goes on the row, and the declaration is on paper in front of them.
 *
 * A declaration hold past its deadline is confirmed like any other (§160): the place was kept
 * for this person and still counts as theirs, so the paper signed at the desk on race morning
 * is exactly the lenience the owner asked for — "they sign it right on race day before picking
 * up the kit". Nothing here re-checks capacity for it, because the hold never stopped
 * occupying the place. And once the gun has gone the same hold *is* released — by the start,
 * not by anybody's fault — while the kit table is still open: that row is re-allocated here
 * rather than refused, so the person standing at the desk with their paper is confirmed if
 * the place is still free and told they are on the list if it is not.
 */
export async function confirmByStaff<T extends Record<string, unknown>>(
  db: Database<T>,
  event: EventForRegistration,
  registrationId: string,
  actor: StaffActor,
  now: Date,
): Promise<Registration> {
  return db.transaction(async (tx) => {
    const lockedEvent = await repo.lockEventForCapacity(tx, event.id);
    if (!lockedEvent) throw new DomainError("NOT_FOUND", "no such event");

    let current = await repo.findRegistrationById(tx, registrationId);
    if (!current) throw new DomainError("NOT_FOUND", "no such registration");
    if (current.status === "CONFIRMED") return current;

    if (current.status === "PENDING_EMAIL_CONFIRMATION") {
      await tx
        .update(registrations)
        .set({ emailConfirmedAt: now, emailConfirmedByStaffUserId: actor.id, updatedAt: now })
        .where(eq(registrations.id, current.id));
      current = await allocateOrWaitlist(tx, withLockedRow(event, lockedEvent), current.id, now);
    }
    // A hold the event's own start released, and nothing else: the allocator decides again,
    // exactly as `signDeclaration` does for a signature that arrives at the same moment.
    if (current.status === "EXPIRED" && current.expiryReason === "DECLARATION_HOLD_LAPSED") {
      current = await allocateOrWaitlist(tx, withLockedRow(event, lockedEvent), current.id, now);
    }
    if (current.status === "PENDING_DECLARATION" || current.status === "WAITLIST_OFFERED") {
      return acceptDeclarationOnPaper(tx, withLockedRow(event, lockedEvent), current, actor, now);
    }
    if (current.status === "WAITLISTED") return current;
    throw new DomainError("CONFLICT", `a registration in status ${current.status} cannot be confirmed`);
  });
}

/**
 * Give a waiting-list registration a place ahead of its turn — the exceptional promotion of
 * AGENTS.md §2 (M2) — only into a place that is actually free. Never past capacity: the count
 * is the allocator's own, under the same lock, and "full" is refused with a sentence. The
 * queue is jumped on purpose and the audit row says who did it.
 */
export async function promoteFromWaitlistByStaff<T extends Record<string, unknown>>(
  db: Database<T>,
  event: EventForRegistration,
  registrationId: string,
  actor: StaffActor,
  now: Date,
): Promise<Registration> {
  return db.transaction(async (tx) => {
    const lockedEvent = await repo.lockEventForCapacity(tx, event.id);
    if (!lockedEvent) throw new DomainError("NOT_FOUND", "no such event");
    const locked = withLockedRow(event, lockedEvent);
    await repo.expireStaleHolds(tx, locked, now);

    const current = await repo.findRegistrationById(tx, registrationId);
    if (!current) throw new DomainError("NOT_FOUND", "no such registration");
    if (current.status !== "WAITLISTED") {
      throw new DomainError("CONFLICT", `only a waiting-list registration can be promoted; this one is ${current.status}`);
    }
    const occupied = computeOccupied(await repo.countOccupied(tx, event.id, now));
    if (lockedEvent.capacity !== null && occupied >= lockedEvent.capacity) {
      throw new DomainError("VALIDATION_ERROR", "the event is full: no place is free to promote into");
    }
    const offered = await repo.transitionRegistration(tx, {
      id: current.id,
      to: "WAITLIST_OFFERED",
      fromStatuses: ["WAITLISTED"],
      changes: { offerCreatedAt: now, holdExpiresAt: now },
      now,
    });
    if (!offered) throw new DomainError("CONFLICT", "this registration changed state concurrently");
    const confirmed = await acceptDeclarationOnPaper(tx, locked, offered, actor, now);
    // As in `signDeclaration`: the expiry above may have released another person's lapsed
    // hold to the queue, and this transaction is the one holding the lock that can offer it.
    await fillAvailableSpots(tx, locked, now);
    return confirmed;
  });
}

/**
 * Check-in (BR-REQ-037-08): the participant is here. By staff at the desk, or by the
 * participant from their own link — `checkedInBy` null. Idempotent; undoing it is its own call.
 */
export async function checkIn<T extends Record<string, unknown>>(
  db: Database<T>,
  registrationId: string,
  checkedInBy: StaffActor | null,
  now: Date,
): Promise<Registration> {
  const current = await repo.findRegistrationById(db, registrationId);
  if (!current) throw new DomainError("NOT_FOUND", "no such registration");
  if (current.status !== "CONFIRMED") {
    throw new DomainError("CONFLICT", `only a confirmed registration can check in; this one is ${current.status}`);
  }
  // The race is over (§82): nobody arrives at a completed event, and a check-in after the
  // organizer closed it would count somebody who was never there.
  const [event] = await db
    .select({ eventStatus: events.eventStatus })
    .from(events)
    .where(eq(events.id, current.eventId))
    .limit(1);
  if (event?.eventStatus === "COMPLETED") {
    throw new DomainError("VALIDATION_ERROR", "the event is completed; the desk is closed");
  }
  if (current.checkedInAt) return current;
  const [updated] = await db
    .update(registrations)
    .set({ checkedInAt: now, checkedInByStaffUserId: checkedInBy?.id ?? null, updatedAt: now })
    .where(eq(registrations.id, registrationId))
    .returning();
  return updated;
}

export async function undoCheckIn<T extends Record<string, unknown>>(
  db: Database<T>,
  registrationId: string,
  now: Date,
): Promise<Registration> {
  const [updated] = await db
    .update(registrations)
    .set({ checkedInAt: null, checkedInByStaffUserId: null, updatedAt: now })
    .where(eq(registrations.id, registrationId))
    .returning();
  if (!updated) throw new DomainError("NOT_FOUND", "no such registration");
  return updated;
}

export async function unregister<T extends Record<string, unknown>>(
  db: Database<T>,
  event: EventForRegistration,
  registrationId: string,
  source: "PARTICIPANT" | "ADMIN",
  now: Date,
): Promise<Registration> {
  return db.transaction(async (tx) => {
    const lockedEvent = await repo.lockEventForCapacity(tx, event.id);
    if (!lockedEvent) throw new DomainError("NOT_FOUND", "no such event");

    const current = await repo.findRegistrationById(tx, registrationId);
    if (!current) throw new DomainError("NOT_FOUND", "no such registration");

    // Idempotent: opening the cancel link twice must not error the second time.
    if (current.status === "CANCELLED") return current;

    if (source === "PARTICIPANT" && now >= event.startsAt) {
      throw new DomainError("VALIDATION_ERROR", "this event has already started");
    }

    const cancelled = await repo.transitionRegistration(tx, {
      id: registrationId,
      to: "CANCELLED",
      fromStatuses: allowedFromStatuses("CANCELLED"),
      changes: { cancelledAt: now, cancellationSource: source },
      now,
    });
    if (!cancelled) {
      throw new DomainError("CONFLICT", "this registration changed state concurrently");
    }

    await enqueueEmail(tx, {
      participantId: cancelled.participantId,
      registrationId: cancelled.id,
      messageType: "REGISTRATION_CANCELLED",
      locale: cancelled.locale,
      recipientEmail: await deliveryEmailOf(tx, cancelled.participantId),
      payload: {},
      idempotencyKey: `registration:${cancelled.id}:cancelled:${now.toISOString()}`,
      now,
    });

    await fillAvailableSpots(tx, withLockedRow(event, lockedEvent), now);

    return cancelled;
  });
}
