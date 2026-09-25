"use client";

import CloseIcon from "@mui/icons-material/Close";
import IconButton from "@mui/material/IconButton";
import InputAdornment from "@mui/material/InputAdornment";
import TextField from "@mui/material/TextField";
import type { SxProps, Theme } from "@mui/material/styles";
import { useTranslations } from "next-intl";
import { useRef } from "react";
import { useRecall } from "@/shared/forms/recall";
import { TIME_PATTERN } from "./wall-values";

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
 * A time of day in the backoffice: the platform's own `<input type="time">`, always *posting*
 * `HH:mm` on the 24-hour clock (`DECISIONS.md` §345, amended by §NNN; the owner, 2026-09-25, of
 * the MUI wheel picker: "I simply hate this time picker"). The browser may *show* a 12-hour
 * clock face with its own AM/PM in some locales, exactly as §303 found before the pickers went
 * in, but the value this box carries and posts never changes shape, and a phone gets its own OS
 * wheel, which every runner already knows how to use, rather than MUI's.
 *
 * **What it posts has not changed:** `HH:mm` under the same name — `type="time"`'s own value,
 * with `step={60}` so no browser offers seconds. §345's date half is untouched (`DateField`
 * still runs the picker); only the time half drops the library.
 *
 * No island, no hydration swap: the native control is typeable on a desktop and the OS wheel on
 * a phone from the very first paint, server-rendered and client-rendered alike, so there is
 * nothing left for `PickerProvider` or `useIslandRunning` to do for a time box.
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
    input.dispatchEvent(new Event("change", { bubbles: true }));
    input.focus();
  }

  return (
    <TextField
      key={recall.generation}
      id={id}
      name={name}
      type="time"
      inputRef={field}
      label={label}
      defaultValue={initial}
      required={required}
      error={named}
      helperText={help}
      size={size}
      sx={sx}
      slotProps={{
        inputLabel: { shrink: true },
        // `pattern` is inert on `type="time"` in every shipping browser — kept only for the
        // scriptless render (`pickers-js-off.test.ts`) and as documentation of the shape.
        htmlInput: { step: 60, pattern: TIME_PATTERN, title: t("pickers.timeTyped") },
        input: {
          // Chromium and Edge draw their own clock icon inside `type="time"`; clicking it opens
          // that browser's own time popup (Chrome 83+), so it stays visible and untouched — an
          // `AccessTimeIcon` start adornment would only sit beside it as a second, dead clock.
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
