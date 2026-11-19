"use client";

import { createContext, lazy, type ReactNode, Suspense, useCallback, useContext, useEffect, useRef, useState } from "react";
import { type ClockTime, MIDNIGHT, pointsFinely, writeBox } from "./clock-values";

/**
 * The page's ONE clock picker (§999; the owner, 2026-11-19, on «Clasament»'s «Timp»: «aici vreau "timepicker"»), shared
 * by every time box on it: a race has a few hundred lines, and a picker per box would be a few hundred pickers.
 *
 * - **A box asks, the host answers.** A box's button calls the function `useClockPicker` hands it with the box, the
 *   button and the box's own reading of its text; the host opens the picker there, at that time (or 0:00:00).
 * - **Loaded on the first press.** `ClockPicker.tsx` — MUI X's multi-section clock in a popover or a dialog — is a
 *   dynamic import, rendered only once a box asked: the page's first load, and its lines, carry this file alone.
 * - **«OK» writes the box as typing would** (`writeBox`: the value, then `input` and `change`), in the shape the
 *   box's own `write` gives; «Anulează», Escape and a press outside write nothing.
 * - **Focus comes back** to the box after «OK» with a mouse, so the keyboard goes on from there; on a phone to the
 *   button — a box focused there raises the keyboard over the lines, the lesson of the volunteers' calendar
 *   button (§773) — and to the button after «Anulează» everywhere, as a dialog returns it.
 * - **Without scripts** there is nothing to press: the `<noscript>` rule below hides every `CLOCK_BUTTON_CLASS`
 *   button, and the box is the plain box it always was (§315). With scripts the buttons are in the server's markup
 *   from the first paint — nothing moves when the page hydrates.
 *
 * Under the backoffice's `PickerProvider` only (`pickers-backoffice-only.test.ts`): the clock needs its adapter.
 */

/** What a box hands the picker when its button is pressed. */
export type ClockRequest = {
  /** The box the picked time is written into. */
  box: HTMLInputElement;
  /** The button pressed: where the popover stands, and where focus goes back. */
  button: HTMLButtonElement;
  /** The picker's title: whose time it is — the box's own accessible name, «Timp: #101 Ana Popescu». */
  title: string;
  /** Where the clock opens for the box's text; null opens it at 0:00:00. */
  read: (text: string) => ClockTime | null;
  /** The text the box gets for a picked time. */
  write: (time: ClockTime) => string;
};

/** The picker's words, from the page's catalogue: plain strings across the boundary (§370). */
export type ClockPickerWords = {
  /** The one line under the clock: what it picks, and what is typed instead. */
  help: string;
  ok: string;
  cancel: string;
};

/** The class every box's button wears: hidden without scripts by the host's own rule. */
export const CLOCK_BUTTON_CLASS = "clock-pick";

const OpenPicker = createContext<((request: ClockRequest) => void) | null>(null);

/** The host's open function, or null outside one — a box drawn without a host draws no button. */
export function useClockPicker(): ((request: ClockRequest) => void) | null {
  return useContext(OpenPicker);
}

const ClockPicker = lazy(() => import("./ClockPicker"));

/** The `<noscript>` rule, as raw HTML: a `<noscript>`'s children are text while scripts run (§211). */
const SCRIPTLESS_RULE = { __html: `<style>.${CLOCK_BUTTON_CLASS}{display:none!important}</style>` };

type Shown = { request: ClockRequest; initial: ClockTime; opening: number };

export default function ClockPickerHost({ words, children }: { words: ClockPickerWords; children: ReactNode }) {
  const [shown, setShown] = useState<Shown | null>(null);
  const [open, setOpen] = useState(false);
  const focusAfter = useRef<HTMLElement | null>(null);

  // Stable, so the hundreds of boxes that hold it never draw again because the picker opened or closed.
  const openPicker = useCallback((request: ClockRequest) => {
    setShown((previous) => ({ request, initial: request.read(request.box.value) ?? MIDNIGHT, opening: (previous?.opening ?? 0) + 1 }));
    setOpen(true);
  }, []);

  // Once the picker has let go of the focus (its trap is off as `open` turns false), the box or the button takes it.
  useEffect(() => {
    if (open || focusAfter.current === null) return;
    focusAfter.current.focus();
    focusAfter.current = null;
  }, [open]);

  function close(picked: ClockTime | null) {
    if (shown === null) return;
    const { box, button, write } = shown.request;
    if (picked !== null) writeBox(box, write(picked));
    focusAfter.current = picked !== null && pointsFinely() ? box : button;
    setOpen(false);
  }

  return (
    <OpenPicker.Provider value={openPicker}>
      {children}
      <noscript dangerouslySetInnerHTML={SCRIPTLESS_RULE} />
      {shown !== null && (
        <Suspense fallback={null}>
          {/* Keyed on the opening: each press opens a fresh clock at the box's own time. */}
          <ClockPicker
            key={shown.opening}
            open={open}
            anchor={shown.request.button}
            title={shown.request.title}
            initial={shown.initial}
            words={words}
            onPick={(time) => close(time)}
            onCancel={() => close(null)}
          />
        </Suspense>
      )}
    </OpenPicker.Provider>
  );
}
