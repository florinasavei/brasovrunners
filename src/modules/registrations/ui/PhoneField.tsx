"use client";

import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
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
 * ## Uncontrolled inputs, and why that is not a detail (§211)
 *
 * The boxes keep `defaultValue` and never `value`. Written as controlled inputs they wiped what
 * somebody had already typed: the server's HTML carries the fields, a person starts typing
 * immediately, React hydrates a moment later, and a controlled input rendered from state that
 * began at "" replaces their text with nothing. It is invisible in development, where hydration
 * is instant, and it is exactly what happens to the first person on a cold edge.
 *
 * The e2e suite found it by behaving like that person — filling the form the instant the page
 * arrives — and the submission then failed native validation on boxes that looked filled.
 *
 * So the DOM owns the value and this island only *watches* it: state exists for the comparison
 * and for nothing else, which is why it can never contradict what is on screen.
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
/**
 * Everything but the digits, with one exception: a `+` at the very front (§223, §226).
 *
 * It is the one non-digit that changes what the number *means*. `composePhone` reads a leading
 * plus as "the international form was typed" and then requires the chosen country's dialing
 * code, which is what refuses a French number entered under Romania — and without the plus the
 * same digits fall into the national branch and get that country's code bolted on instead.
 * A `+` anywhere else is punctuation and goes with the rest.
 */
function onlyDigits(value: string): string {
  const plus = value.startsWith("+") ? "+" : "";
  return plus + value.replace(/\D+/g, "");
}

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
  mustDifferFromName,
  mustDifferLabel,
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
  /**
   * The name of another telephone field this one must not equal (§231).
   *
   * Used for the emergency contact, which is worthless when it is the runner's own number
   * (§228). The rule lived only on the server, so the first anybody heard of it was a
   * rejected submission — the owner: "here I put the same number for emergency contact but
   * I only knew that after submitting".
   */
  mustDifferFromName?: string;
  /** What to say when it does equal it. */
  mustDifferLabel?: string;
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

  /**
   * The other number, watched as it is typed (§231).
   *
   * Subscribed to rather than owned, exactly as `GuardianForMinor` watches the birth date:
   * the other field is somebody else's island and lifting it into this one would trade its
   * own validation for a second copy of the rule.
   */
  const otherSubscribe = useCallback(
    (onStoreChange: () => void) => {
      if (!mustDifferFromName) return () => {};
      const nodes = [
        document.querySelector(`[name="${mustDifferFromName}"]`),
        document.querySelector(`[name="${mustDifferFromName}Country"]`),
      ].filter((node): node is Element => node !== null);
      for (const node of nodes) {
        node.addEventListener("input", onStoreChange);
        node.addEventListener("change", onStoreChange);
      }
      return () => {
        for (const node of nodes) {
          node.removeEventListener("input", onStoreChange);
          node.removeEventListener("change", onStoreChange);
        }
      };
    },
    [mustDifferFromName],
  );

  const otherComposed = useSyncExternalStore(
    otherSubscribe,
    () => {
      if (!mustDifferFromName) return null;
      const value = document.querySelector(`[name="${mustDifferFromName}"]`);
      const country = document.querySelector(`[name="${mustDifferFromName}Country"]`);
      if (!(value instanceof HTMLInputElement) || !(country instanceof HTMLSelectElement)) return null;
      return composePhone(country.value, value.value);
    },
    // Nothing to compare on the server, where neither field exists yet.
    () => null,
  );

  const mine = hydrated ? composePhone(country, national) : null;
  const sameAsOther = Boolean(mustDifferFromName && mine && otherComposed && mine === otherComposed);

  /**
   * `setCustomValidity` rather than a red border alone, and that is the whole point (§231).
   *
   * The owner asked that an invalid form could not be submitted at all. A message drawn
   * beside the field is only a picture; a custom validity makes the **browser** refuse the
   * submission, name the control and move focus to it — the same machinery that already
   * handles a missing required field, in the reader's own language, with no JavaScript of
   * ours in the refusal path.
   *
   * Cleared the moment the numbers differ, or the control would stay refused for ever.
   */
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const input = inputRef.current;
    if (!input) return;
    input.setCustomValidity(sameAsOther ? (mustDifferLabel ?? "") : "");
  }, [sameAsOther, mustDifferLabel]);
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
        defaultValue={initialCountry}
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
        defaultValue={initialNational}
        /*
          Digits only, in the box — **and a leading `+` survives** (§223, §226; the owner: "in
          the phone field I should be able to type only numbers!").

          The country code is chosen in the select beside this, so what belongs here is the
          national number and nothing else. Anything that is not a digit is **stripped as it
          is typed** rather than refused: a person pasting "0721 234 567" or "+40 721-234-567"
          from their own contacts gets the digits kept and the punctuation dropped, where a
          refusal would leave them re-typing a number they had correctly in the clipboard.
          `composePhone` on the server already does exactly this stripping — this only makes
          the box show the same answer the server would reach.

          **The leading `+` is kept, and dropping it corrupted numbers** (§226). `composePhone`
          reads it as "this is the international form" and then *insists* the number starts
          with the chosen country's code — so Romania selected and a French `+33…` pasted in
          was refused, and the person fixed the country. Without the plus the same digits fall
          into the national-number branch, which prefixes the chosen country blindly: the
          refusal became a silently stored `+4033…`, a number that belongs to nobody. A wrong
          telephone number is worse than a rejected one, because nothing ever tells the club.

          Written to the DOM, never through state (§211): the input stays uncontrolled, so
          nothing can replace what somebody typed before hydration.
        */
        onChange={(event) => {
          const digits = onlyDigits(event.target.value);
          if (event.target.value !== digits) event.target.value = digits;
          setNational(digits);
        }}
        onBlur={() => setTouched(true)}
        required={required}
        fullWidth
        autoComplete={autoComplete}
        // The server's rejection still wins: it knows things this box cannot, and it is what
        // the error summary at the top of the page is pointing at.
        inputRef={inputRef}
        error={error || liveInvalid || sameAsOther}
        helperText={
          sameAsOther ? mustDifferLabel : liveInvalid && !error ? (invalidLabel ?? helperText) : helperText
        }
        slotProps={{
          htmlInput: {
            // `numeric` rather than `tel`: a telephone keypad offers `+ * #`, and none of
            // them can be typed here any more (§223).
            inputMode: "numeric",
            /*
              Digits only — and the pattern still has to admit the separators.

              With JavaScript off nothing strips anything, and `composePhone` on the server
              accepts a number written with spaces or dashes. A pattern narrowed to `[0-9]`
              would make the browser refuse, without JavaScript, a number the server would
              have taken — which is the form working *worse* for the person least able to
              recover from it (`AGENTS.md` §1.5).
            */
            pattern: "[0-9+()./\\s-]{4,20}",
            minLength: 4,
            maxLength: 20,
          },
        }}
      />
    </Stack>
  );
}
