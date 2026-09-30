/*
  The birth-date box's mask (§NNN, amending §561): the person types digits and the box puts the
  dots in — «11» is «11.», «1105» is «11.05.», «11051990» is «11.05.1990» — so nobody types a
  separator, and a phone's number pad (which has none) is all it takes. A few lines of a
  controlled edit, no mask library (the owner: nothing over a library). The rules, each tested in
  `tests/unit/registrations/birth-date-input-mask.test.ts`:

  - digits only, at most eight, shown `DD.MM.YYYY` (`DATE_DISPLAY_FORMAT`);
  - a separator typed after one digit of the day or the month pads it: «5.» is «05.»;
  - a backspace over a dot removes the digit before it (a forward delete, the digit after it),
    or the dot would only come back;
  - a paste of «11/05/1990», «11-05-1990», «5.11.1990», «11051990» or the posted `1990-05-11` is
    read whole and shown in the mask;
  - the caret stays after the digit it followed: at the end while typing, in place in the middle.

  Without JavaScript none of this runs, and the box is the plain text box the server reads every
  tolerant shape of (`normalizeTypedDate`).
*/

/** The posted shape, pasted or autofilled: `1990-05-11`. */
const ISO_SHAPE = /^\s*(\d{4})-(\d{1,2})-(\d{1,2})\s*$/;
/** A whole day-first date with any one separator a keyboard offers, pasted at once. */
const WHOLE_DAY_FIRST = /^\s*(\d{1,2})\s*[./\-, ]\s*(\d{1,2})\s*[./\-, ]\s*(\d{4})\s*$/;
const SEPARATOR = /[./\-, ]/;
const MAX_DIGITS = 8;

const digitCount = (text: string) => text.replace(/\D/g, "").length;

/** Eight digits at most, `DDMMYYYY`, from whatever is in the box. */
export function birthDateDigits(text: string): string {
  const iso = ISO_SHAPE.exec(text);
  if (iso) return `${iso[3].padStart(2, "0")}${iso[2].padStart(2, "0")}${iso[1]}`;
  const whole = WHOLE_DAY_FIRST.exec(text);
  if (whole) return `${whole[1].padStart(2, "0")}${whole[2].padStart(2, "0")}${whole[3]}`;
  const digits = text.replace(/\D/g, "").slice(0, MAX_DIGITS);
  // «5.» or «11.5/»: a separator typed after a lone digit of the day or the month closes it.
  if (SEPARATOR.test(text.slice(-1)) && /\d$/.test(text.slice(0, -1).trimEnd())) {
    if (digits.length === 1) return `0${digits}`;
    if (digits.length === 3) return `${digits.slice(0, 2)}0${digits[2]}`;
  }
  return digits;
}

/** `DD.MM.YYYY` for up to eight digits; the dot follows a whole day and a whole month at once. */
export function birthDateMasked(digits: string): string {
  const day = digits.slice(0, 2);
  const month = digits.slice(2, 4);
  const year = digits.slice(4, MAX_DIGITS);
  return `${day}${digits.length >= 2 ? "." : ""}${month}${digits.length >= 4 ? "." : ""}${year}`;
}

/** Where the caret goes: after the `count`-th digit of `text`, or at its very end once every digit is before it. */
function caretAfterDigits(text: string, count: number): number {
  if (count >= digitCount(text)) return text.length;
  if (count <= 0) return 0;
  let seen = 0;
  for (let at = 0; at < text.length; at += 1) {
    if (/\d/.test(text[at]) && ++seen === count) return at + 1;
  }
  return text.length;
}

export type BirthDateEdit = { text: string; caret: number };

/**
 * One edit of the box, masked: `raw` is what the browser now holds, `caret` its selection end,
 * `previous` what the box showed before (the mask's own last text), and `inputType` the
 * `InputEvent`'s own word when the browser gives one («deleteContentForward» for the Delete key).
 * Android's keyboards send a backspace as an `input` event with no key to read, so a removed dot
 * is found by comparing `raw` with `previous`, never from a `keydown`.
 */
export function maskBirthDate(raw: string, caret: number, previous: string, inputType = ""): BirthDateEdit {
  // A dot removed and nothing else: take the digit beside it with it.
  if (raw.length === previous.length - 1) {
    let at = 0;
    while (at < raw.length && raw[at] === previous[at]) at += 1;
    if (previous[at] === "." && raw === previous.slice(0, at) + previous.slice(at + 1)) {
      const digits = previous.replace(/\D/g, "");
      const before = digitCount(previous.slice(0, at));
      const drop = inputType === "deleteContentForward" ? before : before - 1;
      if (drop < 0 || drop >= digits.length) {
        const text = birthDateMasked(digits);
        return { text, caret: caretAfterDigits(text, before) };
      }
      const text = birthDateMasked(digits.slice(0, drop) + digits.slice(drop + 1));
      return { text, caret: caretAfterDigits(text, drop) };
    }
  }
  // A digit taken out of the middle leaves «1.05.1990», which reads as a whole date: a deletion only shifts the digits.
  // (A paste over a selection may be shorter too: the event's own word decides when there is one.)
  const deleting = inputType ? inputType.startsWith("delete") : raw.length < previous.length;
  const text = birthDateMasked(deleting ? raw.replace(/\D/g, "").slice(0, MAX_DIGITS) : birthDateDigits(raw));
  // A paste of a whole date, a padded separator, or a caret at the end: the caret goes to the end.
  const whole = !deleting && (ISO_SHAPE.test(raw) || WHOLE_DAY_FIRST.test(raw));
  const atEnd = caret >= raw.length || whole;
  return { text, caret: atEnd ? text.length : caretAfterDigits(text, digitCount(raw.slice(0, caret))) };
}

/** The input, as much of it as the mask touches — a real `HTMLInputElement` in the browser, a plain object in a test. */
export type MaskedBox = {
  value: string;
  selectionEnd: number | null;
  setSelectionRange(start: number, end: number): void;
  dispatchEvent?(event: Event): boolean;
};

/**
 * Applies the mask to the box after the browser's own edit, from the `input` event's handler.
 * When the mask changed the text, a `change` event tells the islands that read the box by its id
 * (`useBirthDateValue`: the guardian block, the minor's fields) that the value they read a moment
 * ago, during the same `input` event, is now another; React itself ignores it, the value being the
 * one its tracker already holds.
 */
export function applyBirthDateMask(box: MaskedBox, previous: string, inputType = "", focused = true): string {
  const raw = box.value;
  const edit = maskBirthDate(raw, box.selectionEnd ?? raw.length, previous, inputType);
  if (edit.text !== raw) {
    box.value = edit.text;
    if (typeof Event === "function") box.dispatchEvent?.(new Event("change"));
  }
  if (focused) box.setSelectionRange(edit.caret, edit.caret);
  return edit.text;
}
