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
  /** `YYYY-MM-DD`, or "" for an empty box. A refused submit's value wins over it (§315). */
  defaultValue?: string;
  required?: boolean;
  helperText?: string;
  size?: "small" | "medium";
  sx?: SxProps<Theme>;
  /** Told the posted value on every change — `ScheduleRowsEditor` keeps a row's date in state. */
  onValueChange?: (posted: string) => void;
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
 * Needs `PickerProvider` above it — the backoffice's layout mounts it once.
 */
export default function DateField({ name, label, defaultValue = "", required = false, helperText, size, sx, onValueChange }: DateFieldProps) {
  const recall = useRecall();
  const t = useTranslations("Admin");
  const running = useIslandRunning();
  const initial = recall.value(name) ?? defaultValue;
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
}) {
  const [picked, setPicked] = useState<Dayjs | null>(() => pickerDate(initial));
  const [refused, setRefused] = useState(false);
  const field = useRef<HTMLInputElement>(null);
  const hidden = useRef<HTMLInputElement>(null);
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
          // An optional date can be emptied again with one press, as the native box could.
          field: { clearable: !required },
          openPickerButton: { sx: PICKER_BUTTON_SX },
          clearButton: { sx: PICKER_BUTTON_SX },
        }}
      />
      <input ref={hidden} type="hidden" name={name} value={posted} />
    </>
  );
}
