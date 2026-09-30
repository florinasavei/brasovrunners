/**
 * The times «Când» says, in one place (§590): the event page, its hero and card
 * (`ui/EventFacts.tsx`), the emails' facts block (`notifications/domain/event-facts.ts`, §392)
 * and the calendar's description (`ical.ts`, §107) all ask this, and only word the answer.
 *
 * - A race with its own gun time (§71): «08:30 (start eveniment) · 10:00 (start cursă)» — two
 *   times, each named (§NNN; it said «întâlnire la 08:30 · start la 10:00» before). On the site the
 *   race start's time is led by a chequered flag; the emails and the `.ics` keep the words alone.
 * - A race whose gun time is the event's start, or is not set yet (`race_starts_at` null — the
 *   editor's «Startul cursei nu e stabilit»): the one time, «08:30 (start eveniment)» (#305) —
 *   never «întâlnire» with nothing after it. With the gun time not set, `raceStartLater` asks the
 *   page to say «Ora startului cursei se anunță.» under it, once.
 * - Anything else: the one time, bare, as before.
 *
 * `key` is the `Event` catalogue's key for the time (`eventStartAt`, `raceStartAt`), or null for a
 * bare time; the caller formats `at` in the event's own zone. `raceStartAt` is said only beside
 * the event's start, so the flag the site draws before it is never alone.
 */
export type WhenTime = { key: "eventStartAt" | "raceStartAt" | null; at: Date };

export type WhenTimes = { times: WhenTime[]; raceStartLater: boolean };

export function whenTimes(event: { type?: string | null; startsAt: Date; raceStartsAt?: Date | null }): WhenTimes {
  const race = event.raceStartsAt ?? null;
  if (race && race.getTime() !== event.startsAt.getTime()) {
    return {
      times: [
        { key: "eventStartAt", at: event.startsAt },
        { key: "raceStartAt", at: race },
      ],
      raceStartLater: false,
    };
  }
  if (event.type === "RACE" || race) {
    return { times: [{ key: "eventStartAt", at: event.startsAt }], raceStartLater: race === null };
  }
  return { times: [{ key: null, at: event.startsAt }], raceStartLater: false };
}
