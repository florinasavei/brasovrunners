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
  /** The posted name: `event.startsAtDate`, `repeat.until`, `takenOn`… */
  name: string;
  label: string;
  /** `YYYY-MM-DD`, or "" for an empty box. A refused submit's value wins over it (§315). Ignored when `value` is given. */
  defaultValue?: string;
  /**
   * Controlled, for a box a parent moves (`ScheduleRowsEditor`'s rows following the start date).
   * Skips the refusal lookup: the caller seeds it, and a stale value by index would shadow a shift.
   */
  value?: string;
  required?: boolean;
  helperText?: string;
  size?: "small" | "medium";
  sx?: SxProps<Theme>;
  /** Called with the posted value on every change. */
  onValueChange?: (posted: string) => void;
  /**
   * A clear button; on for an optional date by default. Off in a narrow box, where two 44-pixel
   * buttons (BR-REQ-041-01 criterion 6) collide with the digits on a phone.
   */
  clearable?: boolean;
};

/**
 * A backoffice date on MUI's picker, shown day first (`30.09.2026`) whatever the browser's
 * locale, which a native `<input type="date">` cannot do (§345, §70). It posts `YYYY-MM-DD` from
 * a hidden input; the picker's own input has no name.
 *
 * Without JavaScript, and until the island runs, it is a text box taking `YYYY-MM-DD` by
 * `pattern` — the one shape the server reads. Anything typed before the swap is lost.
 * Needs `PickerProvider` above it.
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

/** The picker and its posting hidden input; exported for `tests/unit/shared/pickers-running.test.ts`. */
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

  // Follows a controlled `initial` moved from outside, adjusted during render (an effect would
  // paint the stale value first). A pick made here already agrees, so only an external move fires.
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
          field: { clearable },
          openPickerButton: { sx: PICKER_BUTTON_SX },
          clearButton: { sx: PICKER_BUTTON_SX },
        }}
      />
      <input ref={hidden} type="hidden" name={name} value={posted} />
    </>
  );
}
