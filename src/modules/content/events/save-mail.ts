import type { ConfirmAlso, FormCondition } from "@/shared/feedback/notice";
import { WINDOW_SEND_EMAIL_FIELD } from "@/shared/forms/send-email";

/**
 * What else the editor's save emails, said as the quieter lines of a question that asks already (the design «telling the
 * owner about every email a staff press sends», slices 3 and 4): the cancellation and the notice carry the offers and the
 * window's declarations, the offers' question carries the window's. Pure, so the counts are unit-tested: each line is
 * said only when the form as posted makes it true, as the save itself decides it.
 */

/** What the window's move does on the next save (`registrations/window-holds.ts#previewWindowHolds`). */
export type WindowHoldCounts = { moveNow: number; atWindow: number };

/**
 * The window's re-sent «Semnează declarația» lines, by how far the save moves the places held for the declaration:
 *
 * - the ones held to another instant (`moveNow`) move at every save, so while the window's four boxes — its two days, the
 *   start's day and hour — keep their stored values, the line counts those alone;
 * - the ones held to the window's own instant (`atWindow`) follow a changed window too, so once any box moves the line
 *   counts both: «cel mult moveNow + atWindow»;
 * - with nothing held to the window's instant, one line, always.
 *
 * `open` false — the window not open yet, or the event cancelled — says nothing: such a save sends none. `skipped`, the
 * line said while «Trimite din nou „Semnează declarația”» (`sendEmail.window`) is unticked, follows whichever count is
 * said; the count stays «cel mult»: a deadline moved earlier is still told.
 */
export function windowMailLines(input: {
  holds: WindowHoldCounts | null;
  open: boolean;
  /** Any of the four boxes moved from its stored value. */
  moved: FormCondition;
  /** Each of the four boxes as stored. */
  unmoved: readonly FormCondition[];
  /** The email line for at most `count` re-sent declarations. */
  line: (count: number) => string;
  skipped?: string;
}): ConfirmAlso[] {
  const { holds, open, moved, unmoved, line, skipped } = input;
  if (!open || holds === null || holds.moveNow + holds.atWindow <= 0) return [];
  const off: FormCondition = { field: WINDOW_SEND_EMAIL_FIELD, equals: "off" };
  const said: { count: number; when?: readonly FormCondition[] }[] =
    holds.atWindow === 0
      ? [{ count: holds.moveNow }]
      : [{ count: holds.moveNow + holds.atWindow, when: [moved] }, ...(holds.moveNow > 0 ? [{ count: holds.moveNow, when: unmoved }] : [])];
  return said.flatMap(({ count, when }) => [
    { text: line(count), ...(when ? { when } : {}) },
    ...(skipped ? [{ text: skipped, when: [...(when ?? []), off] }] : []),
  ]);
}

/**
 * The offers a save makes, as lines of another question: the offers' email line, then its own quieter lines — the club's
 * count of their copies — each said only while the offers are (`when`).
 */
export function raiseMailLines(mail: { email?: string; also?: readonly ConfirmAlso[] } | null, when: readonly FormCondition[] | null): ConfirmAlso[] {
  if (!mail?.email || !when) return [];
  return [{ text: mail.email, when }, ...(mail.also ?? []).map((also) => ({ ...also, when: [...when, ...(also.when ?? [])] }))];
}
