import { eq } from "drizzle-orm";
import { registrations } from "@/db/schema/registrations";
import type { Database } from "@/db/types";
import type { Locale } from "@/i18n/routing";
import { TOKEN_NOT_FOUND, type TokenRejection } from "@/modules/action-tokens/domain/token-state";
import { consumeActionToken, issueActionToken, readActionTokenContext } from "@/modules/action-tokens/repository";
import { tokenAttemptAllowed } from "@/modules/action-tokens/throttle";
import { recordAuditEvent } from "@/modules/audit/repository";
import { findEventNotificationDetails } from "@/modules/events/repository";
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
 * What the write is: `list_opt_out` flipped, `updated_at` bumped, and one audit row saying the
 * shape of the change — LISTED to NOT_LISTED or back, and through which door — never the name
 * (AGENTS.md §12.12). The published set (`repository.ts#listPublicStartList`) already reads the
 * column, so a name leaves the list the moment the row changes and returns the same way; no
 * second query and no cache stand between the choice and the page (§281).
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
 * `LIST_CONSENT` only, and a read — the token context comes out of a read-only transaction, and
 * nothing here touches the registration. A mail scanner opening the link changes nothing.
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
  return describeListConsent(db, context.token.registrationId ?? "", locale);
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
