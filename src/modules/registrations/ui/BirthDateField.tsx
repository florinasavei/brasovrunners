"use client";

import { useMaskito } from "@maskito/react";
import TextField from "@mui/material/TextField";
import { type FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { readTypedDate, shownTypedDate, TYPED_DATE_PATTERN } from "@/shared/forms/pickers/wall-values";
import { birthDateEchoText } from "./birth-date-echo";
import { birthDateMaskOptions } from "./birth-date-mask";

export type BirthDateFieldProps = {
  id: string;
  name: string;
  label: string;
  /** `YYYY-MM-DD` or what was typed before a refusal (§142, §315); shown day first either way. */
  defaultValue?: string;
  required?: boolean;
  /** The server's refusal named this box: its words come first under it, until the box is typed in again. */
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
 * What the box says under it, and whether it is red (§561; the owner, 2026-09-29: «ar trebui să
 * văd și mesajul de eroare că nu am vârsta minimă»). A whole date under the event's minimum age
 * on the race day is refused live, as it is typed: the rule's own sentence — the one the summary
 * above the form says for this box (§47, §329) — first, in the error colour, and the date in
 * words with the age it gives under it, so the person sees both the rule and why it caught them.
 * The server's refusal reads the same way until the box is typed in again; then the live verdict
 * answers. A half-typed date says nothing yet: «11.05» is no refusal, only unfinished.
 */
export function birthDateHelper({
  text,
  typedAgain,
  max,
  error,
  errorText,
  help,
  echo,
  tooYoung,
}: {
  text: string;
  /** The box no longer holds what the page was drawn with. */
  typedAgain: boolean;
  max: string;
  error: boolean;
  errorText?: string;
  help?: string;
  echo: string;
  tooYoung: string;
}): { lines: string[]; error: boolean } {
  const date = readTypedDate(text);
  const underAge = date !== "" && date > max;
  const serverSays = error && !typedAgain;
  const refusal = underAge ? tooYoung : serverSays ? (errorText ?? "") : "";
  const lines = refusal ? [refusal, echo] : [help ?? "", echo];
  return { lines: lines.filter(Boolean), error: underAge || serverSays };
}

/**
 * The birth date, typed day first (§561, amending §467 and applying §345's order to the public
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
 *   «Mai lipsesc:» list (`SubmitButton`, measured after the paint) names the box at once.
 * - **Under the minimum age it says so** (`birthDateHelper`): the rule's sentence in red above
 *   the date in words, as soon as a whole date is typed, and after the server's refusal.
 * - **It masks what is typed** (§NNN, the owner, 2026-09-30: «ar trebui să am input mask»):
 *   digits only, the dots put in by the box — «11» is «11.», «11051990» is «11.05.1990» — a
 *   digit typed in the middle taking the place of the one there, a backspace over a dot taking
 *   the digit before it, and a pasted «11/05/1990» or `1990-05-11` shown in the mask. The mask is Maskito's
 *   (`useMaskito`, with the options of `birth-date-mask.ts`), attached to the uncontrolled input:
 *   it writes the masked text before the `input` event reaches our `onInput` and the islands that
 *   read the box by its id. `onInput`, not `onChange`, as Maskito's React guide says: when the
 *   mask rewrites the text («11» to «11.»), React's own value tracker already holds the new text
 *   and fires no `onChange`, so the date in words would lag a keystroke behind. Without
 *   JavaScript the box is the plain text box above, and the server reads what it posts.
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
  const drawn = shownTypedDate(defaultValue);
  const [text, setText] = useState(drawn);
  const input = useRef<HTMLInputElement | null>(null);
  const mask = useMaskito({ options: birthDateMaskOptions });
  // One ref for both: ours for the custom validity, Maskito's to mask the input it is given.
  const inputRef = useCallback(
    (node: HTMLInputElement | null) => {
      input.current = node;
      mask(node);
    },
    [mask],
  );
  const validity = birthDateValidity(text, min, max, { unreadable, tooYoung });
  // The desk's bounds move with the event select; the keystroke's own handler covers the rest.
  useEffect(() => {
    input.current?.setCustomValidity(validity);
  }, [validity]);

  const date = readTypedDate(text);
  const echo = eventDay && date ? birthDateEchoText(date, eventDay, locale, echoTemplate) : "";
  const { lines, error: red } = birthDateHelper({
    text,
    typedAgain: text !== drawn,
    max,
    error,
    errorText,
    help,
    echo,
    tooYoung,
  });

  return (
    <TextField
      id={id}
      name={name}
      label={label}
      defaultValue={drawn}
      required={required}
      error={red}
      autoComplete={autoComplete}
      inputRef={inputRef}
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
          // No `maxLength`: the mask keeps eight digits, and a paste with spaces around it is read whole.
          "data-min": min,
          "data-max": max,
          // After Maskito's own `input` listener: the text read here is the masked one.
          onInput: (event: FormEvent<HTMLInputElement>) => {
            const box = event.currentTarget;
            box.setCustomValidity(birthDateValidity(box.value, min, max, { unreadable, tooYoung }));
            setText(box.value);
          },
        },
      }}
    />
  );
}
