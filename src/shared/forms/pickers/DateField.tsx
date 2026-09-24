"use client";

import TextField from "@mui/material/TextField";
import type { SxProps, Theme } from "@mui/material/styles";
import { DatePicker } from "@mui/x-date-pickers/DatePicker";
import type { Dayjs } from "dayjs";
import { useTranslations } from "next-intl";
import { useRef, useState } from "react";
import { useRecall } from "@/shared/forms/recall";
import { PICKER_BUTTON_SX, useIslandRunning, usePickerAsNativeBox } from "./picker-island";
import { pickerDate, postedDate } from "./picker-values";
import { DATE_DISPLAY_FORMAT, DATE_PATTERN } from "./wall-values";

export type DateFieldProps = {
  /** What the form posts, unchanged: `event.startsAtDate`, `repeat.until`, `takenOn`… */
  name: string;
  label: string;
  /** `YYYY-MM-DD`, or "" for an empty box. A refused submit's value wins over it (§315). Ignored when `value` is given. */
  defaultValue?: string;
  /**
   * A controlled value, for a box a parent must be able to move from outside a press —
   * `ScheduleRowsEditor`'s rows following the event's start date (`shiftProgrammeDates`). When
   * given, the box's own refusal lookup is skipped: the caller already seeded it from the same
   * refusal (`recalledRows`), and a stale posted value under this row's *current* index would
   * otherwise shadow a shift that happened after the press.
   */
  value?: string;
  required?: boolean;
  helperText?: string;
  size?: "small" | "medium";
  sx?: SxProps<Theme>;
  /** Told the posted value on every change — `ScheduleRowsEditor` keeps a row's date in state. */
  onValueChange?: (posted: string) => void;
  /**
   * A button that empties the box; defaults to on for an optional date, off when required — as
   * `TimeField`'s own `clearable` does. `ScheduleRowsEditor` turns it off for its narrow row date
   * (150 pixels): a calendar button and a clear button are both held to a 44-pixel target
   * (BR-REQ-041-01 criterion 6), and two of them beside `DD.MM.YYYY` collided with the digits on a
   * phone the way the row's own time boxes did before they turned theirs off too — the row itself
   * still empties with its own remove button.
   */
  clearable?: boolean;
};

/**
 * A date in the backoffice, on MUI's date picker: `30.09.2026`, day first, with a calendar in the
 * backoffice's language (`DECISIONS.md` §NNN; the owner, over "09/30/2026": "timepickerul ar
 * trebui să fie tot element MUI"). A native `<input type="date">` prints the digits in the
 * *browser's* order, and nothing a page does changes that (§70).
 *
 * **What it posts has not changed:** `YYYY-MM-DD` under the same name, from a hidden input beside
 * the picker, so `admin/actions.ts` and every service read exactly what they read before, and a
 * refused submit brings the value back (`useRecall`) in the shape it went. The picker's own
 * input, which posts the *shown* text, is given no name.
 *
 * **Without JavaScript** the server's HTML is the scriptless box: a text input that takes
 * `YYYY-MM-DD` and refuses anything else by its `pattern`, posting under the same name. That is
 * the one shape the server reads, typed or picked; a second one (`dd.MM.yyyy` parsed on the
 * server) would be a parser to keep for a browser nobody on the club's staff uses.
 *
 * That box is also what a normal page paints first, with JavaScript on: the picker takes over
 * only once the island runs (`useIslandRunning`), so every visit briefly shows `2026-09-30` and
 * the `YYYY-MM-DD` placeholder before the swap to `30.09.2026`. The picker is seeded from
 * `initial`, not read back from the scriptless box's own DOM value, so anything typed into it in
 * that brief window is lost at the swap rather than carried into the picker.
 *
 * Needs `PickerProvider` above it — the backoffice's layout mounts it once.
 */
export default function DateField({ name, label, defaultValue = "", value, required = false, helperText, size, sx, onValueChange, clearable }: DateFieldProps) {
  const recall = useRecall();
  const t = useTranslations("Admin");
  const running = useIslandRunning();
  const initial = value !== undefined ? value : (recall.value(name) ?? defaultValue);
  const named = recall.named(name);
  const id = recall.idOf(name);
  const help = named && recall.fieldError ? recall.fieldError : helperText;

  if (!running) {
    return (
      <TextField
        key={recall.generation}
        id={id}
        name={name}
        label={label}
        defaultValue={initial}
        required={required}
        error={named}
        helperText={help}
        size={size}
        sx={sx}
        slotProps={{
          inputLabel: { shrink: true },
          htmlInput: { pattern: DATE_PATTERN, placeholder: t("pickers.datePlaceholder"), title: t("pickers.dateTyped"), maxLength: 10 },
        }}
      />
    );
  }

  return (
    <DatePickerInput
      key={recall.generation}
      id={id}
      name={name}
      label={label}
      initial={initial}
      required={required}
      error={named}
      helperText={help}
      size={size}
      sx={sx}
      refusal={t("pickers.dateIncomplete")}
      onValueChange={onValueChange}
      clearable={clearable ?? !required}
    />
  );
}

/**
 * The picker and the hidden input that posts for it. Exported for the unit test, which renders it
 * on the server and reads what it would post; pages use `DateField`.
 */
export function DatePickerInput({
  id,
  name,
  label,
  initial,
  required,
  error,
  helperText,
  size,
  sx,
  refusal,
  onValueChange,
  clearable,
}: {
  id: string;
  name: string;
  label: string;
  initial: string;
  required: boolean;
  error: boolean;
  helperText?: string;
  size?: "small" | "medium";
  sx?: SxProps<Theme>;
  refusal: string;
  onValueChange?: (posted: string) => void;
  clearable: boolean;
}) {
  const [picked, setPicked] = useState<Dayjs | null>(() => pickerDate(initial));
  const [refused, setRefused] = useState(false);
  const field = useRef<HTMLInputElement>(null);
  const hidden = useRef<HTMLInputElement>(null);

  // Follows a controlled `initial` (`DateField`'s `value`) moved from outside the picker — the
  // programme's rows shifting with the event's start date. Adjusted during render rather than in
  // an effect (react.dev/learn/you-might-not-need-an-effect#adjusting-some-state-when-a-prop-
  // changes): an effect would commit the stale value for one frame and cascade a second render
  // on every keystroke, where this resolves before the box ever paints. A pick made *here* has
  // already set `picked` (and, through `onValueChange`, the caller's own `initial` for the next
  // render) to the same value, so the two agree and nothing below fires; only a genuinely
  // external move — never one this box just reported — does.
  const [trackedInitial, setTrackedInitial] = useState(initial);
  if (initial !== trackedInitial) {
    setTrackedInitial(initial);
    if (initial !== postedDate(picked)) setPicked(pickerDate(initial));
  }

  const posted = postedDate(picked);
  usePickerAsNativeBox({ field, posted, hidden, refused, refusal });

  return (
    <>
      <DatePicker
        value={picked}
        onChange={(next) => {
          setPicked(next);
          onValueChange?.(postedDate(next));
        }}
        onError={(reason) => setRefused(reason !== null)}
        format={DATE_DISPLAY_FORMAT}
        label={label}
        inputRef={field}
        sx={sx}
        slotProps={{
          // `error` only when the refusal named the box: `false` would hide the picker's own red.
          textField: { id, required, error: error || undefined, helperText, size },
          // An optional date can be emptied again with one press, as the native box could —
          // unless the caller turned it off for a box too narrow to hold both buttons.
          field: { clearable },
          openPickerButton: { sx: PICKER_BUTTON_SX },
          clearButton: { sx: PICKER_BUTTON_SX },
        }}
      />
      <input ref={hidden} type="hidden" name={name} value={posted} />
    </>
  );
}
