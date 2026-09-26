/**
 * The pure rules of a group run's optional self-declaration (§393), shared by the run's page, the
 * signing page and the service, with no database behind them.
 */
import { ADULT_AGE, ageOn, dayIn, isUnderMinimumAge } from "@/modules/registrations/domain/age";
import { GROUP_RUN_TOO_YOUNG } from "./form";

/** How long after the start the page still takes a signature: somebody at the meeting point, late. */
export const SIGNING_GRACE_MINUTES = 60;

/**
 * Whether a signature may still be taken (§393): a published event, not cancelled, whose start is
 * at most `SIGNING_GRACE_MINUTES` behind. After that the declaration would be about a run that has
 * happened, and the retention sweep is the next thing that touches it.
 */
export function signingOpen(event: { editorialStatus: string; eventStatus: string; startsAt: Date }, now: Date): boolean {
  return (
    event.editorialStatus === "PUBLISHED" &&
    event.eventStatus !== "CANCELLED" &&
    now.getTime() <= event.startsAt.getTime() + SIGNING_GRACE_MINUTES * 60_000
  );
}

/**
 * The minimum age a group run's self-declaration actually states and asks for (§440): the event's
 * own `min_age` (§329) only when it is above eighteen, zero otherwise. The declaration is for adults
 * (§393, §418): its opening says "am împlinit 18 ani" and the consent box repeats it, so a minimum of
 * eighteen or less binds nobody the text does not already bind. Stating it would read as a second,
 * contradictory age ("am împlinit 18 ani… am cel puțin 14 ani"), and asking a birth date for it would
 * collect data for no purpose (GDPR art. 5(1)(c), the reason §418 took the identity number off this
 * text). The column defaults to fourteen, so on most runs this is zero: no sentence, no birth date.
 * Admitting minors of 14–17 would change the opening and the consent box — a legal-text decision.
 */
export function groupRunMinimumAge(minAge: number): number {
  return minAge > ADULT_AGE ? minAge : 0;
}

/**
 * The run's minimum age at the signing page's door (§440, amending §393): the event's own number
 * (§329) as `groupRunMinimumAge` binds it, counted on the run's day in the run's zone by `isUnderMinimumAge` — the rule the race's
 * registration door asks (`minimumAgeRule`), never a second one. Nothing is asked of a run with no
 * minimum. A missing or unreadable date names the box; a date under the minimum names the box and
 * the marker, so the page says the number rather than "fill it in".
 */
export function birthDateRefusal(
  event: { minAge: number; startsAt: Date; timezone: string },
  birthDate: string | undefined,
): string[] {
  const minAge = groupRunMinimumAge(event.minAge);
  if (minAge <= 0) return [];
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
 * How many days after the run's start the platform deletes its self-declarations (§393). One
 * number for the sweep (`RETENTION.groupRunDeclarationsDaysAfterEvent` is this), the run's page,
 * the signing page, the backoffice fold and both emails: each says it through `durationPhrase`,
 * never as a word typed into a sentence, so changing it here changes every sentence at once.
 */
export const GROUP_RUN_DECLARATION_RETENTION_DAYS = 7;

/**
 * Whether the event's backoffice page draws "Declarații semnate (alergare de grup)" (§393): when
 * the run offers the declaration now, or when some are still kept from before the organizer
 * unticked it — never merely because the run is on asphalt or trail.
 */
export function showsGroupRunDeclarationsFold(offeredKey: string | null, signedCount: number): boolean {
  return offeredKey !== null || signedCount > 0;
}
