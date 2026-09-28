/**
 * An event read with its date, as every dated surface needs it (`DECISIONS.md` §NNN).
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
