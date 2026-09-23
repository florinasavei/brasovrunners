import { eq } from "drizzle-orm";
import { type Registration, registrations } from "@/db/schema/registrations";
import type { Database } from "@/db/types";
import { TOKEN_NOT_FOUND, type TokenRejection } from "@/modules/action-tokens/domain/token-state";
import { readActionTokenContext } from "@/modules/action-tokens/repository";
import { tokenAttemptAllowed } from "@/modules/action-tokens/throttle";
import { recordAuditEvent } from "@/modules/audit/repository";
import { DomainError } from "@/shared/errors/domain-error";
import { findRegistrationById } from "./repository";

/**
 * Withdrawing what was given on consent (§322; the owner: "in order to be GDPR compliant, we
 * need to inform people properly on how their data is used!").
 *
 * Three things on a registration exist only because the person agreed to them, and art. 7(3)
 * GDPR says withdrawing must be as easy as giving: the health note with its own consent
 * (art. 9(2)(a)), the Strava link and the Instagram username (§106), and the results consent
 * (kept for M2, never asked since §322). The privacy notice promised "retractabilă oricând" for
 * the note and there was no way to do it but to write to the club. Now there are three doors,
 * one write:
 *
 *   - the registration's own manage page, under its `MANAGE_REGISTRATION` link;
 *   - "Înscrierile mele" (§77), a button per registration under the `MANAGE_PROFILE` link;
 *   - an Administrator, from the registration's page, for the person who wrote to the club
 *     instead (`admin-service.ts#withdrawOptionalData`, the staff verb §15.11 now names).
 *
 * The two participant doors follow `list-consent.ts` exactly: the token is read, never spent —
 * the same page must still be able to cancel — POST only, and the GET that renders the button
 * never writes (BR-REQ-036-02 criterion 4). The token says which registration; nothing is
 * trusted from the form but the field group's name.
 *
 * What the write is: the named fields cleared — nulled, never flagged, so the text is gone
 * rather than hidden — `updated_at` bumped, and one audit row naming the *fields* and the door,
 * never what they held (AGENTS.md §12.12). Nothing else moves: no status, no place, no number,
 * no message. "Set", not "flip": a field group already empty is not a change, and a second
 * press writes nothing.
 */

/** The groups a withdrawal names; the audit row carries these words and nothing else. */
export const OPTIONAL_DATA_FIELDS = ["health", "socials", "results"] as const;
export type OptionalDataField = (typeof OPTIONAL_DATA_FIELDS)[number];

/** The two a participant withdraws from their own link; the results consent is not on the form any more. */
export type SelfServiceField = Extract<OptionalDataField, "health" | "socials">;

export function isSelfServiceField(value: unknown): value is SelfServiceField {
  return value === "health" || value === "socials";
}

/** Which door the withdrawal came through; audit metadata, never a name. */
export type WithdrawalSurface = "MANAGE_LINK" | "MY_REGISTRATIONS" | "STAFF";

type Holding = Pick<Registration, "healthNotes" | "healthConsentAt" | "healthConsentVersion" | "stravaUrl" | "instagramHandle" | "resultsNameConsent">;

/** Whether a registration still holds anything in this group — what decides a change, and a button. */
export function holdsOptionalData(registration: Holding, field: OptionalDataField): boolean {
  switch (field) {
    case "health":
      return registration.healthNotes !== null || registration.healthConsentAt !== null || registration.healthConsentVersion !== null;
    case "socials":
      return registration.stravaUrl !== null || registration.instagramHandle !== null;
    case "results":
      return registration.resultsNameConsent;
  }
}

/**
 * The one write. `fields` is what to clear; a group that holds nothing is skipped, and nothing
 * at all is written — not even the audit row — when every named group was already empty.
 *
 * One transaction, and the row locked before it is read (§322): two presses at once — the
 * button twice, the manage page and "My registrations" in two tabs — would otherwise both find
 * the note still there and both write an audit row for one withdrawal, and an audit insert that
 * failed after the update would leave the data cleared with nothing saying so. With the lock the
 * second press waits, reads the row the first one committed, finds the group empty and writes
 * nothing; the clearing and its record land together or not at all.
 */
export async function clearOptionalData<T extends Record<string, unknown>>(
  db: Database<T>,
  input: {
    registrationId: string;
    fields: readonly OptionalDataField[];
    via: WithdrawalSurface;
    actorStaffUserId: string | null;
    /** An Administrator's typed reason (§15.11); absent for the participant's own press. */
    reason?: string;
    now: Date;
  },
): Promise<{ cleared: OptionalDataField[] }> {
  return db.transaction(async (tx) => {
    const [current] = await tx
      .select()
      .from(registrations)
      .where(eq(registrations.id, input.registrationId))
      .for("update");
    if (!current) throw new DomainError("NOT_FOUND", "no such registration");

    const cleared = OPTIONAL_DATA_FIELDS.filter((field) => input.fields.includes(field) && holdsOptionalData(current, field));
    if (cleared.length === 0) return { cleared };

    await tx
      .update(registrations)
      .set({
        ...(cleared.includes("health") ? { healthNotes: null, healthConsentVersion: null, healthConsentAt: null } : {}),
        ...(cleared.includes("socials") ? { stravaUrl: null, instagramHandle: null } : {}),
        ...(cleared.includes("results") ? { resultsNameConsent: false } : {}),
        updatedAt: input.now,
      })
      .where(eq(registrations.id, current.id));

    await recordAuditEvent(tx, {
      actorStaffUserId: input.actorStaffUserId,
      participantId: current.participantId,
      action: "registration.consent_withdrawn",
      entityType: "registration",
      entityId: current.id,
      metadata: {
        fields: cleared,
        via: input.via,
        ...(input.reason !== undefined ? { reason: input.reason.trim().slice(0, 500) } : {}),
      },
      now: input.now,
    });

    return { cleared };
  });
}

/**
 * From the registration's own manage page. The `MANAGE_REGISTRATION` token is read, never
 * spent, and it is what says which registration this is.
 */
export async function withdrawFromManageLink<T extends Record<string, unknown>>(
  db: Database<T>,
  secret: string,
  field: SelfServiceField,
  now: Date,
): Promise<{ ok: true; cleared: OptionalDataField[] } | TokenRejection> {
  if (!(await tokenAttemptAllowed(db, secret, now))) return TOKEN_NOT_FOUND;
  const context = await readActionTokenContext(db, { secret, purpose: "MANAGE_REGISTRATION", now });
  if (!context.ok) return context;

  const result = await clearOptionalData(db, {
    registrationId: context.token.registrationId ?? "",
    fields: [field],
    via: "MANAGE_LINK",
    actorStaffUserId: null,
    now,
  });
  return { ok: true as const, ...result };
}

/**
 * From "Înscrierile mele" (§77). The `MANAGE_PROFILE` token is read, never spent, and the
 * registration must be the holder's own — a registration id is not a secret, and the token is
 * what says who is asking. A stranger's id gets NOT_FOUND, never a hint.
 */
export async function withdrawFromMyRegistrations<T extends Record<string, unknown>>(
  db: Database<T>,
  secret: string,
  registrationId: string,
  field: SelfServiceField,
  now: Date,
): Promise<{ ok: true; cleared: OptionalDataField[] } | TokenRejection> {
  if (!(await tokenAttemptAllowed(db, secret, now))) return TOKEN_NOT_FOUND;
  const context = await readActionTokenContext(db, { secret, purpose: "MANAGE_PROFILE", now });
  if (!context.ok) return context;

  const registration = await findRegistrationById(db, registrationId);
  if (!registration || registration.participantId !== context.token.participantId) {
    throw new DomainError("NOT_FOUND", "not one of this participant's registrations");
  }

  const result = await clearOptionalData(db, {
    registrationId: registration.id,
    fields: [field],
    via: "MY_REGISTRATIONS",
    actorStaffUserId: null,
    now,
  });
  return { ok: true as const, ...result };
}
