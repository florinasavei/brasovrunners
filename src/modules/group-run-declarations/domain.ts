/**
 * The pure rules of a group run's optional self-declaration (§393), shared by the run's page, the
 * signing page and the service, with no database behind them.
 */

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
