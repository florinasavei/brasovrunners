"use client";

import CloseIcon from "@mui/icons-material/Close";
import IconButton from "@mui/material/IconButton";
import InputAdornment from "@mui/material/InputAdornment";
import TextField from "@mui/material/TextField";
import type { SxProps, Theme } from "@mui/material/styles";
import { useTranslations } from "next-intl";
import type { KeyboardEvent } from "react";
import { useRef } from "react";
import { useRecall } from "@/shared/forms/recall";
import { normalizeTypedTime, TIME_PATTERN } from "./wall-values";

export type TimeFieldProps = {
  /** The posted name: `event.startsAtTime`, `event.schedule[0].time`… */
  name: string;
  label: string;
  /** `HH:mm` on the 24-hour clock, or "". A refused submit's value wins over it (§315). */
  defaultValue?: string;
  required?: boolean;
  helperText?: string;
  size?: "small" | "medium";
  sx?: SxProps<Theme>;
  /** A clear button; on for an optional time by default, off where it would crowd a narrow box. */
  clearable?: boolean;
};

/** Tell the form's listeners (the series sentence, §371's scheduler) that the box moved. */
function announce(input: HTMLInputElement) {
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.dispatchEvent(new Event("change", { bubbles: true }));
}

/**
 * A backoffice time, shown and posted as 24-hour `HH:mm` (§439, amending §400). A plain text box,
 * not `type=time`, which an English-language browser draws as "07:00 PM" whatever the page says.
 *
 * Keystrokes are never rewritten; on blur or Enter `normalizeTypedTime` reads "1900", "9:30", "7"…
 * and what it cannot read is left for `pattern` and the server to refuse. No `PickerProvider` needed.
 */
export default function TimeField({ name, label, defaultValue = "", required = false, helperText, size, sx, clearable = !required }: TimeFieldProps) {
  const recall = useRecall();
  const t = useTranslations("Admin");
  const initial = recall.value(name) ?? defaultValue;
  const named = recall.named(name);
  const id = recall.idOf(name);
  const help = named && recall.fieldError ? recall.fieldError : helperText;
  const field = useRef<HTMLInputElement>(null);

  function clear() {
    const input = field.current;
    if (!input) return;
    input.value = "";
    announce(input);
    input.focus();
  }

  function normalize() {
    const input = field.current;
    if (!input) return;
    const normal = normalizeTypedTime(input.value);
    if (normal === input.value) return;
    input.value = normal;
    announce(input);
  }

  // Enter submits without a blur: normalise in keydown, which runs before the implicit submit.
  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Enter" && event.target === field.current) normalize();
  }

  return (
    <TextField
      key={recall.generation}
      id={id}
      name={name}
      type="text"
      inputRef={field}
      label={label}
      defaultValue={initial}
      required={required}
      error={named}
      helperText={help}
      size={size}
      sx={sx}
      onBlur={normalize}
      onKeyDown={onKeyDown}
      slotProps={{
        inputLabel: { shrink: true },
        // `pattern` holds the box to `HH:mm` on submit, with JavaScript and without.
        htmlInput: {
          inputMode: "numeric",
          autoComplete: "off",
          maxLength: 5,
          pattern: TIME_PATTERN,
          placeholder: t("pickers.timePlaceholder"),
          title: t("pickers.timeTyped"),
        },
        input: {
          endAdornment: clearable ? (
            <InputAdornment position="end">
              <IconButton aria-label={t("pickers.clearTime")} onClick={clear} sx={{ minWidth: 44, minHeight: 44 }} size="small">
                <CloseIcon fontSize="small" />
              </IconButton>
            </InputAdornment>
          ) : undefined,
        },
      }}
    />
  );
}
