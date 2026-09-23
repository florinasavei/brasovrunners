import { DIALING_CODES, KEEPS_LEADING_ZERO } from "./phone";

/**
 * The telephone box's mask: digits grouped with spaces as they are typed (`DECISIONS.md` §NNN;
 * the owner, with another site's field: "I like the phone input with the mask").
 *
 * Presentation only, and that is the whole safety argument. `composePhone` strips spaces before
 * it reads anything (§84), so a formatted value and the bare digits compose to the same E.164 —
 * the tests prove it for every country in the table. What is stored, what is posted and every
 * answer the box gives (§198, §231, §283) are exactly what they were.
 *
 * Every function here reads a typed value the way `composePhone` will: a leading `+` (after the
 * separators people type) is the international form (§226), `00` is the international prefix,
 * the country's own code typed without a plus on a long number is the copied-from-a-contact-card
 * form, and otherwise a leading `0` is the trunk prefix — except where the country keeps it. The
 * mask therefore shows the number *as it will be read*, which is the one thing a mask can add
 * that a cleaner box cannot.
 *
 * Pure, with no DOM, so the server renders the prefilled value through the same function the
 * browser types through, and a unit test can hold all of it.
 */

/** The national significant number's groups (no trunk zero), and one number to show as the placeholder. */
type Mask = { readonly groups: readonly number[]; readonly example: string };

/**
 * The countries a Brașov race meets, and how their own people write a mobile number.
 *
 * A guide, not a rule: numbering plans vary in length within a country (a German number is six
 * to eleven digits), so digits past the pattern carry on in threes and nothing is refused for
 * not fitting — refusing stays `composePhone`'s job, and its job alone. A country missing here
 * shares the mask of one with the same dialling code (every `+1` is the North American plan,
 * `+44` Jersey is Britain's), and a country with neither gets threes.
 *
 * Hungary's example has no trunk prefix on purpose: its national prefix is `06`, not `0`, and a
 * placeholder written that way would teach a number `composePhone` reads wrongly.
 */
export const PHONE_MASKS: Readonly<Record<string, Mask>> = {
  RO: { groups: [3, 3, 3], example: "0712345678" },
  MD: { groups: [2, 3, 3], example: "069123456" },
  HU: { groups: [2, 3, 4], example: "201234567" },
  BG: { groups: [2, 3, 4], example: "0871234567" },
  DE: { groups: [3, 4, 4], example: "015123456789" },
  AT: { groups: [3, 3, 4], example: "06641234567" },
  IT: { groups: [3, 3, 4], example: "3123456789" },
  FR: { groups: [1, 2, 2, 2, 2], example: "0612345678" },
  ES: { groups: [3, 3, 3], example: "612345678" },
  GB: { groups: [4, 6], example: "07700900123" },
  NL: { groups: [1, 4, 4], example: "0612345678" },
  BE: { groups: [3, 2, 2, 2], example: "0470123456" },
  PL: { groups: [3, 3, 3], example: "512345678" },
  UA: { groups: [2, 3, 2, 2], example: "0501234567" },
  US: { groups: [3, 3, 4], example: "2125550100" },
  CA: { groups: [3, 3, 4], example: "4165550100" },
};

/** E.164: fifteen digits in all, the country code included (§283). */
const E164_DIGITS = 15;

/** The mask for a country: its own, a country's sharing its dialling code, or none (threes). */
function maskFor(countryCode: string): Mask | undefined {
  const own = PHONE_MASKS[countryCode];
  if (own) return own;
  const dialing = DIALING_CODES[countryCode];
  if (!dialing) return undefined;
  const sibling = Object.keys(PHONE_MASKS).find((code) => DIALING_CODES[code] === dialing);
  return sibling ? PHONE_MASKS[sibling] : undefined;
}

/**
 * What a typed value means, read the way `composePhone` reads it: the digits, and whether a `+`
 * came first once the separators it tolerates are set aside. A `+` anywhere else is punctuation.
 */
function readTyped(typed: string): { plus: boolean; digits: string } {
  return { plus: typed.replace(/[\s().\-]/g, "").startsWith("+"), digits: typed.replace(/\D/g, "") };
}

/** Digits cut into the pattern's groups; whatever is left over carries on in threes. */
function group(digits: string, groups: readonly number[]): string {
  const parts: string[] = [];
  let at = 0;
  for (const size of groups) {
    if (at >= digits.length) break;
    parts.push(digits.slice(at, at + size));
    at += size;
  }
  for (; at < digits.length; at += 3) parts.push(digits.slice(at, at + 3));
  return parts.join(" ");
}

/** The same groups with a typed trunk zero riding on the first: `712 …` becomes `0712 …`. */
function withTrunkZero(groups: readonly number[]): readonly number[] {
  return groups.length > 0 ? [groups[0] + 1, ...groups.slice(1)] : [4];
}

/** A country code and what follows it — the chosen country's if it is the one typed, else whichever code the digits carry. */
function international(countryCode: string, digits: string): string {
  const chosen = DIALING_CODES[countryCode];
  let code = chosen && digits.startsWith(chosen) ? chosen : undefined;
  let mask = code ? maskFor(countryCode) : undefined;
  if (!code) {
    let owner: string | undefined;
    for (const [candidate, dialing] of Object.entries(DIALING_CODES)) {
      if (digits.startsWith(dialing) && (!code || dialing.length > code.length)) {
        code = dialing;
        owner = candidate;
      }
    }
    mask = owner ? maskFor(owner) : undefined;
  }
  // No code yet — "+4" on the way to "+40" — so there is nothing to group around.
  if (!code) return group(digits, []);
  const rest = digits.slice(code.length);
  return rest ? `${code} ${group(rest, mask?.groups ?? [])}` : code;
}

/**
 * The typed number as the box shows it: `0752 189 098`, `752 189 098`, `+40 752 189 098`.
 *
 * Spaces only, and only digits and a leading `+` survive — anything else a person pastes is
 * dropped, as the box has dropped it since §223. Idempotent: formatting a formatted value
 * changes nothing, which is what lets the browser run it on every keystroke.
 */
export function formatNationalNumber(countryCode: string, typed: string): string {
  const country = countryCode.toUpperCase();
  const { plus, digits } = readTyped(typed);
  if (plus) return `+${international(country, digits)}`;
  if (digits.startsWith("00")) {
    const rest = international(country, digits.slice(2));
    return rest ? `00 ${rest}` : "00";
  }
  const groups = maskFor(country)?.groups ?? [];
  const dialing = DIALING_CODES[country];
  // `composePhone`'s "typed with the country code and no plus": shown that way, so it reads that way.
  if (dialing && digits.startsWith(dialing) && digits.length > dialing.length + 6) {
    return `${dialing} ${group(digits.slice(dialing.length), groups)}`;
  }
  if (digits.startsWith("0") && !KEEPS_LEADING_ZERO.has(country)) return group(digits, withTrunkZero(groups));
  return group(digits, groups);
}

/**
 * How many digits the box may hold for what has been typed so far (§283): as many as leave the
 * **stored** number at fifteen digits, which is E.164's ceiling.
 *
 * Counted in digits, never in characters — the mask's spaces are not the person's. And counted
 * against the form `composePhone` will read, because the typed digits and the stored ones differ:
 * a `+40…` carries the code itself, a `0040…` two more, a trunk zero one that is dropped.
 */
export function phoneDigitCap(countryCode: string, typed: string): number {
  const country = countryCode.toUpperCase();
  const dialing = DIALING_CODES[country] ?? "";
  const { plus, digits } = readTyped(typed);
  if (plus) return E164_DIGITS;
  if (digits.startsWith("00")) return E164_DIGITS + 2;
  if (dialing && digits.startsWith(dialing) && digits.length > dialing.length + 6) return E164_DIGITS;
  const national = E164_DIGITS - dialing.length;
  return digits.startsWith("0") && !KEEPS_LEADING_ZERO.has(country) ? national + 1 : national;
}

/** The typed value reduced to what the box keeps — a leading `+` and the digits — cut at the cap. */
export function capPhoneDigits(countryCode: string, typed: string): string {
  const { plus, digits } = readTyped(typed);
  return (plus ? "+" : "") + digits.slice(0, phoneDigitCap(countryCode, typed));
}

/**
 * The `maxLength` for the box: the longest value the mask can produce within the cap, in any of
 * the forms the cap admits, spaces and the `+` included.
 *
 * It has to be the longest and not a typical one. `maxLength` is what the browser enforces while
 * a person types *and* what it truncates a paste to — so one character short, and a correctly
 * copied number loses its last digit before any of this code sees it.
 */
export function phoneMaxLength(countryCode: string): number {
  const country = countryCode.toUpperCase();
  const dialing = DIALING_CODES[country] ?? "";
  // Nines, because no dialling code begins with 99: a run of them is never mistaken for one.
  const nines = "9".repeat(E164_DIGITS);
  const forms = [nines, `0${nines}`, `+${dialing}${nines}`, `00${dialing}${nines}`, `${dialing}${nines}`];
  return Math.max(...forms.map((form) => formatNationalNumber(country, capPhoneDigits(country, form)).length));
}

/** The country's example number, masked — `0712 345 678` for Romania — or nothing where there is no mask. */
export function phonePlaceholder(countryCode: string): string | undefined {
  const country = countryCode.toUpperCase();
  const mask = maskFor(country);
  return mask ? formatNationalNumber(country, mask.example) : undefined;
}

/** A character the mask keeps: a digit, or the `+` in front. */
function isKept(character: string | undefined): boolean {
  return character !== undefined && /[\d+]/.test(character);
}

/** How many kept characters stand before `caret` in `raw` — a `+` only when it is the leading one. */
function keptBefore(raw: string, caret: number): number {
  const { plus } = readTyped(raw);
  const plusAt = plus ? raw.indexOf("+") : -1;
  let count = 0;
  for (let index = 0; index < Math.min(caret, raw.length); index += 1) {
    const character = raw[index];
    if (/\d/.test(character) || (character === "+" && index === plusAt)) count += 1;
  }
  return count;
}

/** Where the caret goes in `formatted` so that `count` kept characters stand before it. */
export function caretAfter(formatted: string, count: number): number {
  if (count <= 0) return 0;
  let seen = 0;
  for (let index = 0; index < formatted.length; index += 1) {
    if (isKept(formatted[index])) {
      seen += 1;
      if (seen === count) return index + 1;
    }
  }
  return formatted.length;
}

/**
 * One keystroke through the mask: the value the box should hold and where its caret belongs.
 *
 * - **The caret stays with its digit.** Reformatting moves spaces, so the caret is carried by
 *   the number of digits before it rather than by its offset — a digit typed in the middle of
 *   `0752 189 098` leaves the caret after that digit, not at the end of the box.
 * - **Backspace just after a space deletes the digit before it** (and Delete just before one,
 *   the digit after). Otherwise the space comes straight back and the key appears dead, which
 *   is the classic mask trap. Recognised from the edit itself — one space gone, nothing else
 *   changed — so it works on Android, whose keyboards report no key to a `keydown` listener.
 * - **The cap** (`phoneDigitCap`), in digits.
 *
 * `previous` is the box's value before this edit; `inputType` the `InputEvent`'s.
 */
export function reformatPhoneInput(input: {
  country: string;
  raw: string;
  caret: number;
  previous?: string;
  inputType?: string;
}): { value: string; caret: number } {
  let raw = input.raw;
  let caret = Math.max(0, Math.min(input.caret, raw.length));
  const previous = input.previous;
  const removedOneSeparator =
    previous !== undefined &&
    raw.length === previous.length - 1 &&
    !isKept(previous[caret]) &&
    previous.slice(0, caret) + previous.slice(caret + 1) === raw;
  if (removedOneSeparator && input.inputType === "deleteContentBackward") {
    let index = caret - 1;
    while (index >= 0 && !isKept(raw[index])) index -= 1;
    if (index >= 0) {
      raw = raw.slice(0, index) + raw.slice(index + 1);
      caret = index;
    }
  } else if (removedOneSeparator && input.inputType === "deleteContentForward") {
    let index = caret;
    while (index < raw.length && !isKept(raw[index])) index += 1;
    if (index < raw.length) raw = raw.slice(0, index) + raw.slice(index + 1);
  }
  const count = keptBefore(raw, caret);
  const value = formatNationalNumber(input.country, capPhoneDigits(input.country, raw));
  return { value, caret: caretAfter(value, count) };
}
