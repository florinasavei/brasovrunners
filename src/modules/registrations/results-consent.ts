import { eq } from "drizzle-orm";
import { events } from "@/db/schema/events";
import { registrations } from "@/db/schema/registrations";
import type { Database } from "@/db/types";
import { TOKEN_NOT_FOUND, type TokenRejection } from "@/modules/action-tokens/domain/token-state";
import { readActionTokenContext } from "@/modules/action-tokens/repository";
import { tokenAttemptAllowed } from "@/modules/action-tokens/throttle";
import { recordAuditEvent } from "@/modules/audit/repository";
import { findCurrentApprovedDocument, findFirstResultsNameAskNoticeVersion, findFirstResultsNoticeVersion, noticeDescribesResultsNameAsk } from "@/modules/legal-documents/repository";
import { revalidatePublicContent } from "@/modules/public-cache/cache";
import { holdsResultsNameConsent, resultsNameConsentLine, resultsNameConsentOffered } from "@/modules/results/domain/name-consent";
import { DomainError } from "@/shared/errors/domain-error";
import { isActiveStatus } from "./domain/state-machine";
import { anotherAdultOnTheLink, managedRegistration } from "./manage-family";
import { findRegistrationById } from "./repository";

/**
 * «Vreau să apar cu numele în clasament» from the runner's own registration page (§NNN, BR-REQ-072-01) — the asking §808 left to
 * the owner and the lawyer for a runner who registered under a privacy notice that did not yet describe the results.
 *
 * The shape of `promo-consent.ts`: the `MANAGE_REGISTRATION` token is read, never spent (the same page must still be able to cancel),
 * POST only — the GET that draws the button writes nothing (BR-REQ-036-02 criterion 4) — and the token says which registration; a
 * posted id is only ever another person the same link already manages (`managedRegistration`, §547). Another adult on the address
 * may have their yes taken back from this link, never given: it is theirs (§421, `anotherAdultOnTheLink`).
 *
 * **The gate, asked again at every yes.** The notice in force names the tick's own marker `{{resultsNameAsk}}` beside `{{results}}`
 * in every language (`noticeDescribesResultsNameAsk`) — describing the results alone is not enough, because the platform's template
 * describes them in the section that tells these runners they stay «Participant #numărul» — the event is a race, the registration's own notice is older than the first that described them, the registration is active and
 * on the public list — the name in the results follows the list's tick (§808), so a yes off the list would be a consent to nothing.
 * Anything else is refused and nothing is written. A no is always accepted (art. 7(3) GDPR), whatever the notice says today.
 *
 * **What the write is.** `results_name_consent` set, `results_consent_version` the version of the notice in force in the
 * registration's own language at the yes (the version `submitRegistration` records at the form, the precedent of «Vin!»'s re-tick),
 * `updated_at` bumped, and one audit row `registration.results_name_consent_changed` carrying the new value, the door and the
 * notice version — never the name (AGENTS.md §12.12). One transaction, the row locked before it is read, so two presses at once
 * write one change. "Set", not "flip": the same answer twice is no change and writes nothing. A withdrawal clears the flag; the
 * version stays as the record of the notice the consent was given under. `publicResultName` reads both, beside every condition it
 * applied before; the results' public read is expired after the commit, so the name appears or leaves for the next visitor.
 */

/** Which door the change came through; audit metadata, never a name. */
export type ResultsNameConsentSurface = "MANAGE_LINK";

/** The refusal of a yes the gate does not allow. */
export const RESULTS_NAME_NOT_OFFERED = "resultsNameConsent";

/** The event's type, which says whether it takes results (`eventTakesResults`); null for an event that is not there. */
export async function eventTypeOf<T extends Record<string, unknown>>(db: Database<T>, eventId: string): Promise<string | null> {
  const [row] = await db.select({ type: events.type }).from(events).where(eq(events.id, eventId)).limit(1);
  return row?.type ?? null;
}

/**
 * The line for this event, read uncached: the first results notice while the notice in force names the tick and the results and the
 * event is a race, else null. The page reads the same through the public cache; the write asks here, at every yes.
 */
export async function readResultsNameConsentLine<T extends Record<string, unknown>>(db: Database<T>, eventId: string, now: Date): Promise<number | null> {
  const type = await eventTypeOf(db, eventId);
  if (type === null) return null;
  const [describes, first] = await Promise.all([noticeDescribesResultsNameAsk(db, now), findFirstResultsNoticeVersion(db)]);
  return resultsNameConsentLine({ noticeDescribesResultsNameAsk: describes, firstResultsNoticeVersion: first, eventType: type });
}

export async function setResultsNameConsent<T extends Record<string, unknown>>(
  db: Database<T>,
  input: { registrationId: string; consent: boolean; via: ResultsNameConsentSurface; now: Date },
): Promise<{ consent: boolean; changed: boolean }> {
  const result = await db.transaction(async (tx) => {
    const [current] = await tx.select().from(registrations).where(eq(registrations.id, input.registrationId)).for("update");
    if (!current) throw new DomainError("NOT_FOUND", "no such registration");

    let version = current.resultsConsentVersion;
    if (input.consent) {
      const line = await readResultsNameConsentLine(tx, current.eventId, input.now);
      if (!resultsNameConsentOffered(current.privacyNoticeVersion, line) || !isActiveStatus(current.status) || current.listOptOut) {
        throw new DomainError("VALIDATION_ERROR", "this registration is not asked to appear by name in the results", [RESULTS_NAME_NOT_OFFERED]);
      }
      const askLine = await findFirstResultsNameAskNoticeVersion(tx);
      if (holdsResultsNameConsent(current, askLine)) return { consent: true, changed: false };
      const notice = await findCurrentApprovedDocument(tx, "PRIVACY_NOTICE", current.locale, input.now);
      // A notice in force below the first that named the tick would record a consent that counts for nothing: refused, never kept.
      if (!notice || askLine === null || notice.version < askLine) {
        throw new DomainError("VALIDATION_ERROR", "the privacy notice in force does not name the tick to appear by name in the results", [RESULTS_NAME_NOT_OFFERED]);
      }
      version = notice.version;
    } else if (!current.resultsNameConsent) {
      return { consent: false, changed: false };
    }

    await tx
      .update(registrations)
      .set({ resultsNameConsent: input.consent, resultsConsentVersion: version, updatedAt: input.now })
      .where(eq(registrations.id, current.id));

    // The participant's own act: no staff actor, the door and the notice in the metadata, never the name.
    await recordAuditEvent(tx, {
      actorStaffUserId: null,
      participantId: current.participantId,
      action: "registration.results_name_consent_changed",
      entityType: "registration",
      entityId: current.id,
      metadata: { to: input.consent, via: input.via, ...(input.consent ? { noticeVersion: version } : {}) },
      now: input.now,
    });
    return { consent: input.consent, changed: true };
  });
  // The published results name the runner, or stop naming them, for the next visitor (§333) — after the commit, as `clearOptionalData` does.
  if (result.changed) revalidatePublicContent("places");
  return result;
}

/**
 * From the registration's own manage page. The `MANAGE_REGISTRATION` token is read, never spent. Per person (§547): `registrationId`
 * names another registration of the same address at the same event; a stranger's id, or one at another event, gets NOT_FOUND.
 */
export async function setResultsNameConsentFromManageLink<T extends Record<string, unknown>>(
  db: Database<T>,
  secret: string,
  consent: boolean,
  now: Date,
  registrationId?: string,
): Promise<{ ok: true; consent: boolean; changed: boolean } | TokenRejection> {
  if (!(await tokenAttemptAllowed(db, secret, now))) return TOKEN_NOT_FOUND;
  const context = await readActionTokenContext(db, { secret, purpose: "MANAGE_REGISTRATION", now });
  if (!context.ok) return context;
  if (!context.token.registrationId) return TOKEN_NOT_FOUND;

  const own = await findRegistrationById(db, context.token.registrationId);
  const target = own ? await managedRegistration(db, own, registrationId) : null;
  if (!target) throw new DomainError("NOT_FOUND", "not a registration this link manages");
  // Another adult on the address (§421): this link may take their yes back, never give it.
  if (consent && own && anotherAdultOnTheLink(own, target, now)) {
    throw new DomainError("FORBIDDEN", "another adult on the address gives their own consent to appear by name in the results");
  }

  const result = await setResultsNameConsent(db, { registrationId: target.id, consent, via: "MANAGE_LINK", now });
  return { ok: true as const, ...result };
}
