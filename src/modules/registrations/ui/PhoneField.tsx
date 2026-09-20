"use client";

import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import { useCallback, useState, useSyncExternalStore } from "react";
import { composePhone, DIALING_CODES, PHONE_COUNTRY_CODES, splitPhone } from "../phone";

/**
 * A telephone number as two controls: the country (a native select, prefix shown) and the
 * digits (`DECISIONS.md` §84, §198). Posted as `<name>Country` and `<name>`; `form-mapping.ts`
 * composes the E.164 the schema stores.
 *
 * Native `<select>` rather than MUI's, on purpose: it works before hydration, it is the control
 * a phone knows how to open, and 200 options in a Popover is a scroll nobody wants. Romania
 * first, then the rest by name in the reader's language.
 *
 * ## Why this became a client island
 *
 * The owner: "faptul că telefonul nu e valid trebuie să fie vizibil instant". It was a Server
 * Component with a `pattern` attribute, so the browser said nothing until the form was submitted
 * — and the *real* rule is not the pattern. `composePhone` is: it strips the separators people
 * type, handles a `00` prefix and a repeated country code, drops a trunk zero everywhere except
 * Italy, and then insists on four to fourteen digits. A pattern loose enough to let all of that
 * through cannot tell somebody their number is too short.
 *
 * So the island runs **the server's own function**, on every keystroke, and says the same thing
 * the server would say. One rule, imported, never a second one written in a regular expression
 * to approximate it — which is how the two drift and a form starts refusing what the server
 * accepts.
 *
 * ## What happens before hydration, and without JavaScript
 *
 * The same markup, with the same `pattern`, `minLength` and `required` the browser has always
 * enforced: `verdict` is only consulted once `hydrated` is true, so the server renders exactly
 * what it rendered before and nothing shifts underneath a reader who is already typing. With
 * JavaScript off the form behaves as it did — refused on submit, by the browser, naming the
 * field.
 *
 * The message appears only after the field has been **left or filled past a few characters**:
 * turning a box red on the first digit of a number that is obviously not finished yet is
 * scolding somebody for typing.
 */
export default function PhoneField({
  name,
  label,
  countryLabel,
  locale,
  value,
  draft,
  required = false,
  autoComplete,
  id,
  error,
  helperText,
  invalidLabel,
}: {
  name: string;
  label: string;
  countryLabel: string;
  locale: "ro" | "en";
  /** A stored E.164 number to prefill, or nothing. */
  value?: string | null;
  /** What was typed before a rejected submit (§142): the two boxes as posted, over `value`. */
  draft?: { country?: string; national?: string };
  required?: boolean;
  autoComplete?: string;
  id?: string;
  error?: boolean;
  helperText?: string;
  /** "That is not a number this country uses" — shown as it is typed (§198). */
  invalidLabel?: string;
}) {
  const names = new Intl.DisplayNames([locale], { type: "region" });
  const split = splitPhone(value ?? null);
  const initialCountry =
    draft?.country && (PHONE_COUNTRY_CODES as readonly string[]).includes(draft.country)
      ? draft.country
      : split.countryCode;
  const initialNational = draft ? (draft.national ?? "") : split.national;

  const hydrated = useSyncExternalStore(
    useCallback(() => () => {}, []),
    () => true,
    () => false,
  );

  const [country, setCountry] = useState(initialCountry);
  const [national, setNational] = useState(initialNational);
  const [touched, setTouched] = useState(false);

  /*
    Long enough to be a real attempt: below this somebody is mid-number, and the only honest
    thing to say is nothing. Above it, or once they have left the box, the answer is the
    server's own.
  */
  const ENOUGH_TO_JUDGE = 6;
  const judged = touched || national.replace(/\D/g, "").length >= ENOUGH_TO_JUDGE;
  const liveInvalid =
    hydrated && judged && national.trim() !== "" && composePhone(country, national) === null;

  const options = PHONE_COUNTRY_CODES.map((code) => ({
    code,
    label: `${names.of(code) ?? code} (+${DIALING_CODES[code]})`,
  })).sort((a, b) =>
    a.code === "RO" ? -1 : b.code === "RO" ? 1 : a.label.localeCompare(b.label, locale),
  );

  return (
    <Stack direction="row" spacing={1} sx={{ alignItems: "flex-start" }}>
      <TextField
        select
        name={`${name}Country`}
        label={countryLabel}
        value={country}
        onChange={(event) => setCountry(event.target.value)}
        size="medium"
        slotProps={{ select: { native: true }, inputLabel: { shrink: true } }}
        sx={{ width: { xs: 132, sm: 200 }, flexShrink: 0 }}
      >
        {options.map((option) => (
          <option key={option.code} value={option.code}>
            {option.label}
          </option>
        ))}
      </TextField>
      <TextField
        id={id}
        name={name}
        type="tel"
        label={label}
        value={national}
        onChange={(event) => setNational(event.target.value)}
        onBlur={() => setTouched(true)}
        required={required}
        fullWidth
        autoComplete={autoComplete}
        // The server's rejection still wins: it knows things this box cannot, and it is what
        // the error summary at the top of the page is pointing at.
        error={error || liveInvalid}
        helperText={liveInvalid && !error ? (invalidLabel ?? helperText) : helperText}
        slotProps={{
          htmlInput: {
            inputMode: "tel",
            // Digits, with the separators people type; the server strips them and checks the count.
            pattern: "[0-9+()./\\s-]{4,20}",
            minLength: 4,
            maxLength: 20,
          },
        }}
      />
    </Stack>
  );
}
