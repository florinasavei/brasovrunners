import { COLOR, COLOR_DARK } from "@/theme/brand";
import { CALENDAR_TONE_TOKENS } from "@/theme/brand-pairs";
import { UNDER_LOOK, UNDER_LOOK_DARK } from "@/theme/look";
import type { CalendarTone } from "../domain/calendar-kind";

/**
 * The calendar's three colours by kind, under «Aspectul nou» only (the facelift's phase 4,
 * `docs/REDESIGN.md`): plain `sx` fragments written under the look's scope, light and dark, from
 * the one table of tokens `brand-pairs.ts` holds at AA (`CALENDAR_TONE_TOKENS`). Off, no rule
 * matches and an entry is drawn as it was — a race filled in the brand colour, the rest quiet.
 *
 * Plain objects in a module of their own, so the client chip (`CalendarEventChip`), the legend and
 * the design page read the same values, and a unit test can hold them without rendering.
 */

/** An entry in the grid or the list, under the look: its kind's fill and the words on it. */
export function toneEntrySx(tone: CalendarTone) {
  const { fill, ink } = CALENDAR_TONE_TOKENS[tone];
  return {
    [UNDER_LOOK]: { bgcolor: COLOR[fill], color: COLOR[ink], borderRadius: "8px" },
    [UNDER_LOOK_DARK]: { bgcolor: COLOR_DARK[fill], color: COLOR_DARK[ink] },
  } as const;
}

/** The dot an entry and the legend lead with: drawn only under the look. */
export function toneDotSx(tone: CalendarTone) {
  const { dot } = CALENDAR_TONE_TOKENS[tone];
  return {
    display: "none",
    width: 8,
    height: 8,
    borderRadius: "50%",
    flexShrink: 0,
    [UNDER_LOOK]: { display: "inline-block", bgcolor: COLOR[dot] },
    [UNDER_LOOK_DARK]: { bgcolor: COLOR_DARK[dot] },
  } as const;
}

/** The legend's own dot: always drawn, since the legend itself is drawn only under the look. */
export function legendDotSx(tone: CalendarTone) {
  const { dot } = CALENDAR_TONE_TOKENS[tone];
  return {
    display: "inline-block",
    width: 10,
    height: 10,
    borderRadius: "50%",
    flexShrink: 0,
    bgcolor: COLOR[dot],
    [UNDER_LOOK_DARK]: { bgcolor: COLOR_DARK[dot] },
  } as const;
}
