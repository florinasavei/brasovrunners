import { eq } from "drizzle-orm";
import { inReadOnlyTransaction } from "@/db/read-only";
import { registrations } from "@/db/schema/registrations";
import type { Database } from "@/db/types";
import type { Locale } from "@/i18n/routing";
import { TOKEN_NOT_FOUND, type TokenRejection } from "@/modules/action-tokens/domain/token-state";
import { consumeActionToken, issueActionToken, readActionTokenContext } from "@/modules/action-tokens/repository";
import { tokenAttemptAllowed } from "@/modules/action-tokens/throttle";
import { recordAuditEvent } from "@/modules/audit/repository";
import { findEventNotificationDetails } from "@/modules/events/repository";
import { revalidatePublicContent } from "@/modules/public-cache/cache";
import { DomainError } from "@/shared/errors/domain-error";
import { findRegistrationById } from "./repository";

/**
 * The participant's own switch for the public participant list, after registration
 * (BR-REQ-039-01; `DECISIONS.md` §32, §143, §186).
 *
 * The form asks "Vreau să apar pe lista de participanți" once, at registration; §143 recorded
 * that the answer is withdrawn "by writing to the club". This module is the self-service form of
 * that sentence — the owner: "people should be able to choose to not be shown on the public
 * list if they don't want to, even after the registration, basically they can do that via
 * email." Three doors, one write:
 *
 *   - the link in the confirmation email, its own token (`LIST_CONSENT`): a GET that shows the
 *     current choice, a POST that sets it, spends the token and hands back a fresh one;
 *   - "Înscrierile mele" (§77), a button per registration under the `MANAGE_PROFILE` link;
 *   - the registration's own manage page, under the `MANAGE_REGISTRATION` link.
 *
 * The last two read their token and never spend it, exactly as "I am here" does (§77): the
 * choice is reversible and low-stakes, and spending a link on it would cost the person the
 * cancel button on the same page. The first spends it because §12.8 says an action link is
 * used once, and it can afford to — the page it lands on carries the fresh link.
 *
 * What the write is: `list_opt_out` set, `updated_at` bumped, and one audit row saying the
 * shape of the change — LISTED to NOT_LISTED or back, and through which door — never the name
 * (AGENTS.md §12.12). The row is the participant's own act, so it has no staff actor; the
 * backoffice timeline reads a null actor as "the participant". It is written inside the same
 * transaction as the change, unlike the staff verbs §12.12 describes: nothing here goes
 * through the allocator or takes the event-row lock, so there is no second write path to keep
 * out of.
 *
 * The published set (`repository.ts#listPublicStartList`) already reads the column, so a name
 * leaves the list the moment the row changes and returns the same way. The public page reads the
 * list through the public cache (§333), and the write below expires it before the request ends,
 * so the next visitor asks the database again — the choice still reaches the page at once, and
 * §281's last good copy is still never consulted for it. §186's "Participant (nume ascuns)" count
 * picks the row up on the other side of the same column.
 *
 * "Set", not "flip": the form carries the choice it is making, so a double submission — or a
 * choice made from two tabs — lands on the state the button said, and a second identical
 * request changes nothing and writes no audit row.
 */

/** Which door the change came through; audit metadata, never a name. */
export type ListConsentSurface = "LIST_LINK" | "MY_REGISTRATIONS" | "MANAGE_LINK";

/** The same fortnight every other participant link gets when it has no deadline to borrow. */
export const LIST_CONSENT_TOKEN_HOURS = 14 * 24;

function consentWord(listed: boolean): "LISTED" | "NOT_LISTED" {
  return listed ? "LISTED" : "NOT_LISTED";
}

/**
 * The one write. `listed` is what the participant wants: true puts the name on the list
 * (`list_opt_out = false`), false takes it off. Idempotent — the same answer twice is one
 * change and one audit row.
 */
export async function setListConsent<T extends Record<string, unknown>>(
  db: Database<T>,
  registrationId: string,
  listed: boolean,
  via: ListConsentSurface,
  now: Date,
): Promise<{ listed: boolean; changed: boolean }> {
  const current = await findRegistrationById(db, registrationId);
  if (!current) throw new DomainError("NOT_FOUND", "no such registration");

  const wasListed = !current.listOptOut;
  if (wasListed === listed) return { listed, changed: false };

  await db
    .update(registrations)
    .set({ listOptOut: !listed, updatedAt: now })
    .where(eq(registrations.id, registrationId));
  // Off the public list (or back on it) for the next visitor, not after the cache's day (§333).
  revalidatePublicContent("places");

  // The participant's own act: no staff actor. The trail names the change and the door, and
  // the timeline in the backoffice reads the null actor as "the participant".
  await recordAuditEvent(db, {
    actorStaffUserId: null,
    participantId: current.participantId,
    action: "registration.list_consent_changed",
    entityType: "registration",
    entityId: registrationId,
    metadata: { from: consentWord(wasListed), to: consentWord(listed), via },
    now,
  });

  return { listed, changed: true };
}

/** What the page shows: the choice as it stands, and the event the link already named. */
export type ListConsentView = {
  ok: true;
  registrationId: string;
  listed: boolean;
  /** This locale's own title, or null — a foreign slug would build a link that 404s (§202). */
  eventTitle: string | null;
  eventSlug: string | null;
};

async function describeListConsent<T extends Record<string, unknown>>(
  db: Database<T>,
  registrationId: string,
  locale: Locale,
): Promise<ListConsentView | TokenRejection> {
  const registration = await findRegistrationById(db, registrationId);
  // Erased under §67, or gone with its event: the generic refusal is the honest answer.
  if (!registration) return TOKEN_NOT_FOUND;

  const event = await findEventNotificationDetails(db, registration.eventId, locale);
  return {
    ok: true,
    registrationId,
    listed: !registration.listOptOut,
    eventTitle: event?.locale === locale ? event.title : null,
    eventSlug: event?.locale === locale ? event.slug : null,
  };
}

/**
 * The GET behind the email link (BR-REQ-036-02 criterion 4): throttled per presented token,
 * `LIST_CONSENT` only, and a read. The token context comes out of one READ ONLY transaction
 * and the page's own two reads out of another (`db/read-only.ts`), so the row this page
 * describes cannot be written by the request that describes it, whatever a later edit adds.
 * A mail scanner opening the link changes nothing.
 */
export async function readListConsent<T extends Record<string, unknown>>(
  db: Database<T>,
  secret: string,
  locale: Locale,
  now: Date,
): Promise<ListConsentView | TokenRejection> {
  if (!(await tokenAttemptAllowed(db, secret, now))) return TOKEN_NOT_FOUND;
  const context = await readActionTokenContext(db, { secret, purpose: "LIST_CONSENT", now });
  if (!context.ok) return context;
  const registrationId = context.token.registrationId ?? "";
  return inReadOnlyTransaction(db, (tx) => describeListConsent(tx, registrationId, locale));
}

/**
 * The POST behind the email link. One transaction: the token is spent (one statement, one
 * winner — `consumeActionToken`), the choice is written, and a fresh `LIST_CONSENT` token is
 * minted for the same registration so the page the person lands on can offer the way back.
 * The old link is dead from here on, as every spent action link is (§12.8); the fresh secret
 * exists in the redirect and nowhere durable.
 */
export async function consumeAndSetListConsent<T extends Record<string, unknown>>(
  db: Database<T>,
  secret: string,
  listed: boolean,
  now: Date,
): Promise<{ ok: true; listed: boolean; nextSecret: string } | TokenRejection> {
  // Outside the transaction, so a request that ends in a rollback still leaves its count behind.
  if (!(await tokenAttemptAllowed(db, secret, now))) return TOKEN_NOT_FOUND;

  return db.transaction(async (tx) => {
    const consumed = await consumeActionToken(tx, { secret, purpose: "LIST_CONSENT", now });
    if (!consumed.ok) return consumed;

    const registrationId = consumed.token.registrationId ?? "";
    const result = await setListConsent(tx, registrationId, listed, "LIST_LINK", now);

    const fresh = await issueActionToken(tx, {
      participantId: consumed.token.participantId,
      registrationId,
      purpose: "LIST_CONSENT",
      expiresAt: new Date(now.getTime() + LIST_CONSENT_TOKEN_HOURS * 60 * 60_000),
      now,
    });

    return { ok: true as const, listed: result.listed, nextSecret: fresh.secret };
  });
}

/**
 * The same choice from the registration's own manage page. The `MANAGE_REGISTRATION` token is
 * read, never spent — the page must still be able to cancel — and it is the token that says
 * which registration this is; nothing is trusted from the form.
 */
export async function setListConsentFromManageLink<T extends Record<string, unknown>>(
  db: Database<T>,
  secret: string,
  listed: boolean,
  now: Date,
): Promise<{ ok: true; listed: boolean; changed: boolean } | TokenRejection> {
  if (!(await tokenAttemptAllowed(db, secret, now))) return TOKEN_NOT_FOUND;
  const context = await readActionTokenContext(db, { secret, purpose: "MANAGE_REGISTRATION", now });
  if (!context.ok) return context;

  const result = await setListConsent(db, context.token.registrationId ?? "", listed, "MANAGE_LINK", now);
  return { ok: true as const, ...result };
}

/**
 * The same choice from "Înscrierile mele" (§77). The `MANAGE_PROFILE` token is read, never
 * spent, and the registration must be the holder's own — a registration id is not a secret,
 * and the token is what says who is asking. A stranger's id gets NOT_FOUND, never a hint.
 */
export async function setListConsentFromMyRegistrations<T extends Record<string, unknown>>(
  db: Database<T>,
  secret: string,
  registrationId: string,
  listed: boolean,
  now: Date,
): Promise<{ ok: true; listed: boolean; changed: boolean } | TokenRejection> {
  if (!(await tokenAttemptAllowed(db, secret, now))) return TOKEN_NOT_FOUND;
  const context = await readActionTokenContext(db, { secret, purpose: "MANAGE_PROFILE", now });
  if (!context.ok) return context;

  const registration = await findRegistrationById(db, registrationId);
  if (!registration || registration.participantId !== context.token.participantId) {
    throw new DomainError("NOT_FOUND", "not one of this participant's registrations");
  }

  const result = await setListConsent(db, registration.id, listed, "MY_REGISTRATIONS", now);
  return { ok: true as const, ...result };
}
