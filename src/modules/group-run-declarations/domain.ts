/**
 * The pure rules of a group run's optional self-declaration (§393), shared by the run's page, the
 * signing page and the service, with no database behind them.
 */
import { canonicalizeEmail, InvalidEmailError } from "@/modules/participants/domain/canonical-email";
import { ADULT_AGE, ageOn, dayIn, isUnderMinimumAge } from "@/modules/registrations/domain/age";
import { GROUP_RUN_TOO_YOUNG } from "./form";

/** How long after the start the page still takes a signature: somebody at the meeting point, late. */
export const SIGNING_GRACE_MINUTES = 60;

/**
 * Whether a signature may still be taken (§393): a published event, not cancelled, whose start is
 * at most `SIGNING_GRACE_MINUTES` behind. After that the declaration would be about a run that has
 * happened; the signature already taken is kept until the signer asks for its deletion (§503).
 */
export function signingOpen(event: { editorialStatus: string; eventStatus: string; startsAt: Date }, now: Date): boolean {
  return (
    event.editorialStatus === "PUBLISHED" &&
    event.eventStatus !== "CANCELLED" &&
    now.getTime() <= event.startsAt.getTime() + SIGNING_GRACE_MINUTES * 60_000
  );
}

/**
 * The minimum age a group run's self-declaration states (§440, amended by §NNN): the event's own
 * `min_age` (§329), never under eighteen.
 *
 * The owner's review of 2026-09-27: the texts said at once «declar că am împlinit 18 ani» and «Declar
 * că am cel puțin {{minimumAge}}» — "elimină hardcodarea de 18 și folosește o singură regulă pe
 * `{{minimumAge}}`. Dacă group run-urile rămân doar pentru adulți, `minimumAge = 18` la configurarea
 * evenimentului, nu în text. Nu presupune că declarația de group run acoperă minorii." So the text
 * carries one sentence, «Declar că am cel puțin {{minimumAge}} împliniți la data alergării», and this
 * is its value: the run's number, which the editor's group-run box starts and stops at eighteen,
 * read as eighteen for a run saved before with the race's default of fourteen. The declaration has
 * no minor's signature and no parent's (that is the race's flow, §330), so it covers no minor.
 */
export function groupRunMinimumAge(minAge: number): number {
  return Math.max(minAge, ADULT_AGE);
}

/**
 * Whether the signing page asks for a birth date (§440): only for a minimum above eighteen. At
 * eighteen the signer's own statement — the text's sentence, and the consent box that repeats it —
 * is what the declaration rests on, and a birth date would be data collected for no purpose (GDPR
 * art. 5(1)(c), the reason §418 took the identity number off this text). Above it, the page checks.
 */
export function groupRunAsksBirthDate(minAge: number): boolean {
  return groupRunMinimumAge(minAge) > ADULT_AGE;
}

/**
 * The run's minimum age at the signing page's door (§440, amending §393): the event's own number
 * (§329) as `groupRunMinimumAge` binds it, counted on the run's day in the run's zone by `isUnderMinimumAge` — the rule the race's
 * registration door asks (`minimumAgeRule`), never a second one. Nothing is asked of a run at
 * eighteen (`groupRunAsksBirthDate`). A missing or unreadable date names the box; a date under the
 * minimum names the box and the marker, so the page says the number rather than "fill it in".
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
 * How many days after the run's start the platform clears an identity document from a group run's
 * self-declaration (§393, §503). The declaration itself is kept until the signer asks for its
 * deletion (§503) — the Administrator's erase, never a sweep — but a document typed under a text
 * approved before §418 took `{{idDocument}}` off has no business outliving the run, as the race's
 * does not (§95). One number for the sweep (`RETENTION.groupRunIdDocumentDaysAfterEvent` is this)
 * and the signing page's help line, said through `durationPhrase`, never as a word typed into a
 * sentence.
 */
export const GROUP_RUN_DECLARATION_ID_DOCUMENT_DAYS = 7;

/**
 * Who a signature is, for "one declaration per person per series" (§NNN; `signer_key`, whose unique
 * index holds two presses at once to one row): the canonical address
 * (§10.4 — never a raw compare, so `Ana@Example.ro` is `ana@example.ro`) and the name as typed, read
 * loosely — case, accents and spacing make no other person («Ana  Popescu», «ana popescu», «Ană
 * Popescu»). The name is part of it because an address may be a family's (§389): a parent and a
 * grown child who share one sign one declaration each. Null for an address that is not one.
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

/** A signature that covers a run's date, as the signing press reads it (§NNN). */
export type SeriesSignature = { id: string; legalDocumentId: string; email: string; typedName: string; acceptedAt: Date };

/**
 * The signature a press on «Semnează declarația» keeps rather than writing a second (§NNN; the owner,
 * 2026-09-27: "a returning runner signs once; it has no end date and is deleted only at their
 * request"): the same person's earliest signature of the **version in force** among those that cover
 * this date — or null, and a row is written. The service then sends that copy again, and the page
 * answers exactly as a signature does, so it tells nobody whether the address had signed.
 *
 * **Nothing is ever taken away here.** An older version's signature is not this version's, so the
 * person signs again and gets a new row beside it; the older one stays — it is the evidence for the
 * runs attended under that text, and a version somebody signed is relied upon (§53, §151). A row
 * leaves only by the Administrator's erase, audited (§393), never by a public press, which nobody
 * verified: an address and a name typed by anyone must not delete a real signature. Another person
 * on the same address (§389), or another kind of text (asphalt and trail), is another signature.
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
 * What the run's page says to the person who opened it from their own link (§NNN): `current` — they
 * signed the version in force, «Ai semnat deja declarația pentru aceste alergări (v. N, semnată la …)»,
 * and no button —; `renew` — they signed an older version, which the club has since replaced, so the
 * page says so and offers the button again. Null — no link, a link that is not theirs or not for this
 * run, or another kind of text — and the page is the one every visitor sees.
 */
export type SignedState = { kind: "current" | "renew"; version: number; acceptedAt: Date } | null;

export function signedStateFor(row: { legalDocumentId: string; version: number; acceptedAt: Date } | undefined, inForceId: string): SignedState {
  if (!row) return null;
  return { kind: row.legalDocumentId === inForceId ? "current" : "renew", version: row.version, acceptedAt: row.acceptedAt };
}

/**
 * Whether the event's backoffice page draws "Declarații semnate (alergare de grup)" (§393): when
 * the run offers the declaration now, or when some are still kept — from before the organizer
 * unticked it, or from any past run, since nothing sweeps them (§503) — never merely because the
 * run is on asphalt or trail.
 */
export function showsGroupRunDeclarationsFold(offeredKey: string | null, signedCount: number): boolean {
  return offeredKey !== null || signedCount > 0;
}
