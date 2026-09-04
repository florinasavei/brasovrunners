import { getDb } from "@/db/client";
import { consumeActionToken, readActionTokenContext } from "@/modules/action-tokens/repository";
import { findEventForRegistrationById } from "@/modules/events/repository";
import { DomainError } from "@/shared/errors/domain-error";
import { confirmEmail, type EventForRegistration, signDeclaration, unregister } from "./service";
import { findRegistrationById } from "./repository";

/**
 * Wiring the email-token boundary (§13.2) to the registration lifecycle (§15).
 *
 * Every consuming function opens exactly one transaction that both spends the token and
 * performs the resulting state change — `consumeActionToken`'s single UPDATE and
 * `confirmEmail`/`signDeclaration`/`unregister`'s own `db.transaction()` nest as a savepoint,
 * so a token is never burned without its effect landing, and never left live if the effect
 * fails. The three routes under `app/[locale]/registrations/*` are thin wrappers over these.
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
  return readActionTokenContext(getDb(), { secret, purpose, now: new Date() });
}

export async function consumeAndConfirmEmail(secret: string, now: Date) {
  const db = getDb();
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
  input: { accepted: boolean; typedName: string },
  now: Date,
) {
  const db = getDb();
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

export async function consumeAndCancel(secret: string, now: Date) {
  const db = getDb();
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
