/*
  What the clock picker beside a native time box holds and hands back (§999): «Clasament»'s «Timp» and
  «Timp cip» first. Kept apart from `ClockPicker.tsx`, which is loaded only on the first press, so that the
  box, the button and the page's one host (`ClockPickerHost.tsx`) carry these few lines and not the picker.

  Imports nothing, like `wall-values.ts` beside it: no date library reaches the page from here.
*/

/** A time on the clock's three columns: whole hours of a day (0–23, the 24-hour clock), minutes and seconds. */
export type ClockTime = { hours: number; minutes: number; seconds: number };

/** Where the clock opens when the box holds no time it can show: 0:00:00. */
export const MIDNIGHT: ClockTime = { hours: 0, minutes: 0, seconds: 0 };

export function isMidnight(time: ClockTime): boolean {
  return time.hours === 0 && time.minutes === 0 && time.seconds === 0;
}

/**
 * The query MUI X's own pickers ask to choose between their desktop popover and their phone dialog
 * (`DEFAULT_DESKTOP_MODE_MEDIA_QUERY`, without its `@media`): the clock picker asks the same one, so it opens
 * the way the backoffice's date picker (`DateField`) opens on the same screen — a popover beside the button
 * with a mouse, a dialog on a phone.
 */
export const DESKTOP_POINTER_QUERY = "(pointer: fine)";

/** Whether this screen is pointed at with a mouse: true outside a browser, as MUI's own default. */
export function pointsFinely(): boolean {
  return typeof window === "undefined" || typeof window.matchMedia !== "function" || window.matchMedia(DESKTOP_POINTER_QUERY).matches;
}

/** What `writeBox` needs of a box: a text input, as the DOM has it. */
export type WritableBox = { value: string; dispatchEvent: (event: Event) => boolean };

/**
 * Writes `text` into a box as typing would: the value set, then an `input` and a `change` event, bubbling, so
 * the form's own listeners (`SubmitButton`'s «Mai lipsesc:» list, the save's measures) hear it — `TimeField`'s
 * `announce`. Returns whether the box changed; a box that already holds `text` hears nothing.
 */
export function writeBox(box: WritableBox, text: string): boolean {
  if (box.value === text) return false;
  box.value = text;
  box.dispatchEvent(new Event("input", { bubbles: true }));
  box.dispatchEvent(new Event("change", { bubbles: true }));
  return true;
}
