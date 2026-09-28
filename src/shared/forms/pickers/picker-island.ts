import { type RefObject, useEffect, useRef, useSyncExternalStore } from "react";
import type { SxProps, Theme } from "@mui/material/styles";

// `DateField`'s picker island: when it replaces the scriptless box, and how it acts like the
// native input it replaced (§345). `TimeField` is a typed text box since §439.

const NOTHING_TO_WATCH = () => () => undefined;

/**
 * False on the server and while hydrating, true once the island runs; until then the scriptless
 * box renders (§315). `useSyncExternalStore` so hydration matches the server's HTML.
 */
export function useIslandRunning(): boolean {
  return useSyncExternalStore(
    NOTHING_TO_WATCH,
    () => true,
    () => false,
  );
}

/**
 * Makes the picker act like the native box toward the form: a half-typed value is a custom
 * validity that stops the press, and the hidden input dispatches a bubbling `change` when the
 * posted value or refusal changes (React's value set fires none), never on first paint.
 */
export function usePickerAsNativeBox({
  field,
  posted,
  hidden,
  refused,
  refusal,
}: {
  /** The picker's own unnamed input, which constraint validation looks at. */
  field: RefObject<HTMLInputElement | null>;
  posted: string;
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

/** The picker's open and clear buttons at the 44-pixel floor (BR-REQ-041-01 criterion 6). */
export const PICKER_BUTTON_SX: SxProps<Theme> = { minWidth: 44, minHeight: 44 };
