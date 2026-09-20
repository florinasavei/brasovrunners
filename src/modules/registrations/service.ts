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
import { registrationState } from "@/modules/events/domain/registration-window";
import { findCurrentApprovedDocument } from "@/modules/legal-documents/repository";
import { enqueueEmail } from "@/modules/notifications/outbox";
import { pickBibNumber } from "./bibs";
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
import { DomainError } from "@/shared/errors/domain-error";
import { computeOccupied, computePublicAvailability, hasDirectAvailability } from "./domain/capacity";
import { computeDeclarationHoldExpiry, computeWaitlistOfferExpiry, confirmationWindow } from "./domain/hold-deadlines";
import { deriveAllowedResendMessageType } from "./domain/resend";
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
 * The event as the allocator must see it once the row is locked: the caller's row, with the
 * places as they stand *now*. The caller read its `capacity` before the lock, and a number
 * raised in the editor (§147) between that read and this lock would otherwise waitlist a person
 * against the old number while the new places stood free until the allocator's next visit.
 */
function withLockedCapacity(event: EventForRegistration, locked: { capacity: number | null }): EventForRegistration {
  return event.capacity === locked.capacity ? event : { ...event, capacity: locked.capacity };
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
 */
async function allocateOrWaitlist<T extends Record<string, unknown>>(
  db: Transaction<T>,
  event: EventForRegistration,
  registrationId: string,
  now: Date,
): Promise<Registration> {
  await repo.expireStaleHolds(db, event.id, now);
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
  return updated;
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
  await repo.expireStaleHolds(db, event.id, now);

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
 * expire a lapsed hold on the way past — `countOccupied` compares `hold_expires_at` against
 * `now` itself, which is what makes criterion 3 true without writing anything. It takes no lock
 * for the same reason: nothing is being decided here, and a page that blocked behind a
 * confirmation's row lock would be slower for no gain in truth. The number can be one place
 * stale the instant it is rendered, and the allocator is what actually holds the guarantee.
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

/** Below this, a submission is answered as if it never happened at all — never with a distinct
 * error, which would tell a bot which check it tripped. */
const MIN_SUBMISSION_SECONDS = 3;

/** Shared with the interest form (`interest.ts`, §146): one rule for every public form. */
export function looksLikeSpam(input: { honeypot?: string; renderedAt?: string }, now: Date): boolean {
  if ((input.honeypot ?? "") !== "") return true;
  // An absent value parses to `Invalid Date`, which the guard below rejects — a public
  // submission that lost its timestamp is treated as a bot rather than waved through.
  const renderedAt = new Date(input.renderedAt ?? "");
  if (Number.isNaN(renderedAt.getTime())) return true;
  return now.getTime() - renderedAt.getTime() < MIN_SUBMISSION_SECONDS * 1000;
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
};

const PUBLIC_ORIGIN: RegistrationOrigin = { source: "PUBLIC", createdByStaffUserId: null };

async function enqueueVerificationEmail<T extends Record<string, unknown>>(
  db: Transaction<T>,
  participant: Participant,
  registration: Registration,
  now: Date,
): Promise<void> {
  await enqueueEmail(db, {
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
  if (origin.source === "PUBLIC" && looksLikeSpam(input, now)) return { ok: true };

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
   * Refused the same way the honeypot and the timing check are refused: the generic success of
   * BR-REQ-031-01 criterion 3. A distinct "you are being rate limited" would tell a script
   * exactly which defence it tripped and how long to wait, and the participant whose first
   * submission worked has already had their email.
   *
   * Staff-entered registrations skip it, like the spam checks above: an Administrator adding
   * people at a desk is the case this must not obstruct, and they are already authenticated
   * and authorized.
   */
  if (origin.source === "PUBLIC") {
    const verdict = await consumeRateLimit(db, "registration-submit", identity.canonicalEmail, now);
    if (!verdict.allowed) return { ok: true };
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
    clubName: input.clubName ?? null,
    // Kept only for a minor: an adult who typed a name into the folded field named nobody's guardian.
    guardianName: input.birthDate && isMinorOn(input.birthDate, now) && input.guardianName ? input.guardianName : null,
    stravaUrl: input.stravaUrl ?? null,
    instagramHandle: input.instagramHandle ?? null,
    clubMemberDeclared: input.clubMemberDeclared,
    tshirtSize: input.tshirtSize,
    healthNotes,
    healthConsentVersion: healthNotes ? privacyNotice.version : null,
    healthConsentAt: healthNotes ? now : null,
  };

  await db.transaction(async (tx) => {
    const participant = await findOrCreateParticipant(tx, identity, legalName, input.locale, now);
    const existing = await repo.findRegistrationByEventAndParticipant(tx, event.id, participant.id);

    if (existing && isActiveStatus(existing.status)) {
      // Already registered at some stage; resubmitting the form only helps if the first
      // confirmation email never arrived.
      if (existing.status === "PENDING_EMAIL_CONFIRMATION") {
        await enqueueVerificationEmail(tx, participant, existing, now);
      }
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

      const allocated = await allocateOrWaitlist(tx, event, existing.id, now);
      await enqueueEmail(tx, {
        participantId: participant.id,
        registrationId: allocated.id,
        messageType: allocated.status === "WAITLISTED" ? "WAITLIST_JOINED" : "COMPLETE_DECLARATION",
        locale: input.locale,
        recipientEmail: participant.deliveryEmail,
        payload: {},
        idempotencyKey: `registration:${allocated.id}:restart:${now.toISOString()}`,
        now,
      });
      return;
    }

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
    const allocated = await allocateOrWaitlist(tx, withLockedCapacity(event, lockedEvent), current.id, now);

    await enqueueEmail(tx, {
      participantId: current.participantId,
      registrationId: allocated.id,
      messageType: allocated.status === "WAITLISTED" ? "WAITLIST_JOINED" : "COMPLETE_DECLARATION",
      locale: current.locale,
      recipientEmail: await deliveryEmailOf(tx, current.participantId),
      payload: {},
      idempotencyKey: `registration:${allocated.id}:email-confirmed:${now.toISOString()}`,
      now,
    });

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
    );
  }

  return db.transaction(async (tx) => {
    const lockedEvent = await repo.lockEventForCapacity(tx, event.id);
    if (!lockedEvent) throw new DomainError("NOT_FOUND", "no such event");

    const before = await repo.findRegistrationById(tx, registrationId);
    if (!before) throw new DomainError("NOT_FOUND", "no such registration");
    if (before.status !== "PENDING_DECLARATION" && before.status !== "WAITLIST_OFFERED") {
      throw new DomainError("CONFLICT", `a declaration cannot be signed from status ${before.status}`);
    }

    // Re-verify the hold is still live at the moment of signing — never trusting that it was
    // live when the page was rendered (§15.3 step 6; §10.6: evaluated against `now`).
    await repo.expireStaleHolds(tx, event.id, now);
    let current = await repo.findRegistrationById(tx, registrationId);
    if (!current) throw new DomainError("NOT_FOUND", "no such registration");

    if (current.status === "EXPIRED") {
      // The hold lapsed at the very moment of signing (§15.3 step 7): re-run allocation
      // rather than simply refusing a place that might still be free.
      current = await allocateOrWaitlist(tx, withLockedCapacity(event, lockedEvent), registrationId, now);
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
        // The race number, at the moment the place is certain (§87): under the event lock
        // held above. A test registration wears none, as in the batch assignment.
        bibNumber: current.bibNumber ?? (current.kind === "REAL" ? await pickBibNumber(tx, current.eventId) : null),
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

    return confirmed;
  });
}

/**
 * The club's copy of a signed declaration (§99): when the club has named an archive mailbox,
 * the same PDF to `DECLARATIONS_ARCHIVE_TO`. The participant's own copy rides on the
 * confirmation since §126 — the PDF attached to the one message they keep — rather than as a
 * message of its own (the owner: "we need to minimize the number of emails"). The archive
 * copy carries no action link (a manage token in the club's mailbox would be a secret handed
 * to the wrong person, §12.8) and is not sent for a test registration: a synthetic runner's
 * declaration is not a record the club keeps.
 */
async function enqueueDeclarationCopies<T extends Record<string, unknown>>(
  tx: Transaction<T>,
  confirmed: Registration,
  now: Date,
): Promise<void> {
  if (env.DECLARATIONS_ARCHIVE_TO && confirmed.kind === "REAL") {
    await enqueueEmail(tx, {
      participantId: confirmed.participantId,
      registrationId: confirmed.id,
      messageType: "DECLARATION_ARCHIVE",
      // The club reads Romanian; the message is bilingual regardless (§96).
      locale: "ro",
      recipientEmail: env.DECLARATIONS_ARCHIVE_TO,
      payload: {},
      idempotencyKey: `registration:${confirmed.id}:declaration-archive:${now.toISOString()}`,
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
      bibNumber: current.bibNumber ?? (current.kind === "REAL" ? await pickBibNumber(tx, current.eventId) : null),
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
  return confirmed;
}

/**
 * Confirm a registration at the desk, from whatever pending state it is in (BR-REQ-037-07).
 *
 * The same allocator, the same lock, the same queue: a person whose address was vouched for by
 * staff still waits their turn if the event is full — this returns WAITLISTED then, and says
 * so. What it skips is the two emails: the address is attested by the member of staff whose id
 * goes on the row, and the declaration is on paper in front of them.
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
      current = await allocateOrWaitlist(tx, withLockedCapacity(event, lockedEvent), current.id, now);
    }
    if (current.status === "PENDING_DECLARATION" || current.status === "WAITLIST_OFFERED") {
      return acceptDeclarationOnPaper(tx, current, actor, now);
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
    await repo.expireStaleHolds(tx, event.id, now);

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
    return acceptDeclarationOnPaper(tx, offered, actor, now);
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

    await fillAvailableSpots(tx, withLockedCapacity(event, lockedEvent), now);

    return cancelled;
  });
}
