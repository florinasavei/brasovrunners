import { isDateValue, readTypedDate, shownTypedDate } from "@/shared/forms/pickers/wall-values";

/*
  The calendar button of the birth-date box (§561 amended, §773): what is decided without a DOM, so the
  unit tests (which run in Node) can reach it. The box stays the one source of truth — a typed text,
  masked by Maskito — and the browser's own date picker is only a way to fill it: `BirthDatePicker.tsx`
  draws the button and the hidden `<input type="date">` it opens; these functions say what the hidden
  input holds, how it is opened, and what a chosen day writes into the box. §345 is untouched: no MUI X
  and no date library on a public page, the platform's own picker is the browser's.
*/

/**
 * What the hidden date input holds for the box's text: the box's day when it is a real one inside the
 * box's bounds, otherwise nothing. Never an out-of-range day — a native date input holding one is
 * invalid (`rangeUnderflow`), and the browser would refuse to submit the form for a control nobody sees.
 */
export function pickerValue(text: string, min: string, max: string): string {
  const date = readTypedDate(text);
  return date !== "" && date >= min && date <= max ? date : "";
}

/** The picker's `YYYY-MM-DD` as the box shows a date (`11.05.1990`); "" when the picker gave no day (cleared) or a shape that is no date. */
export function typedFromPicked(picked: string): string {
  return isDateValue(picked) ? shownTypedDate(picked) : "";
}

/** What `openNativePicker` needs of the input: `showPicker` is missing in a browser without it. */
export type PickerHandle = {
  showPicker?: () => void;
  focus: () => void;
  click: () => void;
};

/**
 * Opens the browser's own date picker: `showPicker()` (Chrome, Edge, Safari 16+, Firefox 101+). Where it
 * is missing, or throws — an insecure context, an input the browser will not draw, a press that is not a
 * user's — the input is focused and clicked instead, which is the most the browser lets a page ask.
 * Never throws: the button is a convenience and the typed box beside it always works. Returns which road
 * was taken, for the tests.
 */
export function openNativePicker(handle: PickerHandle): "picker" | "focused" {
  try {
    if (typeof handle.showPicker === "function") {
      handle.showPicker();
      return "picker";
    }
  } catch {
    // Falls through to the focus below.
  }
  try {
    handle.focus();
    handle.click();
  } catch {
    // A handle that cannot even be focused leaves the typed box as the way in.
  }
  return "focused";
}

/** What `writePickedDay` needs of the box: a text input, as the DOM has it. */
export type BoxHandle = {
  value: string;
  dispatchEvent: (event: Event) => boolean;
};

/**
 * Writes the chosen day into the typed box as a person's typing would: the value set, then an `input`
 * event that bubbles — Maskito's listener (the mask), our `onInput` (the echo, the minimum-age helper,
 * the custom validity) and the islands that read the box by its id (`use-birth-date-minor.ts`) all hear
 * it, in that order. Returns what the box now holds, or "" when the picker gave no day and the box is
 * left as it was.
 */
export function writePickedDay(box: BoxHandle, picked: string): string {
  const typed = typedFromPicked(picked);
  if (typed === "") return "";
  box.value = typed;
  box.dispatchEvent(new Event("input", { bubbles: true }));
  return typed;
}
