"use client";

import CalendarMonthIcon from "@mui/icons-material/CalendarMonth";
import Box from "@mui/material/Box";
import { useRef } from "react";
import { openNativePicker, pickerValue } from "./birth-date-picker";

/**
 * The calendar button at the end of the birth-date box (§561 amended, §773; the owner, 2026-10-16: «la formularul de
 * voluntari aș vrea datepicker la data nașterii»): a press opens the browser's own date picker — the phone's wheel,
 * the desktop's calendar — and the day chosen is written into the typed box by `BirthDateField` (`onPick`), the one
 * source of truth. §345 keeps MUI X and its date library off the public pages, and still does: the picker here is
 * the browser's, through a hidden `<input type="date">` this component owns.
 *
 * The hidden input is only a handle. It has no `name`, so it posts nothing; it is out of the tab order and hidden
 * from a screen reader (the button is the control); it is laid over the button, transparent, so the browser opens
 * its calendar beside the box rather than at a corner of the page. Its `min` and `max` are the box's bounds, so
 * the wheel refuses a year the server would refuse, and it holds the box's day while that day is inside them —
 * the picker opens on it — and nothing otherwise, because a control holding a day outside its own bounds is
 * invalid, and a browser will not submit a form for an invalid control nobody can see.
 *
 * Drawn by the island only: `BirthDateField` mounts it after hydration, so with scripts off the box is the plain
 * text box of §561 with no button that does nothing.
 */
export default function BirthDatePicker({
  id,
  label,
  text,
  min,
  max,
  onPick,
}: {
  /** The box's id: the hidden input's test id is derived from it, so a card with many boxes has no two alike. */
  id: string;
  /** The button's accessible name: «Alege data din calendar». */
  label: string;
  /** What the box holds now. */
  text: string;
  /** The box's bounds, `YYYY-MM-DD`. */
  min: string;
  max: string;
  /** The picker's `YYYY-MM-DD` — a chosen day; the box writes it. */
  onPick: (picked: string) => void;
}) {
  const handle = useRef<HTMLInputElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  return (
    <Box component="span" sx={{ position: "relative", display: "inline-flex", mr: -1 }}>
      {/* A plain `<button>` drawn here, as `PictureLightbox` and `RouteMapTabs` draw theirs: a bare MUI IconButton would need an allowlist line in `primitives.test.ts`. The title is the tooltip a mouse user reads. */}
      <Box
        component="button"
        type="button"
        ref={button}
        aria-label={label}
        title={label}
        onClick={() => {
          if (handle.current) openNativePicker(handle.current);
        }}
        sx={{
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          width: 44,
          height: 44,
          m: 0,
          p: 0,
          border: 0,
          borderRadius: "50%",
          bgcolor: "transparent",
          color: "action.active",
          cursor: "pointer",
          "&:hover": { bgcolor: "action.hover" },
          "&:focus-visible": { outline: 2, outlineStyle: "solid", outlineColor: "primary.main", outlineOffset: -2 },
        }}
      >
        <CalendarMonthIcon fontSize="small" />
      </Box>
      <input
        ref={handle}
        type="date"
        data-testid={`${id}-native`}
        tabIndex={-1}
        aria-hidden="true"
        min={min}
        max={max}
        value={pickerValue(text, min, max)}
        onChange={(event) => {
          // Focus goes back to the button (not to the typed box: on a phone that would raise the keyboard over the form as the wheel closes), never left on the hidden handle.
          button.current?.focus();
          onPick(event.currentTarget.value);
        }}
        style={{ position: "absolute", inset: 0, width: "100%", height: "100%", margin: 0, padding: 0, border: 0, opacity: 0, pointerEvents: "none" }}
      />
    </Box>
  );
}
