import { getDb } from "@/db/client";
import { inReadOnlyTransaction } from "@/db/read-only";
import type { EmailActionTokenPurpose } from "@/db/schema/email-action-tokens";
import type { Locale } from "@/i18n/routing";
import { TOKEN_NOT_FOUND, type TokenRejectionReason } from "@/modules/action-tokens/domain/token-state";
import {
  consumeActionToken,
  readActionTokenContext,
  readSpentActionTokenScope,
} from "@/modules/action-tokens/repository";
import { tokenAttemptAllowed } from "@/modules/action-tokens/throttle";
import { findEventForRegistrationById, findEventNotificationDetails } from "@/modules/events/repository";
import { DomainError } from "@/shared/errors/domain-error";
import {
  describeActionLink,
  mayReportState,
  type SpentLinkMessage,
  type SpentLinkNext,
  type SpentLinkStep,
  stepForSpentLink,
} from "./domain/link-status";
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
  options: { charge?: boolean } = {},
) {
  const db = getDb();
  const now = new Date();

  /*
    One request, one attempt (§202, found in review).

    The declaration page reads the same token twice — once as a declaration link and once as a
    waiting-list offer, because one link serves both purposes (§15.7) — and each read used to
    spend one of the ten attempts an hour the throttle allows. So a person reloading a spent
    link five times exhausted the bucket, and an exhausted bucket answers `TOKEN_NOT_FOUND`,
    which is not eligible for the status page: the screen fell back to exactly the "this link is
    no longer valid" the status page exists to replace.

    The throttle is there to bound guessing, and a second read of a secret already presented in
    the same request guesses nothing. `charge: false` is for that second read, and for nothing
    else — the first read of any request still pays.
  */
  if (options.charge !== false && !(await tokenAttemptAllowed(db, secret, now))) return TOKEN_NOT_FOUND;

  return readActionTokenContext(db, { secret, purpose, now });
}

/** What a page shows instead of "this link is no longer valid" (`domain/link-status.ts`). */
export type SpentRegistrationLink = {
  message: SpentLinkMessage;
  next: SpentLinkNext;
  /** Which step of the journey to light up, or null when the journey is over. */
  step: SpentLinkStep | null;
  /** The event the link already named. Null when it has no translation in this locale. */
  eventTitle: string | null;
  /** For the "ask for it again" and "register again" links; both fall back to the listing. */
  eventSlug: string | null;
};

/**
 * Where a person stands, when the link they pressed was already spent (BR-REQ-036-02).
 *
 * Returns null whenever the page must fall back to §13.2's one generic refusal, which is every
 * case but `ALREADY_USED` on a registration-scoped purpose — `link-status.ts` argues each one.
 *
 * Nothing here consumes, mints or extends anything, and it is reached from a GET: the two
 * reads are a read-only-transaction scope lookup and the registration's own row.
 *
 * `refusals` is a list because the declaration page presents one link against two purposes
 * (`COMPLETE_DECLARATION`, then `WAITLIST_OFFER` — §15.7), and only one of them can be the
 * token's real purpose; the other comes back as `PURPOSE_MISMATCH`, which is never eligible.
 * The first eligible entry wins, and `readSpentActionTokenScope` re-checks it against the row
 * rather than trusting what the caller passed.
 *
 * No throttle charge of its own: the route already charged one attempt for this request, and
 * charging a second would halve the allowance of the one person whose link this is.
 */
export async function readSpentRegistrationLink(
  secret: string,
  refusals: readonly { purpose: EmailActionTokenPurpose; reason: TokenRejectionReason }[],
  locale: Locale,
  now: Date,
): Promise<SpentRegistrationLink | null> {
  const eligible = refusals.find((refusal) => mayReportState(refusal.purpose, refusal.reason));
  if (!eligible) return null;

  /*
    All three reads inside one read-only transaction (§202, found in review).

    This runs on a GET, and "GET never mutates" is structural here rather than a promise:
    PostgreSQL refuses any write inside a `READ ONLY` transaction (`db/read-only.ts`). Only
    the token read used to be inside one; the registration and the event were bare selects on
    the pool, which is the same guarantee held by convention instead of by the database. One
    transaction also means the three reads see one snapshot, so the state reported and the
    event named cannot come from either side of a concurrent change.
  */
  return inReadOnlyTransaction(getDb(), async (tx) => {
    const scope = await readSpentActionTokenScope(tx, { secret, purpose: eligible.purpose, now });
    if (!scope?.registrationId) return null;

    const registration = await findRegistrationById(tx, scope.registrationId);
    // Erased under §67, or gone with its event: there is no state to report, so the generic
    // refusal is the honest answer rather than a sentence about a row that no longer exists.
    if (!registration) return null;

    const view = describeActionLink({
      purpose: eligible.purpose,
      reason: eligible.reason,
      status: registration.status,
    });
    if (view.view !== "ALREADY_DONE") return null;

    const event = await findEventNotificationDetails(tx, registration.eventId, locale);

    return {
      message: view.message,
      next: view.next,
      step: stepForSpentLink(view.message),
      /*
        This locale's own words, or none (§202). `findEventNotificationDetails` falls back to
        the other language's row when the asked-for one is missing — right for an email, which
        must go out with something — and wrong here, because the slug is built into a link for
        *this* locale. A foreign slug would produce an address that 404s. No translation in
        this language means no event link, and the page falls back to the listing.
      */
      eventTitle: event?.locale === locale ? event.title : null,
      eventSlug: event?.locale === locale ? event.slug : null,
    };
  });
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
  input: {
    accepted: boolean;
    typedName: string;
    idDocument?: string;
    /** A minor's own signature and document, beside the parent's (§NNN); absent for an adult. */
    minorTypedName?: string;
    minorIdDocument?: string;
    documentId: string;
    contentSha256: string;
  },
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
  // A cancelled race has no race day (§NNN): the page says so, and offers no desk code or "I am here".
  const eventCancelled = event.eventStatus === "CANCELLED";
  return {
    ok: true as const,
    registration,
    eventCancelled,
    selfCheckinOpen: registration.status === "CONFIRMED" && !eventCancelled && now >= opensAt,
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
