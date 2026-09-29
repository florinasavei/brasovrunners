"use client";

import TextField from "@mui/material/TextField";
import { useEffect, useRef, useState } from "react";
import { readTypedDate, shownTypedDate, TYPED_DATE_PATTERN } from "@/shared/forms/pickers/wall-values";
import { birthDateEchoText } from "./birth-date-echo";

export type BirthDateFieldProps = {
  id: string;
  name: string;
  label: string;
  /** `YYYY-MM-DD` or what was typed before a refusal (§142, §315); shown day first either way. */
  defaultValue?: string;
  required?: boolean;
  /** The refusal named this box: its words replace the help and the echo. */
  error?: boolean;
  errorText?: string;
  /** One help line at rest — the desk's rule; the public form has none (§546). */
  help?: string;
  /** The bounds the server applies, `YYYY-MM-DD`: a hundred and twenty years back, and the youngest allowed. */
  min: string;
  max: string;
  /** The event's calendar day in its own zone (§321); without one, no echo (the desk before an event is chosen). */
  eventDay?: string;
  locale: string;
  /** `{date} · {age} în ziua evenimentului`, from the page's catalogue (§353). */
  echoTemplate: string;
  /** «ZZ.LL.AAAA» / «DD.MM.YYYY». */
  placeholder: string;
  /** What the browser says, and the «Mai lipsesc:» list shows, for a text that is no date — or a date before `min`. */
  unreadable: string;
  /** And for a date after `max`: too young on the race day (a future date is that too). */
  tooYoung: string;
  autoComplete?: string;
};

/** The box's own refusal: "" when it holds a date in range, or nothing at all (`required` says the rest). */
export function birthDateValidity(text: string, min: string, max: string, words: { unreadable: string; tooYoung: string }): string {
  if (text.trim() === "") return "";
  const date = readTypedDate(text);
  if (!date || date < min) return words.unreadable;
  return date > max ? words.tooYoung : "";
}

/**
 * The birth date, typed day first (§NNN, amending §467 and applying §345's order to the public
 * form): «11.05.1990», whatever language the browser speaks. A native `<input type="date">`
 * drew the digits in the *browser's* order — «05/11/1990» on the owner's phone for 11 May, with
 * the line under it saying «Vineri, 11 mai 1990» — and nothing a page does changes that (§70),
 * the same defect §439 fixed for the time box. The backoffice's MUI picker stays off public
 * pages (`pickers-backoffice-only.test.ts`): this box shows the same `DATE_DISPLAY_FORMAT` from
 * the same module, `wall-values.ts`, with no date library.
 *
 * - **It reads** «11.05.1990», «11/5/1990», «11-05-1990», «11 05 1990» and «11051990» (a phone's
 *   numeric keypad has no dot) as 11 May, and the posted shape `1990-05-11` as itself; on leaving
 *   the box it shows `11.05.1990`. The server reads the same (`normalizeTypedDate` in
 *   `form-mapping.ts`), so a browser without JavaScript posts what it typed.
 * - **The words under it are the box's helper** (`FormHelperText`), under the outline with the
 *   helper's own margin: «Vineri, 11 mai 1990 · 36 de ani în ziua evenimentului» — from the same
 *   reading the box posts, so the two can never disagree. It used to be a separate line pulled
 *   up by a negative margin, drawn over the box's bottom edge.
 * - **The browser still refuses** a text that is no date, and a date outside the server's bounds,
 *   through the input's custom validity — set in the keystroke's own handler, so the
 *   «Mai lipsesc:» list (`SubmitButton`, measured after the paint) sees it at once.
 *
 * Uncontrolled: whatever was typed before the island hydrated stays in the box (§211's lesson).
 * `GuardianForMinor`, `HiddenForMinor` read the same input by its id (`useBirthDateValue`,
 * through `readTypedDate`).
 */
export default function BirthDateField({
  id,
  name,
  label,
  defaultValue = "",
  required = false,
  error = false,
  errorText,
  help,
  min,
  max,
  eventDay,
  locale,
  echoTemplate,
  placeholder,
  unreadable,
  tooYoung,
  autoComplete,
}: BirthDateFieldProps) {
  const [text, setText] = useState(() => shownTypedDate(defaultValue));
  const input = useRef<HTMLInputElement>(null);
  const validity = birthDateValidity(text, min, max, { unreadable, tooYoung });
  // The desk's bounds move with the event select; the keystroke's own handler covers the rest.
  useEffect(() => {
    input.current?.setCustomValidity(validity);
  }, [validity]);

  const date = readTypedDate(text);
  const echo = eventDay && date ? birthDateEchoText(date, eventDay, locale, echoTemplate) : "";
  const lines = error && errorText ? [errorText] : [help, echo].filter((line): line is string => Boolean(line));

  return (
    <TextField
      id={id}
      name={name}
      label={label}
      defaultValue={shownTypedDate(defaultValue)}
      required={required}
      error={error}
      autoComplete={autoComplete}
      inputRef={input}
      onChange={(event) => {
        event.target.setCustomValidity(birthDateValidity(event.target.value, min, max, { unreadable, tooYoung }));
        setText(event.target.value);
      }}
      onBlur={(event) => {
        const shown = shownTypedDate(event.target.value.trim());
        if (shown === event.target.value) return;
        event.target.value = shown;
        setText(shown);
      }}
      helperText={
        lines.length === 0 ? undefined : lines.length === 1 ? (
          lines[0]
        ) : (
          <>
            {lines.map((line) => (
              <span key={line} style={{ display: "block" }}>
                {line}
              </span>
            ))}
          </>
        )
      }
      slotProps={{
        inputLabel: { shrink: true },
        // Read out when the words change: the date in words is the check that the day is the one meant.
        formHelperText: { "aria-live": "polite" },
        htmlInput: {
          inputMode: "numeric",
          pattern: TYPED_DATE_PATTERN,
          placeholder,
          maxLength: 10,
          "data-min": min,
          "data-max": max,
        },
      }}
    />
  );
}
