/*
  The birth-date box's mask (§NNN, amending §561): the person types digits and the box puts the
  dots in — «11» is «11.», «1105» is «11.05.», «11051990» is «11.05.1990» — so nobody types a
  separator, and a phone's number pad (which has none) is all it takes.

  The mask is Maskito's (`@maskito/kit`'s `maskitoDate`; the owner, 2026-09-30: «we need
  libraries for this, for the mask»). It works from `beforeinput` and `input`, never from keys,
  so Android's keyboards (key 229 for everything), a paste, a drop, autofill and a composing
  keyboard all go through the same rules. It keeps the digits and the dots and refuses a letter
  and a ninth digit; a digit typed in the middle takes the place of the one there, and one deleted
  there leaves a 0 to type over; a day over 31 or a month over 12 cannot start («35» is «03.05»);
  and a dot typed after a lone digit pads it («5.» is «05.»). `DD.MM.YYYY` is `DATE_DISPLAY_FORMAT` (§345). What is ours, each part tested
  in `tests/unit/registrations/birth-date-input-mask.test.ts`:

  - **the posted shape**: `1990-05-11` — pasted, autofilled, or what the tests' `fill` sends — is
    turned day first before the kit reads it, which would take «19» for the day;
  - **any separator a keyboard offers**: a typed «/», «-», «,» or space is the dot;
  - **a backspace over a dot takes the digit before it** (Delete, the digit after it): the kit
    alone moves the caret over a dot and removes nothing, so the person would press twice;
  - **the dot as soon as the day or the month is whole**: the kit adds it only with the next digit;
  - **an impossible date stays as typed**: the kit would turn «29.02.2001» into «01.03.2001» — a
    birth date nobody typed — where the box's own check calls it no date (`birthDateValidity`).

  No `min` or `max` goes to the kit either: it would clamp a too-young date to the youngest
  allowed, and the box has to show what was typed and say why it is refused (`birthDateHelper`).
  Without JavaScript none of this runs, and the box is the plain text box the server reads every
  tolerant shape of (`normalizeTypedDate`).
*/
import type { MaskitoOptions, MaskitoPostprocessor, MaskitoPreprocessor } from "@maskito/core";
import { maskitoDate } from "@maskito/kit";

const DOT = ".";
/** The posted shape, pasted or autofilled: `1990-05-11`. */
const ISO_SHAPE = /^\s*(\d{4})-(\d{1,2})-(\d{1,2})\s*$/;
/** A separator other than the dot, typed on its own. */
const OTHER_SEPARATOR = /^[/\-, ]$/;
/** A whole date in the mask. */
const WHOLE = /^\d{2}\.\d{2}\.\d{4}$/;

const dayFirst = (iso: RegExpExecArray) => `${iso[3].padStart(2, "0")}.${iso[2].padStart(2, "0")}.${iso[1]}`;

/** `1990-05-11`, inserted or already in the box (autofill sends no `beforeinput`), is `11.05.1990`; «/» typed is «.». */
export const postedShapePreprocessor: MaskitoPreprocessor = ({ elementState, data }, actionType) => {
  if (actionType === "insert") {
    const iso = ISO_SHAPE.exec(data);
    if (iso) return { elementState, data: dayFirst(iso) };
    if (OTHER_SEPARATOR.test(data)) return { elementState, data: DOT };
  }
  if (actionType === "validation") {
    const iso = ISO_SHAPE.exec(elementState.value);
    if (iso) {
      const value = dayFirst(iso);
      return { elementState: { value, selection: [value.length, value.length] }, data };
    }
  }
  return { elementState, data };
};

/** A backspace whose one character is a dot takes the digit before it too; Delete, the digit after it. */
export const dotTakesDigitPreprocessor: MaskitoPreprocessor = ({ elementState, data }, actionType) => {
  const { value, selection } = elementState;
  const [from, to] = selection;
  if (to - from !== 1 || value[from] !== DOT) return { elementState, data };
  if (actionType === "deleteBackward" && /\d/.test(value[from - 1] ?? "")) {
    return { elementState: { value, selection: [from - 1, to] }, data };
  }
  if (actionType === "deleteForward" && /\d/.test(value[to] ?? "")) {
    return { elementState: { value, selection: [from, to + 1] }, data };
  }
  return { elementState, data };
};

/** «11» typed is «11.», «11.05» is «11.05.»: only while the text grows with the caret at its end, so a backspace never meets it. */
export const dotAfterWholePartPostprocessor: MaskitoPostprocessor = ({ value, selection }, initial) => {
  const [from, to] = selection;
  if (value.length > initial.value.length && from === to && to === value.length && /^\d{2}(\.\d{2})?$/.test(value)) {
    const dotted = `${value}${DOT}`;
    return { value: dotted, selection: [dotted.length, dotted.length] };
  }
  return { value, selection };
};

const kit = maskitoDate({ mode: "dd/mm/yyyy", separator: DOT });

/** The kit's own postprocessors, except that a whole date they would move to another day is left as typed. */
const kitKeepingImpossibleDates: MaskitoPostprocessor = (state, initial) => {
  const result = kit.postprocessors.reduce((next, postprocessor) => postprocessor(next, initial), state);
  return WHOLE.test(state.value) && result.value !== state.value ? state : result;
};

/** What `useMaskito` is given: one object at module scope, so the hook never rebuilds the mask. */
export const birthDateMaskOptions: MaskitoOptions = {
  ...kit,
  preprocessors: [postedShapePreprocessor, dotTakesDigitPreprocessor, ...kit.preprocessors],
  postprocessors: [kitKeepingImpossibleDates, dotAfterWholePartPostprocessor],
};
