"use client";

import ArrowDropDownIcon from "@mui/icons-material/ArrowDropDown";
import Box from "@mui/material/Box";
import TextField from "@mui/material/TextField";
import { type ComponentProps, useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useRecall } from "@/shared/forms/recall";
import Flag from "@/shared/ui/Flag";
import { composePhone, DIALING_CODES, PHONE_COUNTRY_CODES, splitPhone } from "../phone";
import { formatNationalNumber, phoneMaxLength, phonePlaceholder, reformatPhoneInput } from "../phone-format";

/**
 * A telephone number as one box: the country's flag at its start, the digits after it, grouped
 * as they are typed (`DECISIONS.md` §84, §198, §337). Posted as `<name>Country` and `<name>`
 * exactly as it was when these were two boxes; `form-mapping.ts` composes the E.164 the schema
 * stores.
 *
 * The country is still a native `<select>`, on purpose: it works before hydration, it is the
 * control a phone knows how to open, and 200 options in a Popover is a scroll nobody wants.
 * Romania first, then the rest by name in the reader's language. What changed (§337) is that the
 * select is no longer what is *drawn*: it lies, invisible, over the flag and the caret at the
 * start of the box, so a tap on the flag opens the phone's own picker, and what the eye reads is
 * one outlined field with a real flag in it.
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
 * accepts. The mask obeys the same discipline: `phone-format.ts` reads a typed value the way
 * `composePhone` will, and only ever adds spaces, which `composePhone` strips first.
 *
 * ## Uncontrolled inputs, and why that is not a detail (§211)
 *
 * The box keeps `defaultValue` and never `value`. Written as a controlled input it wiped what
 * somebody had already typed: the server's HTML carries the fields, a person starts typing
 * immediately, React hydrates a moment later, and a controlled input rendered from state that
 * began at "" replaces their text with nothing. It is invisible in development, where hydration
 * is instant, and it is exactly what happens to the first person on a cold edge.
 *
 * The e2e suite found it by behaving like that person — filling the form the instant the page
 * arrives — and the submission then failed native validation on boxes that looked filled.
 *
 * So the DOM owns the value and this island only *watches* it: state exists for the comparison
 * and for nothing else, which is why it can never contradict what is on screen. The mask keeps
 * that: it writes the formatted value to the DOM and moves the caret, as the digit filter did.
 *
 * ## What happens before hydration, and without JavaScript
 *
 * The same markup, with the same `pattern`, `minLength` and `required` the browser has always
 * enforced: `verdict` is only consulted once `hydrated` is true, so the server renders exactly
 * what it rendered before and nothing shifts underneath a reader who is already typing. The flag
 * the server draws is the prefilled country's, and so is the client's first render.
 *
 * With JavaScript off, a flag that cannot follow the select would lie, so `@media (scripting:
 * none)` takes the flag away and shows the select itself where it stood — the phone's own
 * control, reading "🇷🇴 România (+40)" — and the digits go in unmasked, which the server accepts
 * (it strips the separators). Refused on submit by the browser, naming the field, as before.
 *
 * The message appears only after the field has been **left or filled past a few characters**:
 * turning a box red on the first digit of a number that is obviously not finished yet is
 * scolding somebody for typing.
 */

/**
 * The flag for an ISO 3166-1 alpha-2 code, as the two regional-indicator characters.
 *
 * Text, so it can live inside an `<option>`, which an image cannot. Where a platform draws
 * no flag — Windows — it falls back to rendering the pair as the letters themselves, which
 * is the country code, and is exactly as useful here. The box itself draws the real picture
 * (`Flag`); this is only the list the phone opens.
 */
function flagEmoji(code: string): string {
  const FIRST = 0x1f1e6; // REGIONAL INDICATOR SYMBOL LETTER A
  return [...code.toUpperCase()]
    .map((letter) => String.fromCodePoint(FIRST + letter.charCodeAt(0) - 65))
    .join("");
}

/**
 * The flag, the caret, and the select laid over both (§337).
 *
 * - **The target is the whole start of the box.** Pulled out to the outline's own left edge
 *   (the input's padding is 14 pixels) and as tall as the field, so it is 56 × 64 — over the
 *   44 × 44 a thumb needs (BR-REQ-041-01 criterion 6).
 * - **Invisible, not hidden.** `opacity: 0` keeps the select in the page, focusable, in the tab
 *   order and announced by its `aria-label`; `display: none` or `visibility: hidden` would take
 *   all three away. Sixteen pixels of type, because iOS zooms the page into any form control
 *   set smaller when it takes focus — invisible or not.
 * - **A ring where it went.** A keyboard reaching an invisible control needs to see where it
 *   landed, so the adornment draws the focus the select cannot.
 * - **No JavaScript, no pretence** — see the component's comment.
 *
 * Not the theme's §309 exclamation mark's business: that one sits at the *end* of the box and is
 * drawn on the input root, and this is its start.
 */
const COUNTRY_ADORNMENT_SX = {
  position: "relative",
  alignSelf: "stretch",
  display: "flex",
  alignItems: "center",
  flexShrink: 0,
  ml: "-14px",
  pl: "12px",
  pr: "6px",
  mr: "10px",
  borderRadius: "4px 0 0 4px",
  // The thin rule between the country and the digits.
  "&::after": {
    content: '""',
    position: "absolute",
    right: 0,
    top: 14,
    bottom: 14,
    width: "1px",
    bgcolor: "divider",
  },
  "& > span": { display: "flex", alignItems: "center", gap: "2px" },
  "& > select": {
    position: "absolute",
    inset: 0,
    width: "100%",
    height: "100%",
    m: 0,
    p: 0,
    border: 0,
    opacity: 0,
    cursor: "pointer",
    fontSize: 16,
  },
  "&:has(> select:focus-visible)": { outline: "2px solid", outlineColor: "primary.main", outlineOffset: "-3px" },
  "@media (scripting: none)": {
    "& > span": { display: "none" },
    "& > select": {
      position: "static",
      opacity: 1,
      width: "auto",
      height: "auto",
      // As wide as the chosen country where the browser can size a select to its value, and
      // never more than half a phone's width where it cannot (it would size to the longest
      // name) — at 320 pixels that still leaves the digits room for "0712 345 678".
      maxWidth: "min(12rem, 50vw)",
      fieldSizing: "content",
      font: "inherit",
      color: "inherit",
      bgcolor: "transparent",
    },
  },
} as const;

function PhoneFieldIsland({
  name,
  label,
  countryLabel,
  countryOrder,
  countryNames,
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
  tooShortLabel,
  validLabel,
}: {
  name: string;
  label: string;
  /** The select's accessible name — it draws no label of its own since §337. */
  countryLabel: string;
  /**
   * The prefixes in the order to show them, from `phoneCountryOrder` on the server (§324): the
   * browser's ICU names countries differently from Node's, so a sort made here disagreed with
   * the server's markup and cost the form its hydration.
   */
  countryOrder: readonly string[];
  /**
   * The reader's own name for each code, from `phoneCountryLabels` on the server (§337, §324):
   * the option now carries the country's name as well as its flag and code, and it is server
   * data for the same reason the order is — computed once with Node's `Intl.DisplayNames` and
   * handed down as plain data, never recomputed from the browser's own ICU, which is the
   * mismatch that cost the form its hydration in the first place.
   */
  countryNames: Readonly<Record<string, string>>;
  /** A stored E.164 number to prefill, or nothing. */
  value?: string | null;
  /** What was typed before a rejected submit (§142): the two controls as posted, over `value`. */
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
  /** "Keep going" — for a number that is only unfinished, not wrong (§282). */
  tooShortLabel?: string;
  /** What precedes the composed number once it is valid: "we will ring". */
  validLabel?: string;
}) {
  const split = splitPhone(value ?? null);
  const initialCountry =
    draft?.country && (PHONE_COUNTRY_CODES as readonly string[]).includes(draft.country)
      ? draft.country
      : split.countryCode;
  /*
    Masked on the server too, through the same function the keystrokes go through, so the box
    arrives looking the way it will look once somebody types in it. A stored `+40752189098`
    prefills as `752 189 098` — without the trunk zero, because `splitPhone` hands back the
    national significant number and a zero it did not see is not the mask's to invent. Formatted
    and never capped: a refused draft comes back with every digit it had, too many included,
    because silently cutting one could turn a refused number into a wrong one that passes.
  */
  const initialNational = formatNationalNumber(initialCountry, draft ? (draft.national ?? "") : split.national);

  const hydrated = useSyncExternalStore(
    useCallback(() => () => {}, []),
    () => true,
    () => false,
  );

  const [country, setCountry] = useState(initialCountry);
  const [national, setNational] = useState(initialNational);
  const [touched, setTouched] = useState(false);
  /** The box's value as this island last left it: what a keystroke's edit is measured against. */
  const lastValue = useRef(initialNational);

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
   * own validation for a second copy of the rule. Its value is masked now; `composePhone`
   * strips the spaces, so the comparison is between the numbers and never their spelling.
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

  /*
    E.164 is fifteen digits in all, country code included (§282; Amalia: the number needs a
    maximum and a clearer answer as it is typed). So the room left in the box depends on the
    country chosen with it — and, since §337, on the form typed: `phoneDigitCap` counts the
    digits that will be *stored*, so a `+40…` may carry its code and a trunk zero is not charged.
    Typing past it is refused at the keystroke rather than at the submit, because the digit
    somebody has just typed is the one they can still see. `maxLength` is the longest the mask
    can make that, spaces included, so the browser never truncates a paste the cap would keep.
  */
  const maxLength = phoneMaxLength(country);
  const typedDigits = national.replace(/\D/g, "").length;

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
  /** The native select underneath the flag (§337) — read once, on mount, below. */
  const selectRef = useRef<HTMLSelectElement>(null);
  useEffect(() => {
    const input = inputRef.current;
    if (!input) return;
    input.setCustomValidity(sameAsOther ? (mustDifferLabel ?? "") : "");
  }, [sameAsOther, mustDifferLabel]);

  /**
   * The country a browser can put in the select before this island ever ran (§337).
   *
   * The select stays native so it works before hydration (see the component's own comment) —
   * but that cuts both ways. A country picked in that window, or one Firefox refills from its
   * own form-restore on reload, lands in the DOM with no `change` event to tell React about it,
   * because restoration sets the property directly. `country` would then sit at `initialCountry`
   * forever while the select itself posts something else — the flag, the mask and the live
   * verdict all wrong in exactly the way the component's own comment says they "can never" be.
   *
   * Read once, right after mount, the same way the select's own `onChange` handles a change it
   * did see: reformat what the box already holds under the country the DOM actually carries, and
   * let state catch up to the screen rather than the other way around (§211).
   */
  useEffect(() => {
    const select = selectRef.current;
    const input = inputRef.current;
    if (!select || !input) return;
    const restored = select.value;
    if (!restored || restored === initialCountry) return;
    setCountry(restored);
    const reformatted = formatNationalNumber(restored, input.value);
    if (input.value !== reformatted) input.value = reformatted;
    lastValue.current = reformatted;
    setNational(reformatted);
    // Once, right after mount: `initialCountry` is this render's own value and does not change
    // underneath the effect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /*
    The list the phone opens: flag, name and code — "🇷🇴 România (+40)" (§337, superseding
    §236's cut to the flag and the code alone).

    §236 cut the name because the select *was* the box, 104 pixels of it, and "România (+4…"
    lost the one part worth reading. The select is no longer drawn — the box shows a real flag
    and the select lies invisible over it — so the options are only ever read in the phone's
    own full-width list, where the name fits and is what somebody hunting for a country they
    cannot picture the flag of needs.

    Both the order and the names are the server's (`countryOrder`, `countryNames`, §324):
    sorting or naming them again here, from the browser's own ICU data, is exactly what cost
    the form its hydration before — Node and a browser can spell a country differently, and
    worse, can disagree on where it sorts. Drawn as plain data instead, the client never
    computes either, so there is nothing left for the two to disagree on.
  */
  const options = countryOrder
    .filter((code) => code in DIALING_CODES)
    .map((code) => ({ code, label: `${flagEmoji(code)} ${countryNames[code] ?? code} (+${DIALING_CODES[code]})` }));

  const adornment = (
    <Box sx={COUNTRY_ADORNMENT_SX}>
      <span aria-hidden>
        <Flag code={country} width={24} />
        <ArrowDropDownIcon sx={{ fontSize: 20, color: "action.active" }} />
      </span>
      <select
        ref={selectRef}
        name={`${name}Country`}
        aria-label={countryLabel}
        defaultValue={initialCountry}
        onChange={(event) => {
          const next = event.target.value;
          setCountry(next);
          /*
            The same digits under another country's mask: spaces move, nothing is cut. The cap is
            a keystroke's business — a country changed after the number was typed must not delete
            digits somebody can no longer see going.
          */
          const input = inputRef.current;
          if (input) {
            const reformatted = formatNationalNumber(next, input.value);
            if (input.value !== reformatted) input.value = reformatted;
            lastValue.current = reformatted;
            setNational(reformatted);
          }
        }}
      >
        {options.map((option) => (
          <option key={option.code} value={option.code}>
            {option.label}
          </option>
        ))}
      </select>
    </Box>
  );

  return (
    <TextField
      id={id}
      name={name}
      type="tel"
      label={label}
      defaultValue={initialNational}
      // The mask, visible before the first digit: "0712 345 678" for Romania.
      placeholder={phonePlaceholder(country)}
      /*
        Digits only, in the box — **and a leading `+` survives** (§223, §226; the owner: "in
        the phone field I should be able to type only numbers!") — **grouped as typed** (§337).

        The country code is chosen at the start of the box, so what belongs here is the
        national number and nothing else. Anything that is not a digit is **stripped as it
        is typed** rather than refused: a person pasting "0721.234.567" or "+40 721-234-567"
        from their own contacts gets the digits kept, the punctuation dropped and the mask's
        spaces put in, where a refusal would leave them re-typing a number they had correctly
        in the clipboard. `composePhone` on the server strips exactly those separators — this
        only makes the box show the same answer the server would reach.

        **The leading `+` is kept, and dropping it corrupted numbers** (§226). `composePhone`
        reads it as "this is the international form" and then *insists* the number starts
        with the chosen country's code — so Romania selected and a French `+33…` pasted in
        was refused, and the person fixed the country. Without the plus the same digits fall
        into the national-number branch, which prefixes the chosen country blindly: the
        refusal became a silently stored `+4033…`, a number that belongs to nobody. A wrong
        telephone number is worse than a rejected one, because nothing ever tells the club.

        Written to the DOM, never through state (§211): the input stays uncontrolled, so
        nothing can replace what somebody typed before hydration. The caret is put back
        beside the digit it followed, and a Backspace just after a space takes the digit
        before it (`reformatPhoneInput`).
      */
      onChange={(event) => {
        const input = event.target as HTMLInputElement;
        const next = reformatPhoneInput({
          country,
          raw: input.value,
          caret: input.selectionStart ?? input.value.length,
          previous: lastValue.current,
          inputType: (event.nativeEvent as InputEvent).inputType,
        });
        if (input.value !== next.value) input.value = next.value;
        // Only while it has focus: moving the selection of a box nobody is in can pull focus to it.
        if (document.activeElement === input && input.selectionStart !== next.caret) {
          input.setSelectionRange(next.caret, next.caret);
        }
        lastValue.current = next.value;
        setNational(next.value);
      }}
      onBlur={() => setTouched(true)}
      required={required}
      fullWidth
      autoComplete={autoComplete}
      // The server's rejection still wins: it knows things this box cannot, and it is what
      // the error summary at the top of the page is pointing at.
      inputRef={inputRef}
      error={error || liveInvalid || sameAsOther}
      /*
        Three answers rather than one (§282).

        "Not a number this country uses" is true and unhelpful when the number is simply not
        finished: it reads as a refusal of what they typed rather than as a count. So a number
        that is only too short says so, and a number that *works* says so too — with the exact
        E.164 the club will store, which is the one thing that proves the country chosen with
        it was understood. A person who sees `+40712345678` knows they are done.
      */
      helperText={
        sameAsOther
          ? mustDifferLabel
          : liveInvalid && !error
            ? typedDigits > 0 && typedDigits < 4
              ? (tooShortLabel ?? invalidLabel ?? helperText)
              : (invalidLabel ?? helperText)
            : hydrated && mine && !error
              ? (validLabel ? `${validLabel} ${mine}` : mine)
              : helperText
      }
      slotProps={{
        input: { startAdornment: adornment },
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

            **Escaped, because browsers compile `pattern` with the `v` flag** (§337), and under
            it an unescaped `(`, `)`, `/` or `-` inside a class is a syntax error. The pattern
            this replaced, `[0-9+()./\s-]`, was therefore invalid, and a browser ignores an
            invalid pattern outright — it had been enforcing nothing.

            **No upper bound in the pattern itself.** A refused draft is deliberately brought
            back with every digit it had, uncapped (`initialNational`, above) — a no-JS entrant
            who typed past the cap must still be refused with this field's own words, never the
            browser's generic "match the requested format" for a pattern their own draft is
            longer than. `minLength` still asks for four characters and `composePhone` on the
            server has the final word either way; `maxLength` alone bounds what somebody can
            still type or paste from here on.
          */
          pattern: `[0-9+.\\(\\)\\/\\s\\-]{4,}`,
          minLength: 4,
          maxLength,
        },
      }}
    />
  );
}

/**
 * The two controls come back as they were typed after a refused submit, whichever form they are
 * on (`DECISIONS.md` §315): the public form hands the cookie's draft in through `draft`; a
 * backoffice form provides the returned values through `RecallProvider`, and this reads them
 * under the same two names the controls post. Keyed on the answer so the island re-mounts from them.
 */
export default function PhoneField(props: ComponentProps<typeof PhoneFieldIsland>) {
  const recall = useRecall();
  const recalled = recall.has ? { country: recall.value(`${props.name}Country`), national: recall.value(props.name) } : undefined;
  return <PhoneFieldIsland key={recall.generation} {...props} draft={props.draft ?? recalled} />;
}
