import { eq } from "drizzle-orm";
import { type Participant, participants } from "@/db/schema/participants";
import type { Registration, RegistrationKind } from "@/db/schema/registrations";
import { registrations } from "@/db/schema/registrations";
import type { Database, Transaction } from "@/db/types";
import { registrationState } from "@/modules/events/domain/registration-window";
import { findCurrentApprovedDocument } from "@/modules/legal-documents/repository";
import { enqueueEmail } from "@/modules/notifications/outbox";
import { canonicalizeEmail } from "@/modules/participants/domain/canonical-email";
import { findOrCreateParticipant, markEmailVerified } from "@/modules/participants/repository";
import { DomainError } from "@/shared/errors/domain-error";
import { computeOccupied, hasDirectAvailability } from "./domain/capacity";
import { computeDeclarationHoldExpiry, computeWaitlistOfferExpiry } from "./domain/hold-deadlines";
import { allowedFromStatuses, isActiveStatus } from "./domain/state-machine";
import { declarationSigningSchema, registrationSubmissionSchema } from "./fields";
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
};

function assertRegistrationOpen(event: EventForRegistration, now: Date): void {
  if (event.registrationMode !== "INTERNAL") {
    throw new DomainError("VALIDATION_ERROR", "this event does not accept local registration");
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
 * cancellation, an offer's decline or expiry, and a future capacity increase. The caller must
 * already hold the event-row lock; this does not take it itself, so it composes safely with
 * `allocateOrWaitlist`, which calls it after locking once.
 */
export async function fillAvailableSpots<T extends Record<string, unknown>>(
  db: Transaction<T>,
  event: EventForRegistration,
  now: Date,
): Promise<void> {
  await repo.expireStaleHolds(db, event.id, now);

  // "For unlimited events there is no waitlist promotion" — there is also no waiting list to
  // promote from, since nothing is ever waitlisted against an uncapped event.
  if (event.capacity === null) return;

  const occupied = computeOccupied(await repo.countOccupied(db, event.id, now));
  const availablePlaces = Math.max(event.capacity - occupied, 0);
  if (availablePlaces <= 0) return;

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
  }
}

// --- Spam defenses (AGENTS.md §19.4, WEEKEND.md) ---------------------------------------------

/** Below this, a submission is answered as if it never happened at all — never with a distinct
 * error, which would tell a bot which check it tripped. */
const MIN_SUBMISSION_SECONDS = 3;

function looksLikeSpam(input: { honeypot: string; renderedAt: string }, now: Date): boolean {
  if (input.honeypot !== "") return true;
  const renderedAt = new Date(input.renderedAt);
  if (Number.isNaN(renderedAt.getTime())) return true;
  return now.getTime() - renderedAt.getTime() < MIN_SUBMISSION_SECONDS * 1000;
}

// --- §15.1 Registration submission ------------------------------------------------------------

export type SubmitRegistrationResult = { ok: true };

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
): Promise<SubmitRegistrationResult> {
  assertRegistrationOpen(event, now);

  const parsed = registrationSubmissionSchema.safeParse(rawInput);
  if (!parsed.success) {
    throw new DomainError(
      "VALIDATION_ERROR",
      parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; "),
    );
  }
  const input = parsed.data;

  if (looksLikeSpam(input, now)) return { ok: true };

  const privacyNotice = await findCurrentApprovedDocument(db, "PRIVACY_NOTICE", input.locale, now);
  if (!privacyNotice) {
    throw new DomainError(
      "VALIDATION_ERROR",
      "no approved privacy notice exists yet; registration cannot be accepted",
    );
  }

  const identity = canonicalizeEmail(input.email);

  await db.transaction(async (tx) => {
    const participant = await findOrCreateParticipant(tx, identity, input.name, input.locale, now);
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
      registeredName: input.name,
      privacyNoticeVersion: privacyNotice.version,
      privacyAcknowledgedAt: now,
      resultsNameConsent: input.resultsNameConsent,
      resultsConsentVersion: privacyNotice.version,
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
        if (restarted) await enqueueVerificationEmail(tx, participant, restarted, now);
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
      registeredName: input.name,
      privacyNoticeVersion: privacyNotice.version,
      privacyAcknowledgedAt: now,
      raceId: event.raceId,
      resultsNameConsent: input.resultsNameConsent,
      resultsConsentVersion: privacyNotice.version,
      now,
    });
    await enqueueVerificationEmail(tx, participant, created, now);
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
    const allocated = await allocateOrWaitlist(tx, event, current.id, now);

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
      current = await allocateOrWaitlist(tx, event, registrationId, now);
      if (current.status === "WAITLISTED") return current; // no declaration requested yet
    }

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
      typedName: parsed.data.typedName,
      acceptedAt: now,
    });

    const confirmed = await repo.transitionRegistration(tx, {
      id: current.id,
      to: "CONFIRMED",
      fromStatuses: ["PENDING_DECLARATION", "WAITLIST_OFFERED"],
      changes: { confirmedAt: now, holdExpiresAt: null },
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

    return confirmed;
  });
}

// --- §15.5 Self-unregistration, and offer decline (the same transition) ---------------------

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

    await fillAvailableSpots(tx, event, now);

    return cancelled;
  });
}
