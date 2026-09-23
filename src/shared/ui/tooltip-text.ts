/**
 * How a tooltip that explains something is set (`DECISIONS.md` §257, §NNN): the one style
 * `Hint` and `InfoTip` both hand to MUI's tooltip slot, and how long it stays up after a tap.
 *
 * The owner, of the registrations list's journey hint arriving as one paragraph of dashes:
 * "tooltipurile trebuie să fie mai lungi, spre exemplu aici trebuie să fie cu liniuță, frumos
 * descris". §257 had already decided that a newline in a message is a line in the tooltip — but
 * only `InfoTip` carried the style, and the journey legend sits behind `Hint`, so the decision
 * never reached the one tooltip it was written for. One object, imported by both, is what keeps
 * the two from drifting apart again.
 *
 * - `pre-line`: a `\n` in the message is a line break, and a list written as `\n– item` reads as
 *   one item per line. Runs of spaces still collapse, so a sentence is unaffected.
 * - A ceiling of 400 px: wide enough that a step does not wrap in the middle of itself, narrow
 *   enough to read — a tooltip as wide as a desktop is unreadable whatever its line breaks say.
 * - Body text, not MUI's 11 px caption: these are paragraphs somebody reads to the end, often
 *   on a phone, and a comfortable line height separates the items without list markup.
 *
 * No list markup inside: MUI's tooltip is a single text node by design, and the text is also
 * the button's accessible name, which a screen reader reads as it reads the tooltip.
 */
export const TOOLTIP_TEXT_SX = {
  whiteSpace: "pre-line",
  maxWidth: 400,
  fontSize: "0.875rem",
  lineHeight: 1.5,
  px: 1.5,
  py: 1,
} as const;

/** The shortest time a tooltip stays up after a thumb leaves it: MUI's 1.5 s is a glance. */
const MIN_TOUCH_MS = 6_000;
/** And the longest, so a tooltip nobody closes does not sit over the list for good. */
const MAX_TOUCH_MS = 20_000;
/** Roughly a slow reader on a phone: about fifteen characters a second, plus a moment to look. */
const MS_PER_CHARACTER = 65;

/**
 * How long a tooltip stays open after a tap (`leaveTouchDelay`), from how much it says: six
 * seconds for a sentence, up to twenty for an eight-line legend. On a touch screen the tooltip
 * opens on the tap (`enterTouchDelay={0}`) and closes on its own once this has passed; a long
 * explanation that closed after MUI's default 1.5 s could not be read at all.
 */
export function readingTimeMs(text: string): number {
  const estimate = 2_000 + text.length * MS_PER_CHARACTER;
  return Math.min(MAX_TOUCH_MS, Math.max(MIN_TOUCH_MS, estimate));
}
