import { getDb } from "@/db/client";
import { TOKEN_NOT_FOUND } from "@/modules/action-tokens/domain/token-state";
import { consumeActionToken, readActionTokenContext } from "@/modules/action-tokens/repository";
import { tokenAttemptAllowed } from "@/modules/action-tokens/throttle";
import { findEventForRegistrationById } from "@/modules/events/repository";
import { DomainError } from "@/shared/errors/domain-error";
import { checkIn, confirmEmail, type EventForRegistration, signDeclaration, unregister } from "./service";
import { findRegistrationById } from "./repository";

/**
 * Wiring the email-token boundary (§13.2) to the registration lifecycle (§15).
 *
 * Every consuming function opens exactly one transaction that both spends the token and
 * performs the resulting state change — `consumeActionToken`'s single UPDATE and
 * `confirmEmail`/`signDeclaration`/`unregister`'s own `db.transaction()` nest as a savepoint,
 * so a token is never burned without its effect landing, and never left live if the effect
 * fails. The three routes under `app/[locale]/registrations/*` are thin wrappers over these.
 *
 * This is also the one place a presented token is throttled (§19.4, `action-tokens/throttle.ts`).
 * It goes here rather than in the repository because this is the boundary where one request is
 * one attempt: `consumeAndSignDeclaration` below tries two purposes for a single click, and a
 * throttle any deeper would charge that participant twice. A refusal returns `TOKEN_NOT_FOUND`,
 * which is what §13.2 requires anyway — one generic invalid-or-expired answer, never a hint
 * about which defence was tripped.
 */

async function loadEventForRegistration(
  db: Parameters<typeof findEventForRegistrationById>[0],
  eventId: string,
): Promise<EventForRegistration> {
  const event = await findEventForRegistrationById(db, eventId);
  if (!event) throw new DomainError("NOT_FOUND", "no such event");
  return {
    id: event.id,
    eventStatus: event.eventStatus,
    registrationMode: event.registrationMode,
    startsAt: event.startsAt,
    registrationOpensAt: event.registrationOpensAt,
    registrationClosesAt: event.registrationClosesAt,
    confirmationOpensDaysBefore: event.confirmationOpensDaysBefore,
    confirmationDeadlineDaysBefore: event.confirmationDeadlineDaysBefore,
    capacity: event.capacity,
    raceId: event.raceId,
    publishedAt: null,
  };
}

/** What the GET page may show before anything is consumed (BR-REQ-036-02 criterion 4). */
export async function readRegistrationTokenContext(
  secret: string,
  purpose: "VERIFY_REGISTRATION_EMAIL" | "COMPLETE_DECLARATION" | "MANAGE_REGISTRATION" | "WAITLIST_OFFER",
) {
  const db = getDb();
  const now = new Date();

  if (!(await tokenAttemptAllowed(db, secret, now))) return TOKEN_NOT_FOUND;

  return readActionTokenContext(db, { secret, purpose, now });
}

export async function consumeAndConfirmEmail(secret: string, now: Date) {
  const db = getDb();

  if (!(await tokenAttemptAllowed(db, secret, now))) return TOKEN_NOT_FOUND;

  return db.transaction(async (tx) => {
    const consumed = await consumeActionToken(tx, { secret, purpose: "VERIFY_REGISTRATION_EMAIL", now });
    if (!consumed.ok) return consumed;

    const registration = await findRegistrationById(tx, consumed.token.registrationId ?? "");
    if (!registration) throw new DomainError("NOT_FOUND", "no such registration");
    const event = await loadEventForRegistration(tx, registration.eventId);

    const updated = await confirmEmail(tx, event, registration.id, now);
    return { ok: true as const, token: consumed.token, registration: updated };
  });
}

export async function consumeAndSignDeclaration(
  secret: string,
  input: { accepted: boolean; typedName: string; idDocument?: string; documentId: string; contentSha256: string },
  now: Date,
) {
  const db = getDb();

  if (!(await tokenAttemptAllowed(db, secret, now))) return TOKEN_NOT_FOUND;

  return db.transaction(async (tx) => {
    // Accepting a waiting-list offer is signing the declaration (§15.7): the same token
    // purpose is checked for either, in the order a live offer is more likely.
    let consumed = await consumeActionToken(tx, { secret, purpose: "COMPLETE_DECLARATION", now });
    if (!consumed.ok) {
      consumed = await consumeActionToken(tx, { secret, purpose: "WAITLIST_OFFER", now });
    }
    if (!consumed.ok) return consumed;

    const registration = await findRegistrationById(tx, consumed.token.registrationId ?? "");
    if (!registration) throw new DomainError("NOT_FOUND", "no such registration");
    const event = await loadEventForRegistration(tx, registration.eventId);

    const updated = await signDeclaration(tx, event, registration.id, input, now);
    return { ok: true as const, token: consumed.token, registration: updated };
  });
}

/** How long before the start a participant may say "I am here" from their own link. */
export const SELF_CHECKIN_OPENS_HOURS = 24;

/**
 * What the participant's own page shows about race day (BR-REQ-037-08): the desk code and
 * whether the self check-in window is open. The manage token is read, never spent — the same
 * link still has to cancel — and this reads nothing else.
 */
export async function readRaceDayContext(secret: string, now: Date) {
  const db = getDb();
  if (!(await tokenAttemptAllowed(db, secret, now))) return TOKEN_NOT_FOUND;
  const context = await readActionTokenContext(db, { secret, purpose: "MANAGE_REGISTRATION", now });
  if (!context.ok) return context;

  const registration = await findRegistrationById(db, context.token.registrationId ?? "");
  if (!registration) throw new DomainError("NOT_FOUND", "no such registration");
  const event = await loadEventForRegistration(db, registration.eventId);
  const opensAt = new Date(event.startsAt.getTime() - SELF_CHECKIN_OPENS_HOURS * 60 * 60_000);
  return {
    ok: true as const,
    registration,
    selfCheckinOpen: registration.status === "CONFIRMED" && now >= opensAt,
    selfCheckinOpensAt: opensAt,
  };
}

/**
 * Self check-in from the participant's own link (BR-REQ-037-08). Not a consuming action: the
 * token authorizes the person, check-in is idempotent, and spending the manage link on it
 * would cost them the ability to cancel. Only from the day before the start — an "I am here"
 * a week early is not information.
 */
export async function checkInSelf(secret: string, now: Date) {
  const context = await readRaceDayContext(secret, now);
  if (!context.ok) return context;
  if (!context.selfCheckinOpen) {
    throw new DomainError("VALIDATION_ERROR", "self check-in opens the day before the event");
  }
  const registration = await checkIn(getDb(), context.registration.id, null, now);
  return { ok: true as const, registration };
}

export async function consumeAndCancel(secret: string, now: Date) {
  const db = getDb();

  if (!(await tokenAttemptAllowed(db, secret, now))) return TOKEN_NOT_FOUND;

  return db.transaction(async (tx) => {
    const consumed = await consumeActionToken(tx, { secret, purpose: "MANAGE_REGISTRATION", now });
    if (!consumed.ok) return consumed;

    const registration = await findRegistrationById(tx, consumed.token.registrationId ?? "");
    if (!registration) throw new DomainError("NOT_FOUND", "no such registration");
    const event = await loadEventForRegistration(tx, registration.eventId);

    const updated = await unregister(tx, event, registration.id, "PARTICIPANT", now);
    return { ok: true as const, token: consumed.token, registration: updated };
  });
}
