import { fromWallTimeInput, toWallTimeInput } from "./zoned-time";

/**
 * A start the organizer left blank while it is to be announced (`DECISIONS.md` §NNN, amending §533).
 *
 * The owner, 2026-09-28: «în V2.23 trebuie să pot să nu pun data și ora evenimentului!». With
 * «Data se anunță mai târziu» ticked the date and the hour may both stay empty; with «Ora se anunță
 * mai târziu» alone the hour may. `starts_at` stays NOT NULL (§533's reason: the jobs, the emails and
 * the allocator read it, and each would have to decide what an event without a start means), so the
 * platform stores a **provisional start** in place of the empty part, and this module is the one
 * place that writes it and reads it back:
 *
 * - **no date** — the day `UNDATED_DAY`, 1 January 9999, on the event's own calendar. Far enough that
 *   no job's window reaches it: the reminder, the declaration's window, the thank-you (which needs a
 *   start behind it) and the race week all count from the start. The hour typed beside it, if any, is
 *   kept on that day, so it comes back in its box;
 * - **no hour** — the day typed, at `NO_HOUR` — noon and one second. The time box types whole minutes
 *   (`HH:mm`), so a second past the minute is a value no organizer can type: it says "left blank" and
 *   nothing else. Noon, so the day is the same on every clock the event could be read on.
 *
 * Nothing public ever reads either: every public read withholds the start while it is held back
 * (`UNDATED_PUBLIC_COLUMNS`, §533), and the save refuses a blank start once the switch is off.
 */
export const UNDATED_DAY = "9999-01-01";

/** The wall-clock hour stored for a blank hour: noon and one second, which the `HH:mm` box never posts. */
const NO_HOUR = "12:00:01";

/** The start's two boxes as the form posted them: `YYYY-MM-DD` and `HH:mm`, each "" when left empty. */
export type StartBoxes = { date: string; time: string };

/** The wall-clock value the service stores for the boxes: the provisional parts in place of the empty ones. */
export function provisionalStartWallTime(boxes: StartBoxes): string {
  return `${boxes.date || UNDATED_DAY}T${boxes.time || NO_HOUR}`;
}

/** Which part of a stored start the organizer left blank — both false for every start that was typed. */
export function blankStartParts(startsAt: Date, timeZone: string): { date: boolean; time: boolean } {
  return {
    date: toWallTimeInput(startsAt, timeZone).slice(0, 10) === UNDATED_DAY,
    // Zone offsets are whole minutes, so the second is the same on every clock.
    time: startsAt.getUTCSeconds() === 1 && startsAt.getUTCMilliseconds() === 0,
  };
}

/** What the start's boxes show for a stored start: "" for a part left blank (§NNN), never the provisional value. */
export function startBoxValues(startsAt: Date | null, timeZone: string): StartBoxes {
  if (!startsAt) return { date: "", time: "" };
  const wall = toWallTimeInput(startsAt, timeZone);
  const blank = blankStartParts(startsAt, timeZone);
  return { date: blank.date ? "" : wall.slice(0, 10), time: blank.time ? "" : wall.slice(11, 16) };
}

/**
 * A stored start for a staff surface that places the event on a calendar — the backoffice list, a
 * card's closed line, a picker — or null while no date was typed, so none of them prints 9999.
 */
export function typedStartOrNull(event: { startsAt: Date; timezone: string }): Date | null {
  return blankStartParts(event.startsAt, event.timezone).date ? null : event.startsAt;
}

/**
 * The start's posted value read back into its boxes. The form posts `YYYY-MM-DDTHH:mm` when both are
 * typed, the date alone, `THH:mm` for an hour alone, or "" (`admin/actions.ts`); a script or a test
 * posts the whole value. Null for anything else, which the service refuses as not a date and time.
 */
export function readStartBoxes(posted: string): StartBoxes | null {
  const value = posted.trim();
  if (value === "") return { date: "", time: "" };
  // Seconds, when a caller sends them, are dropped: no typed start may carry `NO_HOUR`'s second.
  const whole = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})(?::\d{2})?$/.exec(value);
  if (whole) return { date: whole[1], time: whole[2] };
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return { date: value, time: "" };
  const hourOnly = /^T(\d{2}:\d{2})$/.exec(value);
  if (hourOnly) return { date: "", time: hourOnly[1] };
  return null;
}

/** The instant of a whole, typed start, or null when either box is empty or the value is not one. */
export function typedStart(boxes: StartBoxes, timeZone: string): Date | null {
  if (!boxes.date || !boxes.time) return null;
  return fromWallTimeInput(`${boxes.date}T${boxes.time}`, timeZone);
}
