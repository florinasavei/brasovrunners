import { COLOR, COLOR_DARK } from "@/theme/brand";
import { CALENDAR_TONE_TOKENS } from "@/theme/brand-pairs";
import { LOOK_ACCENT_TINT, UNDER_LOOK, UNDER_LOOK_DARK } from "@/theme/look";
import type { CalendarTone } from "../domain/calendar-kind";

/**
 * The calendar's three colours by kind, under «Aspectul nou» only (the facelift's phase 4,
 * `docs/REDESIGN.md`): plain `sx` fragments written under the look's scope, light and dark, from
 * the one table of tokens `brand-pairs.ts` holds at AA (`CALENDAR_TONE_TOKENS`). Off, no rule
 * matches and an entry is drawn as it was — a race filled in the brand colour, the rest quiet.
 *
 * The weekly runs wear the club's accent («Culoarea de accent»): a token of the accent's family is
 * drawn through the variables the layout's stylesheet writes from the setting, light and dark — the
 * pale band as `LOOK_ACCENT_TINT`, the hot shade as `primary.light` — never as the pink's own
 * colour, so one value serves both schemes and every accent, and the default pink draws exactly what
 * it drew. Every accent's pairs, the weekly tone's among them, are held at AA by
 * `tests/unit/appearance/look-accent.test.ts`. The green and the grey are the platform's own and keep
 * their tokens.
 *
 * Plain objects in a module of their own, so the client chip (`CalendarEventChip`), the legend and
 * the design page read the same values, and a unit test can hold them without rendering.
 */

type Token = keyof typeof COLOR & keyof typeof COLOR_DARK;

/**
 * The accent's four shades as the setting draws them under the look: the slots of MUI's primary the
 * stylesheet redefines (`LOOK_PRIMARY_TOKENS`, `modules/appearance/domain/site-look.ts`) and the
 * band's variable. One value for both schemes: the variables follow the scheme themselves.
 */
const ACCENT_SHADE: Readonly<Partial<Record<Token, string>>> = {
  accent: "primary.light",
  accentInk: "primary.main",
  accentDeep: "primary.dark",
  accentTint: LOOK_ACCENT_TINT,
};

/** A tone's token in one scheme: an accent shade through the setting's variable, any other token its own colour. */
function drawn(token: Token, scheme: Readonly<Record<Token, string>>): string {
  return ACCENT_SHADE[token] ?? scheme[token];
}

/** An entry in the grid or the list, under the look: its kind's fill and the words on it. */
export function toneEntrySx(tone: CalendarTone) {
  const { fill, ink } = CALENDAR_TONE_TOKENS[tone];
  return {
    [UNDER_LOOK]: { bgcolor: drawn(fill, COLOR), color: drawn(ink, COLOR), borderRadius: "8px" },
    [UNDER_LOOK_DARK]: { bgcolor: drawn(fill, COLOR_DARK), color: drawn(ink, COLOR_DARK) },
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
    [UNDER_LOOK]: { display: "inline-block", bgcolor: drawn(dot, COLOR) },
    [UNDER_LOOK_DARK]: { bgcolor: drawn(dot, COLOR_DARK) },
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
    bgcolor: drawn(dot, COLOR),
    [UNDER_LOOK_DARK]: { bgcolor: drawn(dot, COLOR_DARK) },
  } as const;
}

/**
 * A past entry under the look (§NNN), faded the way Google Calendar fades a day gone: the lighter
 * fill (`action.hover`, a few percent of the ink over the cell) and the softer words
 * (`text.secondary`), whatever the entry's kind. Tokens of the theme only, never a colour literal,
 * and never a blur or an opacity on the words — they stay readable and the link stays a link.
 * Both schemes are written, since the dark rule would otherwise keep the kind's own fill.
 * `tests/unit/events/calendar-theme-v2-head.test.ts` holds the words at AA for large text on the fill.
 */
export const PAST_ENTRY_SX = {
  [UNDER_LOOK]: { bgcolor: "action.hover", color: "text.secondary", "& [data-entry-dot]": { opacity: 0.45 } },
  [UNDER_LOOK_DARK]: { bgcolor: "action.hover", color: "text.secondary" },
} as const;
