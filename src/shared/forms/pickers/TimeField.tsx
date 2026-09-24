"use client";

import TextField from "@mui/material/TextField";
import type { SxProps, Theme } from "@mui/material/styles";
import { TimePicker } from "@mui/x-date-pickers/TimePicker";
import type { Dayjs } from "dayjs";
import { useTranslations } from "next-intl";
import { useRef, useState } from "react";
import { useRecall } from "@/shared/forms/recall";
import { PICKER_BUTTON_SX, useIslandRunning, usePickerAsNativeBox } from "./picker-island";
import { pickerClock, postedClock } from "./picker-values";
import { TIME_DISPLAY_FORMAT, TIME_PATTERN } from "./wall-values";

export type TimeFieldProps = {
  /** What the form posts, unchanged: `event.startsAtTime`, `event.schedule[0].time`… */
  name: string;
  label: string;
  /** `HH:mm` on the 24-hour clock, or "". A refused submit's value wins over it (§315). */
  defaultValue?: string;
  required?: boolean;
  helperText?: string;
  size?: "small" | "medium";
  sx?: SxProps<Theme>;
  /**
   * A button that empties the box; on by default for an optional time (a programme row's end).
   * `WallTimeField` turns it off for its time half: emptying the date empties the pair, and a
   * second button would crowd a 140-pixel box.
   */
  clearable?: boolean;
};

/**
 * A time of day in the backoffice, on MUI's time picker and always on the 24-hour clock: `19:00`,
 * never `07:00 PM` (`DECISIONS.md` §NNN; the owner: "vreau ca timpul să fie mereu în format de
 * 24H, nu cu AM și PM"). `<input type="time">` posts `HH:mm` but *shows* the browser's clock, and
 * an English-language Chrome shows AM and PM whatever the page says (§70, §303).
 *
 * `ampm={false}` and the `HH:mm` format hold in both languages: the clock face on a phone is the
 * 24-hour one (13–23 on the inner ring), the columns on a desktop run 00 to 23.
 *
 * **What it posts has not changed:** `HH:mm` under the same name, from a hidden input; the
 * picker's own input posts nothing. **Without JavaScript** the server's HTML is a text input with
 * the `HH:mm` pattern under the same name — the shape `<input type="time">` always posted.
 *
 * Needs `PickerProvider` above it — the backoffice's layout mounts it once.
 */
export default function TimeField({ name, label, defaultValue = "", required = false, helperText, size, sx, clearable = !required }: TimeFieldProps) {
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
          htmlInput: { pattern: TIME_PATTERN, placeholder: t("pickers.timePlaceholder"), title: t("pickers.timeTyped"), maxLength: 5 },
        }}
      />
    );
  }

  return (
    <TimePickerInput
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
      clearable={clearable}
      refusal={t("pickers.timeIncomplete")}
    />
  );
}

/**
 * The picker and the hidden input that posts for it. Exported for
 * `tests/unit/shared/pickers-running.test.ts`, which renders it on the server under
 * `PickerProvider` and reads what it would post (`HH:mm`, from the hidden input alone) and what
 * it shows (`19:00`, two sections and no AM/PM); pages use `TimeField`.
 */
export function TimePickerInput({
  id,
  name,
  label,
  initial,
  required,
  error,
  helperText,
  size,
  sx,
  clearable,
  refusal,
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
  clearable: boolean;
  refusal: string;
}) {
  const [picked, setPicked] = useState<Dayjs | null>(() => pickerClock(initial));
  const [refused, setRefused] = useState(false);
  const field = useRef<HTMLInputElement>(null);
  const hidden = useRef<HTMLInputElement>(null);
  const posted = postedClock(picked);
  usePickerAsNativeBox({ field, posted, hidden, refused, refusal });

  return (
    <>
      <TimePicker
        value={picked}
        onChange={setPicked}
        onError={(reason) => setRefused(reason !== null)}
        ampm={false}
        views={["hours", "minutes"]}
        format={TIME_DISPLAY_FORMAT}
        label={label}
        inputRef={field}
        sx={sx}
        slotProps={{
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
