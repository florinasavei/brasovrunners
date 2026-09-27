import Box from "@mui/material/Box";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { getFormatter, getLocale, getTranslations } from "next-intl/server";
import ChipLink from "@/shared/ui/ChipLink";
import { getPathname, Link } from "@/i18n/navigation";
import { CLUB_TIME_ZONE } from "@/i18n/dates";
import { DENSITY } from "@/theme/density";
import { monthParam, shiftMonth, type YearMonth, yearsAround } from "../domain/calendar";
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
 * exactly where the arrows go.
 */
export function calendarStepHrefs({
  view,
  query,
  locale,
  pathname,
}: {
  view: CalendarView;
  query: Record<string, string | string[]>;
  locale: "ro" | "en";
  pathname: "/calendar" | "/events";
}): { previous: string; next: string } {
  const step = (by: -1 | 1) =>
    getPathname({
      locale,
      href: {
        pathname,
        query: { ...query, ...(view.kind === "month" ? { month: monthParam(shiftMonth(view.month, by)) } : { year: String(view.year + by) }) },
      },
    });
  return { previous: step(-1), next: step(1) };
}

/**
 * The period's heading, hidden from sight on a phone only (§NNN): there the month and year selects
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

export default async function CalendarHeader({
  view,
  now,
  query = {},
  layout = "grid",
  pathname = "/calendar",
}: {
  view: CalendarView;
  now: Date;
  /** The page the calendar is on (§251): every control links back to it, never to /events. */
  pathname?: "/calendar" | "/events";
  /** Other query parameters the month links keep — the filters (§89, §413; a group ticked twice is an array), the layout (§137). */
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
  const basePath = getPathname({ locale, href: pathname });
  const href = (params: Record<string, string>, drop?: string) => {
    const merged: Record<string, string | string[]> = { ...query, ...params };
    if (drop) delete merged[drop];
    return getPathname({ locale, href: { pathname, query: merged } });
  };
  const { previous: previousHref, next: nextHref } = calendarStepHrefs({ view, query, locale, pathname });

  // The months from any year, in the reader's language.
  const monthNames = Array.from({ length: 12 }, (_, i) =>
    format.dateTime(new Date(Date.UTC(2024, i, 1, 12)), { timeZone: "UTC", month: "long" }),
  );

  return (
    <Stack direction="row" sx={{ alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 1, mb: { xs: DENSITY.gapSm, sm: 1.5 } }}>
      {/* On a phone the selects already say the month and the year (§NNN), so the heading is
          there for assistive technology and for the section's name, not drawn a second time. */}
      <Typography id="calendar-title" component="h2" variant="h2" sx={{ fontSize: "1.25rem", textTransform: "capitalize", ...TITLE_ON_A_PHONE_SX }}>
        {title}
      </Typography>
      <Stack direction="row" sx={{ alignItems: "center", flexWrap: "wrap", columnGap: 1, rowGap: { xs: 0, sm: 1 }, width: { xs: "100%", sm: "auto" } }}>
        {/* Month or year, by select (§116) — the arrows step one at a time, "today" resets.
            One row that never wraps (§NNN): on a phone the selects give up their width to the
            arrows and «Azi», which keep their 44-pixel targets. */}
        <Box data-testid="calendar-period-row" sx={{ display: "flex", alignItems: "center", flexWrap: "nowrap", gap: 0.5, width: { xs: "100%", sm: "auto" }, minWidth: 0 }}>
        <CalendarPicker
          basePath={basePath}
          query={query}
          view={view.kind}
          year={month.year}
          month={month.month}
          years={yearsAround(now, CLUB_TIME_ZONE)}
          monthNames={monthNames}
          labels={{ month: t("calendar.pickMonth"), year: t("calendar.pickYear") }}
        />
        <Stack direction="row" spacing={{ xs: 0, sm: 0.5 }} sx={{ alignItems: "center", flexShrink: 0 }}>
          <CalendarStepLink href={previousHref} label={view.kind === "month" ? t("calendar.previous") : t("calendar.previousYear")} direction="previous" />
          <Link href={{ pathname, query }} style={{ fontSize: "0.875rem", minHeight: 44, display: "inline-flex", alignItems: "center" }}>
            {t("calendar.today")}
          </Link>
          <CalendarStepLink href={nextHref} label={view.kind === "month" ? t("calendar.next") : t("calendar.nextYear")} direction="next" />
        </Stack>
        </Box>
        {/* The two chip pairs on one row of their own on a phone (§NNN), the rule between them. */}
        <Box data-testid="calendar-chip-row" sx={{ display: "flex", alignItems: "center", flexWrap: "nowrap", columnGap: 1 }}>
        {/* The view: one month, or the whole year — small pills in 44px links (§158). */}
        <Stack direction="row" spacing={0.5} role="group" aria-label={`${t("calendar.viewMonth")} / ${t("calendar.viewYear")}`}>
          <ChipLink href={href({ month: monthParam(month) })} label={t("calendar.viewMonth")} active={view.kind === "month"} current={view.kind === "month" ? "page" : undefined} />
          <ChipLink href={href({ year: String(month.year) })} label={t("calendar.viewYear")} active={view.kind === "year"} current={view.kind === "year" ? "page" : undefined} />
        </Stack>
        {/* The layout, for a month (§137): the grid, or the list a phone used to get by default.
            A rule between the two groups (§175; the owner: "I need a separator here"): "month
            or year" and "grid or list" are two questions, and four pills in a row read as one
            set of four answers. The two pairs share a row on a phone too now (§NNN), so the rule
            stays on every width. */}
        {view.kind === "month" && (
          <Box aria-hidden="true" sx={{ width: "1px", alignSelf: "stretch", minHeight: 20, bgcolor: "divider", mx: 0.5 }} />
        )}
        {view.kind === "month" && (
          <Stack direction="row" spacing={0.5} role="group" aria-label={`${t("calendar.layoutGrid")} / ${t("calendar.layoutList")}`}>
            <ChipLink href={href({}, "view")} label={t("calendar.layoutGrid")} active={layout === "grid"} current={layout === "grid" ? "page" : undefined} />
            <ChipLink href={href({ view: "list" })} label={t("calendar.layoutList")} active={layout === "list"} current={layout === "list" ? "page" : undefined} />
          </Stack>
        )}
        </Box>
      </Stack>
    </Stack>
  );
}
