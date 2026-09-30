/**
 * The times «Când» says, in one place (§590): the event page, its hero and card
 * (`ui/EventFacts.tsx`), the emails' facts block (`notifications/domain/event-facts.ts`, §392)
 * and the calendar's description (`ical.ts`, §107) all ask this, and only word the answer.
 *
 * - A race with its own gun time (§71): «întâlnire la 08:30 · start la 10:00» — two times, each named.
 * - A race whose gun time is the event's start, or is not set yet (`race_starts_at` null — the
 *   editor's «Startul cursei nu e stabilit»): the one time, named «start la 08:30» — never
 *   «întâlnire» with nothing after it. With the gun time not set, `raceStartLater` asks the page
 *   to say «Ora startului cursei se anunță.» under it, once.
 * - Anything else: the one time, bare, as before.
 *
 * `key` is the `Event` catalogue's key for the time (`gatheringAt`, `raceStartAt`), or null for a
 * bare time; the caller formats `at` in the event's own zone.
 */
export type WhenTime = { key: "gatheringAt" | "raceStartAt" | null; at: Date };

export type WhenTimes = { times: WhenTime[]; raceStartLater: boolean };

export function whenTimes(event: { type?: string | null; startsAt: Date; raceStartsAt?: Date | null }): WhenTimes {
  const race = event.raceStartsAt ?? null;
  if (race && race.getTime() !== event.startsAt.getTime()) {
    return {
      times: [
        { key: "gatheringAt", at: event.startsAt },
        { key: "raceStartAt", at: race },
      ],
      raceStartLater: false,
    };
  }
  if (event.type === "RACE" || race) {
    return { times: [{ key: "raceStartAt", at: event.startsAt }], raceStartLater: race === null };
  }
  return { times: [{ key: null, at: event.startsAt }], raceStartLater: false };
}
