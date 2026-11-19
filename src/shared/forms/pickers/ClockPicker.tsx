"use client";

import Box from "@mui/material/Box";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import Popover from "@mui/material/Popover";
import Typography from "@mui/material/Typography";
import useMediaQuery from "@mui/material/useMediaQuery";
import { MultiSectionDigitalClock } from "@mui/x-date-pickers/MultiSectionDigitalClock";
import dayjs, { type Dayjs } from "dayjs";
import { useId, useState } from "react";
import GlyphButton from "@/shared/ui/GlyphButton";
import { type ClockTime, DESKTOP_POINTER_QUERY, isMidnight, MIDNIGHT } from "./clock-values";
import type { ClockPickerWords } from "./ClockPickerHost";

/**
 * The clock the page's host opens beside a time box (§NNN), loaded by `ClockPickerHost` on the first press and never
 * before: MUI X's `MultiSectionDigitalClock` — hours, minutes and seconds as three scrollable columns, every minute
 * and every second — with the one line of help and «Anulează» / «OK». The house's date picker's two shapes
 * (`DateField`, §345): a popover beside the button with a mouse, a dialog on a phone (`DESKTOP_POINTER_QUERY`).
 *
 * **On the 24-hour clock, in both languages, whatever the browser speaks** (§439): `ampm={false}` is passed, so no
 * AM/PM column is drawn and the hours read 00 to 23 — the adapter's language (`PickerProvider`: `ro`, `en-gb`) is
 * never asked which clock to use.
 *
 * The clock's value is a Day.js instant on a fixed day with no change of clock anywhere — 15 January, as MUI X's own
 * labels anchor theirs — so a picked 2:30 is 2:30 in every zone; only its hours, minutes and seconds leave this file.
 */

/** A clock time as the clock's own value: that time of a fixed winter day, in the browser's zone. */
function onTheClock(time: ClockTime): Dayjs {
  return dayjs(new Date(2001, 0, 15, time.hours, time.minutes, time.seconds, 0));
}

function clockTimeOf(value: Dayjs): ClockTime {
  return { hours: value.hour(), minutes: value.minute(), seconds: value.second() };
}

const VIEWS = ["hours", "minutes", "seconds"] as const;
/** Every hour, every minute, every second: a result is to the second (MUI's default steps are five minutes and five seconds). */
const EVERY_ONE = { hours: 1, minutes: 1, seconds: 1 } as const;
const REFERENCE = onTheClock(MIDNIGHT);

/**
 * The picker's inside — the clock, the help line and the two buttons — drawn by both shapes. Exported for
 * `tests/unit/shared/clock-picker.test.ts`, which renders it on the server and reads the columns; pages open the
 * picker through `ClockPickerHost`.
 */
export function ClockPanel({
  initial,
  words,
  titleId,
  title,
  inDialog,
  onPick,
  onCancel,
}: {
  initial: ClockTime;
  words: ClockPickerWords;
  titleId: string;
  title: string;
  /** In the phone's dialog, the title and the buttons are the dialog's own parts. */
  inDialog: boolean;
  onPick: (time: ClockTime) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState<Dayjs>(() => onTheClock(initial));
  const picked = clockTimeOf(value);
  const clock = (
    <MultiSectionDigitalClock
      value={value}
      onChange={(next) => {
        if (next !== null && next.isValid()) setValue(next);
      }}
      referenceDate={REFERENCE}
      views={VIEWS}
      timeSteps={EVERY_ONE}
      ampm={false}
      autoFocus
      // The 44-pixel floor for every hour, minute and second a thumb presses (BR-REQ-041-01 criterion 6) — at every width: a menu
      // item's own height drops to `auto` from `sm` up, so the floor is written for both ends of the scale.
      slotProps={{ digitalClockSectionItem: { sx: { minHeight: { xs: 44, sm: 44 } } } }}
      data-testid="time-picker-clock"
    />
  );
  const help = (
    <Typography variant="caption" color="text.secondary" component="p" sx={{ mt: 1, maxWidth: 260 }} data-testid="time-picker-help">
      {words.help}
    </Typography>
  );
  const buttons = (
    <>
      <GlyphButton icon="dismiss" type="button" onClick={onCancel} sx={{ minHeight: 44 }} data-testid="time-picker-cancel">
        {words.cancel}
      </GlyphButton>
      {/* 0:00:00 is no race time: «OK» waits for a column to be picked. */}
      <GlyphButton icon="confirm" type="button" variant="contained" disabled={isMidnight(picked)} onClick={() => onPick(picked)} sx={{ minHeight: 44 }} data-testid="time-picker-ok">
        {words.ok}
      </GlyphButton>
    </>
  );
  if (inDialog) {
    return (
      <>
        <DialogTitle id={titleId} sx={{ overflowWrap: "anywhere" }}>
          {title}
        </DialogTitle>
        <DialogContent sx={{ pb: 0 }}>
          {clock}
          {help}
        </DialogContent>
        <DialogActions>{buttons}</DialogActions>
      </>
    );
  }
  return (
    <Box sx={{ p: 1.5 }}>
      <Typography id={titleId} variant="subtitle2" component="p" sx={{ mb: 1, maxWidth: 260, overflowWrap: "anywhere" }}>
        {title}
      </Typography>
      {clock}
      {help}
      <Box sx={{ display: "flex", justifyContent: "flex-end", gap: 1, mt: 1 }}>{buttons}</Box>
    </Box>
  );
}

export default function ClockPicker({
  open,
  anchor,
  title,
  initial,
  words,
  onPick,
  onCancel,
}: {
  open: boolean;
  anchor: HTMLElement;
  title: string;
  initial: ClockTime;
  words: ClockPickerWords;
  onPick: (time: ClockTime) => void;
  onCancel: () => void;
}) {
  // Read at once (`noSsr`): this file is drawn in the browser only, after a press, and must not open as a dialog and then move.
  const desktop = useMediaQuery(`@media ${DESKTOP_POINTER_QUERY}`, { noSsr: true });
  const titleId = `time-picker-title-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const panel = <ClockPanel initial={initial} words={words} titleId={titleId} title={title} inDialog={!desktop} onPick={onPick} onCancel={onCancel} />;
  // The host gives the focus back itself (the box after «OK», the button otherwise): neither shape restores it.
  if (!desktop) {
    return (
      <Dialog open={open} onClose={onCancel} aria-labelledby={titleId} disableRestoreFocus data-testid="time-picker" data-shape="dialog">
        {panel}
      </Dialog>
    );
  }
  return (
    <Popover
      open={open}
      anchorEl={anchor}
      onClose={onCancel}
      disableRestoreFocus
      anchorOrigin={{ vertical: "bottom", horizontal: "right" }}
      transformOrigin={{ vertical: "top", horizontal: "right" }}
      // A popover's paper is no dialog by itself: it is named one, by its title, for a screen reader.
      slotProps={{ paper: { role: "dialog", "aria-labelledby": titleId } }}
      data-testid="time-picker"
      data-shape="popover"
    >
      {panel}
    </Popover>
  );
}
