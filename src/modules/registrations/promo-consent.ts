import { eq } from "drizzle-orm";
import { registrations } from "@/db/schema/registrations";
import type { Database } from "@/db/types";
import { TOKEN_NOT_FOUND, type TokenRejection } from "@/modules/action-tokens/domain/token-state";
import { readActionTokenContext } from "@/modules/action-tokens/repository";
import { tokenAttemptAllowed } from "@/modules/action-tokens/throttle";
import { recordAuditEvent } from "@/modules/audit/repository";
import { noticeDescribesPromotionalMaterials } from "@/modules/legal-documents/repository";
import { DomainError } from "@/shared/errors/domain-error";
import { isUuid } from "@/shared/ids";
import { anotherAdultOnTheLink, managedRegistration } from "./manage-family";
import { findRegistrationById } from "./repository";

/**
 * «Vreau să primesc oferte și beneficii de la <club> și partenerii săi.» after registration (§NNN;
 * the owner, 2026-09-29: «I need an extra check on the registration for participants to optionally
 * receive promotional materials from us and from clients»; the words are his of 16:12 the same day).
 * The column keeps its first name, `promo_consent`; every word a person or the club reads says
 * «oferte și beneficii». The consent is per registration, and every door's words say «această
 * înscriere», never «you» at large: a yes at one event says nothing about another.
 *
 * The form asks once; art. 7(3) GDPR says withdrawing must be as easy as giving, so the person has
 * a switch of their own — the shape of `list-consent.ts` and `consent-withdrawal.ts`: several doors,
 * one write.
 *
 *   - the registration's own manage page, under its `MANAGE_REGISTRATION` link, per person (§547) —
 *     on another adult's row of that page only the way out: the link may withdraw their yes, never
 *     give it (`anotherAdultOnTheLink`, refused FORBIDDEN on the server);
 *   - «Înscrierile mele» (§77), a button per registration under the `MANAGE_PROFILE` link;
 *   - the declaration page (and each step of the family's wizard, §471), a box of its own — the
 *     only place another adult on a family's address gives it, since the address holder cannot
 *     (§421); it can only say yes, never withdraw (the two doors above do that);
 *   - an Administrator, from the registration's page, for the person who wrote to the club — a
 *     withdrawal only: staff never consent for a person.
 *
 * The participant doors read their token and never spend it, like «Sunt aici» and the list switch
 * (§77, §186): the choice is reversible, and spending the link on it would cost the page its cancel
 * button. POST only; the GET that draws the button writes nothing (BR-REQ-036-02 criterion 4). The
 * token says whose registration it is; a posted id is only ever one the token already covers.
 *
 * **The gate.** Saying yes is offered, and accepted, only while the privacy notice in force in
 * every language names `{{promotionalMaterials}}` (`noticeDescribesPromotionalMaterials`,
 * AGENTS.md §10.8: never collect under a notice that does not describe it). Saying no is always
 * accepted — a consent can be withdrawn whatever the notice in force says today.
 *
 * **Two consents, two switches.** This column and the newsletter (§445) are separate: an
 * unsubscribe from the newsletter never touches it, and a withdrawal here never touches the
 * newsletter. The words on every door say so.
 *
 * **What the write is.** `promo_consent` set, `promo_consent_at` the moment of this change,
 * `updated_at` bumped, and one audit row `registration.promo_consent_changed` carrying the new
 * value and the door — never the name or the address (AGENTS.md §12.12); an Administrator's row
 * carries the actor and the typed reason. One transaction, the row locked before it is read, so two
 * presses at once write one change and one audit row. "Set", not "flip": the same answer twice is
 * no change and writes nothing.
 */

/**
 * Which door the change came through; audit metadata, never a name. `FORM` is the register form's
 * own tick, written by `submitRegistration` beside the row (`recordFormPromoConsent`), so the moment
 * a consent was first given survives a later withdrawal that rewrites `promo_consent_at` (art. 7(1)
 * GDPR: the club must be able to show the consent was given, and when).
 */
export type PromoConsentSurface = "FORM" | "MANAGE_LINK" | "MY_REGISTRATIONS" | "DECLARATION" | "STAFF";

/**
 * The register form's answer, on the audit trail (§NNN, fix round): one row
 * `registration.promo_consent_changed` `{ to: true, via: "FORM" }` whenever a form keeps a tick, and
 * `{ to: false, via: "FORM" }` when a restarted or corrected form takes back a yes the row held. No
 * row for an unticked box on a row that never said yes: nothing changed. In the caller's
 * transaction, so the row and its record cannot disagree. Never the name or the address (§12.12).
 */
export async function recordFormPromoConsent<T extends Record<string, unknown>>(
  tx: Database<T>,
  input: { registrationId: string; participantId: string; kept: boolean; before: boolean; now: Date },
): Promise<void> {
  if (!input.kept && !input.before) return;
  await recordAuditEvent(tx, {
    actorStaffUserId: null,
    participantId: input.participantId,
    action: "registration.promo_consent_changed",
    entityType: "registration",
    entityId: input.registrationId,
    metadata: { to: input.kept, via: "FORM" },
    now: input.now,
  });
}

/** The refusal of a yes while the notice in force does not describe the promotional materials. */
export const PROMO_NOT_DESCRIBED = "promoConsent";

export async function setPromoConsent<T extends Record<string, unknown>>(
  db: Database<T>,
  input: {
    registrationId: string;
    consent: boolean;
    via: PromoConsentSurface;
    /** An Administrator's own act (§15.11); null for the person's own press. */
    actorStaffUserId?: string | null;
    /** An Administrator's typed reason; absent for the person's own press. */
    reason?: string;
    now: Date;
  },
): Promise<{ consent: boolean; changed: boolean }> {
  // Staff cannot consent for a person: the staff door only ever withdraws.
  if (input.via === "STAFF" && input.consent) {
    throw new DomainError("FORBIDDEN", "staff may withdraw a consent to promotional materials, never give one");
  }
  // A yes only under a notice that describes it; a no always.
  if (input.consent && !(await noticeDescribesPromotionalMaterials(db, input.now))) {
    throw new DomainError("VALIDATION_ERROR", "the privacy notice in force does not describe promotional materials", [PROMO_NOT_DESCRIBED]);
  }

  return db.transaction(async (tx) => {
    const [current] = await tx
      .select({ id: registrations.id, participantId: registrations.participantId, promoConsent: registrations.promoConsent })
      .from(registrations)
      .where(eq(registrations.id, input.registrationId))
      .for("update");
    if (!current) throw new DomainError("NOT_FOUND", "no such registration");
    if (current.promoConsent === input.consent) return { consent: input.consent, changed: false };

    await tx
      .update(registrations)
      .set({ promoConsent: input.consent, promoConsentAt: input.now, updatedAt: input.now })
      .where(eq(registrations.id, current.id));

    await recordAuditEvent(tx, {
      actorStaffUserId: input.actorStaffUserId ?? null,
      participantId: current.participantId,
      action: "registration.promo_consent_changed",
      entityType: "registration",
      entityId: current.id,
      metadata: {
        to: input.consent,
        via: input.via,
        ...(input.reason !== undefined ? { reason: input.reason.trim().slice(0, 500) } : {}),
      },
      now: input.now,
    });
    return { consent: input.consent, changed: true };
  });
}

/**
 * From the registration's own manage page. The `MANAGE_REGISTRATION` token is read, never spent.
 * Per person (§547): `registrationId` names another registration of the same address at the same
 * event (`managedRegistration`); a stranger's id, or one at another event, gets NOT_FOUND.
 */
export async function setPromoConsentFromManageLink<T extends Record<string, unknown>>(
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
  // Another adult on the address (§421): this link may take their yes back, never give it (§NNN fix round).
  if (consent && own && anotherAdultOnTheLink(own, target, now)) {
    throw new DomainError("FORBIDDEN", "another adult on the address gives their own consent to offers and benefits");
  }

  const result = await setPromoConsent(db, { registrationId: target.id, consent, via: "MANAGE_LINK", now });
  return { ok: true as const, ...result };
}

/**
 * From «Înscrierile mele» (§77). The `MANAGE_PROFILE` token is read, never spent, and the
 * registration must be the holder's own; a stranger's id gets NOT_FOUND, never a hint.
 */
export async function setPromoConsentFromMyRegistrations<T extends Record<string, unknown>>(
  db: Database<T>,
  secret: string,
  registrationId: string,
  consent: boolean,
  now: Date,
): Promise<{ ok: true; consent: boolean; changed: boolean } | TokenRejection> {
  if (!(await tokenAttemptAllowed(db, secret, now))) return TOKEN_NOT_FOUND;
  const context = await readActionTokenContext(db, { secret, purpose: "MANAGE_PROFILE", now });
  if (!context.ok) return context;

  // The id comes from a form field: anything but a uuid is nobody's (§324).
  if (!isUuid(registrationId)) throw new DomainError("NOT_FOUND", "not one of this participant's registrations");
  const registration = await findRegistrationById(db, registrationId);
  if (!registration || registration.participantId !== context.token.participantId) {
    throw new DomainError("NOT_FOUND", "not one of this participant's registrations");
  }

  const result = await setPromoConsent(db, { registrationId: registration.id, consent, via: "MY_REGISTRATIONS", now });
  return { ok: true as const, ...result };
}
