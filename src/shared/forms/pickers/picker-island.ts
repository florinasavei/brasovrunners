import { type RefObject, useEffect, useRef, useSyncExternalStore } from "react";
import type { SxProps, Theme } from "@mui/material/styles";

/*
  What `DateField` needs from a picker (`DECISIONS.md` §345): when it takes over from the
  scriptless box, and how it behaves like the native input it replaced in front of the rest of
  the form. `TimeField` no longer shares this — since §400 and §439 it is a typed 24-hour text
  box, with no island to swap in.
*/

const NOTHING_TO_WATCH = () => () => undefined;

/**
 * False on the server and while the page hydrates, true once the island runs.
 *
 * The server renders the scriptless box — a plain text input with a `pattern` — because a picker
 * cannot be typed into without JavaScript, and §315 says the backoffice's forms work without it.
 * `useSyncExternalStore` rather than an effect setting state: hydration matches the server's
 * HTML, and the picker replaces the box in the render straight after.
 */
export function useIslandRunning(): boolean {
  return useSyncExternalStore(
    NOTHING_TO_WATCH,
    () => true,
    () => false,
  );
}

/**
 * The picker, seen from the form, as the native box was.
 *
 * - **The browser refuses a half-typed box.** A native date box with only a day in it is
 *   `badInput` and stops the press; a picker's is merely red. The picker's own input — named
 *   nothing, required when the box is — takes `refusal` as its custom validity while the picker
 *   reports an error, so the press stops with the sentence and `SubmitButton` names the box.
 * - **The form hears a change.** `ScheduleRowsEditor` moves the programme with the start date,
 *   and `SubmitButton` re-measures what is missing, both on the form's `change` event. A hidden
 *   input's value set by React fires nothing, so the posted input sends one, bubbling, exactly
 *   when the posted value or the refusal changes — never on the first paint.
 */
export function usePickerAsNativeBox({
  field,
  posted,
  hidden,
  refused,
  refusal,
}: {
  /** The picker's own (unnamed) input: what constraint validation looks at. */
  field: RefObject<HTMLInputElement | null>;
  posted: string;
  /** The hidden input that carries the posted value under the form's name. */
  hidden: RefObject<HTMLInputElement | null>;
  refused: boolean;
  refusal: string;
}) {
  const announced = useRef(`${posted}|${refused}`);
  useEffect(() => {
    field.current?.setCustomValidity(refused ? refusal : "");
    const now = `${posted}|${refused}`;
    if (announced.current === now) return;
    announced.current = now;
    hidden.current?.dispatchEvent(new Event("change", { bubbles: true }));
  }, [field, hidden, posted, refused, refusal]);
}

/**
 * The two buttons inside a picker box — open the calendar or the clock, clear the box — at the
 * 44-pixel floor (BR-REQ-041-01 criterion 6): on a phone they are what the thumb presses, and a
 * small box's default is a 28-pixel target.
 */
export const PICKER_BUTTON_SX: SxProps<Theme> = { minWidth: 44, minHeight: 44 };
