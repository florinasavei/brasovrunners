"use client";

import CloseIcon from "@mui/icons-material/Close";
import IconButton from "@mui/material/IconButton";
import InputAdornment from "@mui/material/InputAdornment";
import TextField from "@mui/material/TextField";
import type { SxProps, Theme } from "@mui/material/styles";
import { useTranslations } from "next-intl";
import type { SyntheticEvent } from "react";
import { useRef } from "react";
import { useRecall } from "@/shared/forms/recall";
import { normalizeTypedTime, TIME_PATTERN } from "./wall-values";

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

/** Tell the form's own listeners (the series sentence, §371's scheduler) that the box moved. */
function announce(input: HTMLInputElement) {
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.dispatchEvent(new Event("change", { bubbles: true }));
}

/**
 * A time of day in the backoffice, on the 24-hour clock — **shown** that way as well as posted
 * (`DECISIONS.md` §NNN, amending §400; the owner, 2026-09-26: "iar ai făcut ora cu AM și PM… am
 * zis că vreau 24H format!").
 *
 * **Why a text box and not the browser's time input (`type=time`).** §400 swapped MUI's wheel picker for the
 * browser's own time control and accepted, in writing, that the browser draws it in *its* locale:
 * on an English-language Chrome or Edge that is "07:00 PM", whatever the page's `lang` says — no
 * attribute, no CSS and no `step` changes it. The owner's rule is the stronger one, so the box is
 * a plain MUI `TextField` that shows exactly the characters it posts: `19:00`.
 *
 * **Typing it.** A numeric keypad on a phone (`inputMode="numeric"`), at most five characters,
 * and a colon added after a valid two-digit hour as it is typed ("19" → "19:"). On leaving the
 * box, `normalizeTypedTime` reads the usual shapes — "1900", "19.00", "930", "9:30", "7" — as
 * `HH:mm`; what it cannot read stays as typed for `pattern` (with JavaScript or without) and the
 * server (`isTimeValue`) to refuse. No AM/PM is ever read or shown.
 *
 * **What it posts has not changed:** `HH:mm` under the same name, the same value the native box
 * posted, so nothing below the form moved. §345's date half is untouched (`DateField` still runs
 * the picker, day-first); the time needs no island and no `PickerProvider`.
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

  // The colon after a whole hour, typed forward only: a backspace over it must be able to take
  // it away, so a deletion never adds it back.
  function onInput(event: SyntheticEvent) {
    const input = field.current;
    if (!input || event.target !== input) return;
    if ((event.nativeEvent as InputEvent).inputType !== "insertText") return;
    if (/^([01]\d|2[0-3])$/.test(input.value)) input.value = `${input.value}:`;
  }

  function onBlur() {
    const input = field.current;
    if (!input) return;
    const normal = normalizeTypedTime(input.value);
    if (normal === input.value) return;
    input.value = normal;
    announce(input);
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
      onInput={onInput}
      onBlur={onBlur}
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
