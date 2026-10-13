import Box from "@mui/material/Box";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { getFormatter, getLocale, getTranslations } from "next-intl/server";
import ChipLink from "@/shared/ui/ChipLink";
import Link from "next/link";
import { getPathname } from "@/i18n/navigation";
import { CLUB_TIME_ZONE } from "@/i18n/dates";
import { DENSITY } from "@/theme/density";
import { FONT } from "@/theme/brand";
import { LOOK_HEADING, UNDER_LOOK } from "@/theme/look";
import { currentMonth, shiftMonth, type YearMonth, yearsAround } from "../domain/calendar";
import { calendarAddress } from "../domain/calendar-path";
import CalendarPicker from "./CalendarPicker";
import CalendarStepLink from "./CalendarStepLink";
import type { CalendarLayout, CalendarView } from "./EventCalendar";

/**
 * The calendar's controls: which period is on view, and every way to change it.
 *
 * Split out of `EventCalendar` by `DECISIONS.md` §166. It depends on the *address* — the
 * month or year asked for, the layout, the filter it keeps — and on nothing the database
 * says, which is the whole point: the body below it is a streamed region that becomes a
 * skeleton while the next month is fetched, and the controls must not go with it. Pressing
 * "next" three times quickly has to be three presses on the same buttons, not three presses
 * at whatever happens to be under the thumb after two re-renders.
 *
 * Every control is a link with a real `href`, so the month after this one is in the HTML a
 * crawler reads and the middle-click a reader expects still opens a tab. The two selects are
 * the one island (a select cannot navigate on change without JavaScript), and they go only
 * where a link could.
 */
/**
 * Where the two arrows go: the period before and the period after, keeping every filter and the
 * layout. One function, because the swipe on a touch screen (`CalendarSwipe`, §475) must go
 * exactly where the arrows go. The period is the address's path (`/ro/calendar/2026-10`, §574),
 * never its query: a `?month=` on the static calendar is what Next's router answered from the bare
 * page's prefetched copy, so the arrows changed the address and left September on screen.
 */
export function calendarStepHrefs({
  view,
  layout = "grid",
  query,
  locale,
  now,
}: {
  view: CalendarView;
  layout?: CalendarLayout;
  query: Record<string, string | string[]>;
  locale: "ro" | "en";
  now: Date;
}): { previous: string; next: string } {
  const basePath = getPathname({ locale, href: "/calendar" });
  const thisMonth = currentMonth(now, CLUB_TIME_ZONE);
  const step = (by: -1 | 1) =>
    calendarAddress(basePath, {
      view: view.kind === "month" ? { kind: "month", month: shiftMonth(view.month, by) } : { kind: "year", year: view.year + by },
      layout,
      query,
      thisMonth,
    });
  return { previous: step(-1), next: step(1) };
}

/**
 * The period's heading, hidden from sight on a phone only (§487): there the month and year selects
 * right under it already say it, and a line of its own pushed the grid a row down. It is still the
 * section's name (`aria-labelledby="calendar-title"`) and still read by a screen reader; from `sm`
 * it is drawn as before.
 */
export const TITLE_ON_A_PHONE_SX = {
  position: { xs: "absolute", sm: "static" },
  width: { xs: "1px", sm: "auto" },
  height: { xs: "1px", sm: "auto" },
  overflow: { xs: "hidden", sm: "visible" },
  clip: { xs: "rect(0 0 0 0)", sm: "auto" },
  whiteSpace: { xs: "nowrap", sm: "normal" },
  margin: { xs: "-1px", sm: 0 },
} as const;

/** The arrows beside the month's name: drawn only under the look, from `sm`. */
const TITLE_ARROW_SX = {
  display: "none",
  color: "text.primary",
  [UNDER_LOOK]: { display: { xs: "none", sm: "inline-flex" } },
} as const;

/** The period row's arrows: everywhere off the look; under it on a phone only, where the title's pair is not drawn. */
const ROW_ARROW_SX = { [UNDER_LOOK]: { display: { xs: "inline-flex", sm: "none" } } } as const;

/** «Azi» under the look: a small outlined button rather than a bare link, its 44-pixel target kept. */
const TODAY_SX = {
  display: "inline-flex",
  [UNDER_LOOK]: {
    "& > a": {
      minHeight: 44,
      px: 1.5,
      border: 1,
      borderColor: "divider",
      borderRadius: "12px",
      bgcolor: "background.paper",
      color: "text.primary",
      fontWeight: 600,
      textDecoration: "none",
      "&:hover": { borderColor: "primary.main", color: "primary.main" },
    },
  },
} as const;

/** The month's name under the look: the display face, larger, set tight. */
const TITLE_UNDER_LOOK = {
  [UNDER_LOOK]: { fontFamily: `${FONT.lookDisplay}, ${FONT.fallback}`, ...LOOK_HEADING, fontSize: { sm: "1.5rem", md: "1.75rem" }, minWidth: { sm: "11ch" }, textAlign: "center" },
} as const;

/**
 * A pair of period chips under the look: one segmented control — a pale track, the chosen segment
 * a raised card in the accent's ink (the mock-up's «Lună | An | Listă»). Off, the pills as before.
 */
const SEGMENTED_SX = {
  [UNDER_LOOK]: {
    alignItems: "center",
    // The track's padding and border from `sm` only: on a phone they put the chip row 8 pixels taller than its 44-pixel links.
    p: { sm: "3px" },
    borderRadius: "12px",
    bgcolor: "action.hover",
    border: { sm: 1 },
    // In the same `sm` rule as the shorthand, after it: a base value would be reset to `currentColor` by it.
    borderColor: { sm: "divider" },
    "& > a": { minHeight: { xs: 44, sm: 36 }, ml: "0 !important" },
    "& .MuiChip-root": { height: 30, borderRadius: "9px", px: 0.75, fontWeight: 600, border: 0, bgcolor: "transparent", color: "text.secondary" },
    "& .MuiChip-root:hover": { color: "text.primary" },
    "& a[aria-current='page'] .MuiChip-root": { bgcolor: "background.paper", color: "primary.main", boxShadow: "0 1px 3px var(--mui-palette-divider), 0 1px 1px var(--mui-palette-divider)" },
  },
} as const;

export default async function CalendarHeader({
  view,
  now,
  query = {},
  layout = "grid",
}: {
  view: CalendarView;
  now: Date;
  /** What the period links keep — the filters (§89, §413; a group ticked twice is an array). The period and the layout are the path's (§574). */
  query?: Record<string, string | string[]>;
  layout?: CalendarLayout;
}) {
  const t = await getTranslations("Events");
  const format = await getFormatter();
  const locale = (await getLocale()) as "ro" | "en";

  const month: YearMonth = view.kind === "month" ? view.month : { year: view.year, month: 1 };
  const anchor = new Date(Date.UTC(month.year, month.month - 1, 1, 12));
  const title =
    view.kind === "month"
      ? format.dateTime(anchor, { timeZone: "UTC", month: "long", year: "numeric" })
      : String(view.year);
  // Every control is an address on the calendar's own path (§251, §574): the period in the path,
  // the filters in the query.
  const basePath = getPathname({ locale, href: "/calendar" });
  const thisMonth = currentMonth(now, CLUB_TIME_ZONE);
  const href = (period: CalendarView, periodLayout: CalendarLayout) => calendarAddress(basePath, { view: period, layout: periodLayout, query, thisMonth });
  const { previous: previousHref, next: nextHref } = calendarStepHrefs({ view, layout, query, locale, now });
  const previousLabel = view.kind === "month" ? t("calendar.previous") : t("calendar.previousYear");
  const nextLabel = view.kind === "month" ? t("calendar.next") : t("calendar.nextYear");

  // The months from any year, in the reader's language.
  const monthNames = Array.from({ length: 12 }, (_, i) =>
    format.dateTime(new Date(Date.UTC(2024, i, 1, 12)), { timeZone: "UTC", month: "long" }),
  );

  return (
    <Stack direction="row" sx={{ alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 1, mb: { xs: DENSITY.gapSm, sm: 1.5 } }}>
      {/* On a phone the selects already say the month and the year (§487), so the heading is
          there for assistive technology and for the section's name, not drawn a second time. */}
      {/* Under «Aspectul nou», from `sm`, the arrows stand either side of the month's name (the
          mock-up's ‹ Octombrie 2026 ›) and the period row's pair is not drawn; on a phone the row
          keeps them, beside «Azi», where the heading is not drawn (§487). Off, as before. */}
      {/* `contents` on a phone: the heading is out of flow there (§487) and the arrows are not drawn,
          so the box must not take a line of the wrapping row (it cost the first week 8 pixels). */}
      <Box sx={{ display: { xs: "contents", sm: "flex" }, alignItems: "center", gap: 0.5 }}>
        <CalendarStepLink href={previousHref} label={previousLabel} direction="previous" sx={TITLE_ARROW_SX} />
        <Typography id="calendar-title" component="h2" variant="h2" sx={{ fontSize: "1.25rem", textTransform: "capitalize", ...TITLE_ON_A_PHONE_SX, ...TITLE_UNDER_LOOK }}>
          {title}
        </Typography>
        <CalendarStepLink href={nextHref} label={nextLabel} direction="next" sx={TITLE_ARROW_SX} />
      </Box>
      <Stack direction="row" sx={{ alignItems: "center", flexWrap: "wrap", columnGap: 1, rowGap: { xs: 0, sm: 1 }, width: { xs: "100%", sm: "auto" } }}>
        {/* Month or year, by select (§116) — the arrows step one at a time, "today" resets.
            One row that never wraps (§487): on a phone the selects give up their width to the
            arrows and «Azi», which keep their 44-pixel targets. From `sm` the selects stand eight
            pixels from ‹ Azi ›, as they did before the row existed (§490). */}
        <Box data-testid="calendar-period-row" sx={{ display: "flex", alignItems: "center", flexWrap: "nowrap", gap: { xs: 0.5, sm: 1 }, width: { xs: "100%", sm: "auto" }, minWidth: 0 }}>
        <CalendarPicker
          basePath={basePath}
          query={query}
          view={view.kind}
          layout={layout}
          thisMonth={thisMonth}
          year={month.year}
          month={month.month}
          years={yearsAround(now, CLUB_TIME_ZONE)}
          monthNames={monthNames}
          labels={{ month: t("calendar.pickMonth"), year: t("calendar.pickYear") }}
        />
        <Stack direction="row" spacing={{ xs: 0, sm: 0.5 }} sx={{ alignItems: "center", flexShrink: 0 }}>
          <CalendarStepLink href={previousHref} label={previousLabel} direction="previous" sx={ROW_ARROW_SX} />
          <Box component="span" sx={TODAY_SX}>
            <Link href={href({ kind: "month", month: thisMonth }, layout)} prefetch={false} style={{ fontSize: "0.875rem", minHeight: 44, display: "inline-flex", alignItems: "center" }}>
              {t("calendar.today")}
            </Link>
          </Box>
          <CalendarStepLink href={nextHref} label={nextLabel} direction="next" sx={ROW_ARROW_SX} />
        </Stack>
        </Box>
        {/* The two chip pairs on one row of their own on a phone (§487), the rule between them. */}
        <Box data-testid="calendar-chip-row" sx={{ display: "flex", alignItems: "center", flexWrap: "nowrap", columnGap: 1 }}>
        {/* The view: one month, or the whole year — small pills in 44px links (§158). */}
        <Stack direction="row" spacing={0.5} role="group" aria-label={`${t("calendar.viewMonth")} / ${t("calendar.viewYear")}`} sx={SEGMENTED_SX}>
          <ChipLink href={href({ kind: "month", month }, layout)} label={t("calendar.viewMonth")} active={view.kind === "month"} current={view.kind === "month" ? "page" : undefined} />
          <ChipLink href={href({ kind: "year", year: month.year }, "grid")} label={t("calendar.viewYear")} active={view.kind === "year"} current={view.kind === "year" ? "page" : undefined} />
        </Stack>
        {/* The layout, for a month (§137): the grid, or the list a phone used to get by default.
            A rule between the two groups (§175; the owner: "I need a separator here"): "month
            or year" and "grid or list" are two questions, and four pills in a row read as one
            set of four answers. The two pairs share a row on a phone too now (§487), so the rule
            stays on every width. */}
        {view.kind === "month" && (
          <Box aria-hidden="true" sx={{ width: "1px", alignSelf: "stretch", minHeight: 20, bgcolor: "divider", mx: 0.5, [UNDER_LOOK]: { bgcolor: "transparent", mx: 0 } }} />
        )}
        {view.kind === "month" && (
          <Stack direction="row" spacing={0.5} role="group" aria-label={`${t("calendar.layoutGrid")} / ${t("calendar.layoutList")}`} sx={SEGMENTED_SX}>
            <ChipLink href={href(view, "grid")} label={t("calendar.layoutGrid")} active={layout === "grid"} current={layout === "grid" ? "page" : undefined} />
            <ChipLink href={href(view, "list")} label={t("calendar.layoutList")} active={layout === "list"} current={layout === "list" ? "page" : undefined} />
          </Stack>
        )}
        </Box>
      </Stack>
    </Stack>
  );
}
