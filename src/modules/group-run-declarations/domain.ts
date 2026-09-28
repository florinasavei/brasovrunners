/** Pure rules of a group run's optional self-declaration (§393); no database. */
import { canonicalizeEmail, InvalidEmailError } from "@/modules/participants/domain/canonical-email";
import { ADULT_AGE, ageOn, dayIn, isUnderMinimumAge } from "@/modules/registrations/domain/age";
import { GROUP_RUN_TOO_YOUNG } from "./form";

/** How long after the start the page still takes a signature: somebody at the meeting point, late. */
export const SIGNING_GRACE_MINUTES = 60;

/** A published, uncancelled event whose start is at most `SIGNING_GRACE_MINUTES` behind (§393). */
export function signingOpen(event: { editorialStatus: string; eventStatus: string; startsAt: Date }, now: Date): boolean {
  return (
    event.editorialStatus === "PUBLISHED" &&
    event.eventStatus !== "CANCELLED" &&
    now.getTime() <= event.startsAt.getTime() + SIGNING_GRACE_MINUTES * 60_000
  );
}

/**
 * The `{{minimumAge}}` a group-run declaration states (§440, §515): the event's `min_age` (§329),
 * never under eighteen — a run saved with the race's default of 14 reads as 18. The text has no
 * minor's or parent's signature (§330), so it covers no minor.
 */
export function groupRunMinimumAge(minAge: number): number {
  return Math.max(minAge, ADULT_AGE);
}

/**
 * A birth date is asked only for a minimum above eighteen (§440); at eighteen the signer's own
 * statement suffices and a birth date would be data collected for no purpose (GDPR art. 5(1)(c), §418).
 */
export function groupRunAsksBirthDate(minAge: number): boolean {
  return groupRunMinimumAge(minAge) > ADULT_AGE;
}

/**
 * The minimum-age check at the signing page (§440), counted on the run's day in its zone by the
 * race's own rule (`isUnderMinimumAge`). An unreadable date names the box; an under-age one also
 * names the marker, so the page can say the number.
 */
export function birthDateRefusal(
  event: { minAge: number; startsAt: Date; timezone: string },
  birthDate: string | undefined,
): string[] {
  if (!groupRunAsksBirthDate(event.minAge)) return [];
  const minAge = groupRunMinimumAge(event.minAge);
  const day = dayIn(event.startsAt, event.timezone);
  const value = (birthDate ?? "").trim();
  if (ageOn(value, day) === null) return ["birthDate"];
  return isUnderMinimumAge(value, day, minAge) ? ["birthDate", GROUP_RUN_TOO_YOUNG] : [];
}

/** The longest name a signature box takes, as the race's does. */
export const TYPED_NAME_MAX = 200;

/** The kind and the series composed ("Carte de identitate BV 123456"), with room for the longest kind. */
export const ID_DOCUMENT_MAX = 80;

/** The longest reason the erase keeps (§88's length): a sentence, not a file. */
export const ERASE_REASON_MAX = 500;

/**
 * Days after the run's start the sweep clears a typed identity document (§393, §503, §95); the
 * declaration itself stays until the signer asks. Also `RETENTION.groupRunIdDocumentDaysAfterEvent`
 * and the signing page's help line.
 */
export const GROUP_RUN_DECLARATION_ID_DOCUMENT_DAYS = 7;

/**
 * The signer's identity for one declaration per person per series (§523; `signer_key`'s unique index):
 * the canonical address (AGENTS.md §10.4) plus the name ignoring case, accents and spacing — an
 * address may be a family's (§389). Null for an invalid address.
 */
export function signerIdentity(email: string, typedName: string): string | null {
  let canonical: string;
  try {
    canonical = canonicalizeEmail(email).canonicalEmail;
  } catch (error) {
    if (error instanceof InvalidEmailError) return null;
    throw error;
  }
  const name = typedName
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
  return `${canonical}\n${name}`;
}

/** A signature that covers a run's date, as the signing press reads it (§523). */
export type SeriesSignature = { id: string; legalDocumentId: string; email: string; typedName: string; acceptedAt: Date };

/**
 * The existing signature a signing press reuses instead of writing a row (§523): the same person's
 * earliest signature of the version in force covering this date, or null. The page answers the
 * same either way, so it reveals nothing about the address.
 *
 * Never deletes: an older version's row stays as evidence (§53, §151); only the audited
 * Administrator erase removes a row (§393), never an unverified public press.
 */
export function keptSignature(
  existing: readonly SeriesSignature[],
  signer: { email: string; typedName: string },
  documentId: string,
): SeriesSignature | null {
  const who = signerIdentity(signer.email, signer.typedName);
  if (who === null) return null;
  const [keep] = existing
    .filter((row) => row.legalDocumentId === documentId && signerIdentity(row.email, row.typedName) === who)
    .sort((a, b) => a.acceptedAt.getTime() - b.acceptedAt.getTime());
  return keep ?? null;
}

/**
 * The run page's state for a signer arriving by their own link (§523): `current` signed the version
 * in force (no button); `renew` signed a replaced version (button again); null is the public page.
 */
export type SignedState = { kind: "current" | "renew"; version: number; acceptedAt: Date } | null;

export function signedStateFor(row: { legalDocumentId: string; version: number; acceptedAt: Date } | undefined, inForceId: string): SignedState {
  if (!row) return null;
  return { kind: row.legalDocumentId === inForceId ? "current" : "renew", version: row.version, acceptedAt: row.acceptedAt };
}

/**
 * The backoffice fold shows while the run offers the declaration or any signature is still kept
 * (nothing sweeps them, §503) — not merely because of the surface (§393).
 */
export function showsGroupRunDeclarationsFold(offeredKey: string | null, signedCount: number): boolean {
  return offeredKey !== null || signedCount > 0;
}
