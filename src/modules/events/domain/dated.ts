/**
 * An event read with its date, as every dated surface needs it (`DECISIONS.md` §533).
 *
 * Pure: an event page's read has `startsAt: null` while its date is to be announced
 * (`events/repository.ts`, `UNDATED_PUBLIC_COLUMNS`); a surface that places the event in time —
 * the structured data, the forecast, the calendar entry, the countdown — asks this first.
 */
export type Dated<E extends { startsAt: Date | null }> = E & { startsAt: Date };

/** The event itself when its date is announced, or null while it is to be announced. */
export function datedOrNull<E extends { startsAt: Date | null }>(event: E): Dated<E> | null {
  return event.startsAt === null ? null : (event as Dated<E>);
}

/**
 * "The start is not announced" (§533): its date, or only its time. One rule for both — registration
 * stays «în curând», no door takes anybody, the calendar leaves it out — asked of a row that carries
 * the two switches; absent on a partial row (a fixture) is the columns' default, false.
 */
export function startHeldBack(event: { dateToBeAnnounced?: boolean | null; timeToBeAnnounced?: boolean | null }): boolean {
  return event.dateToBeAnnounced === true || event.timeToBeAnnounced === true;
}

/**
 * The announced day as an instant a date formatter can read (§533): noon UTC on `YYYY-MM-DD`,
 * formatted in UTC, so the day printed is the day the query computed on the event's own calendar —
 * never shifted by a zone, and carrying no hour of the event's.
 */
export function announcedDayInstant(day: string): Date {
  return new Date(`${day}T12:00:00.000Z`);
}
