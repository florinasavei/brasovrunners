import ChevronLeftIcon from "@mui/icons-material/ChevronLeft";
import ChevronRightIcon from "@mui/icons-material/ChevronRight";
import Box from "@mui/material/Box";
import Chip from "@mui/material/Chip";
import IconButton from "@mui/material/IconButton";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { getFormatter, getLocale, getTranslations } from "next-intl/server";
import type { ReactNode } from "react";
import { getPathname, Link } from "@/i18n/navigation";
import { CLUB_TIME_ZONE } from "@/modules/jobs/quiet-hours";
import {
  type CalendarDay,
  dayKey,
  groupByDay,
  groupByMonth,
  monthGrid,
  monthParam,
  shiftMonth,
  type YearMonth,
  yearsAround,
} from "../domain/calendar";
import type { PublicEvent } from "../repository";
import CalendarPicker from "./CalendarPicker";
import { TYPE_GLYPH } from "./glyphs";

/** What the calendar shows: one month (`?month=`) or one year (`?year=`, §116). */
export type CalendarView = { kind: "month"; month: YearMonth } | { kind: "year"; year: number };

/**
 * The month, as a grid from `sm` up and as an agenda on a phone (`DECISIONS.md` §89) — or
 * the year, as the agenda of every month that has something on it (§116).
 *
 * Server-rendered and navigated by links — `?month=2026-10`, `?year=2027` — so the whole
 * thing is HTML and a crawler reads next month's runs; the two selects (`CalendarPicker`) are
 * the one island, and they only go where a link could. A seven-column grid at 320px has 40px
 * a column, which fits a day number and a dot and nothing a reader could tap; there the same
 * month is a list of days, which is what a phone calendar shows in "schedule" view anyway.
 *
 * Each event is one link with its type's glyph (§112). A race is filled in the brand colour,
 * everything else is quiet: the race is what the page advertises, the Monday run is what
 * regulars already know.
 */
export default async function EventCalendar({
  view,
  events,
  now,
  query = {},
}: {
  view: CalendarView;
  events: PublicEvent[];
  now: Date;
  /** Other query parameters the month links keep — the type filter (§89). */
  query?: Record<string, string>;
}) {
  const t = await getTranslations("Events");
  const tEvent = await getTranslations("Event");
  const format = await getFormatter();
  const locale = (await getLocale()) as "ro" | "en";

  const today = dayKey(now, CLUB_TIME_ZONE);
  const month: YearMonth = view.kind === "month" ? view.month : { year: view.year, month: 1 };
  const anchor = new Date(Date.UTC(month.year, month.month - 1, 1, 12));
  const title =
    view.kind === "month"
      ? format.dateTime(anchor, { timeZone: "UTC", month: "long", year: "numeric" })
      : String(view.year);
  const basePath = getPathname({ locale, href: "/events" });
  const href = (params: Record<string, string>) => getPathname({ locale, href: { pathname: "/events", query: { ...query, ...params } } });
  const previousHref = view.kind === "month" ? href({ month: monthParam(shiftMonth(view.month, -1)) }) : href({ year: String(view.year - 1) });
  const nextHref = view.kind === "month" ? href({ month: monthParam(shiftMonth(view.month, 1)) }) : href({ year: String(view.year + 1) });

  const time = (event: PublicEvent) =>
    format.dateTime(event.startsAt, { timeZone: event.timezone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" });

  // Monday first, named in the reader's language from any Monday; the months from any year.
  const weekdayNames = Array.from({ length: 7 }, (_, i) =>
    format.dateTime(new Date(Date.UTC(2024, 0, 1 + i, 12)), { timeZone: "UTC", weekday: "short" }),
  );
  const monthNames = Array.from({ length: 12 }, (_, i) =>
    format.dateTime(new Date(Date.UTC(2024, i, 1, 12)), { timeZone: "UTC", month: "long" }),
  );

  const eventLink = (event: PublicEvent, dense: boolean) => {
    const Glyph = TYPE_GLYPH[event.type];
    return (
      <Link
        key={event.id}
        href={{ pathname: "/events/[slug]", params: { slug: event.slug } }}
        style={{ textDecoration: "none", color: "inherit", display: "block" }}
      >
        <Box
          sx={{
            // 44px tall wherever it is (BR-REQ-041-01 criterion 6): a chip in a cell is still a tap target.
            minHeight: 44,
            display: "flex",
            alignItems: "center",
            gap: 0.5,
            px: 0.75,
            py: 0.25,
            borderRadius: 1,
            fontSize: dense ? "0.75rem" : "0.9375rem",
            lineHeight: 1.3,
            overflow: "hidden",
            bgcolor: event.type === "RACE" ? "primary.main" : "action.selected",
            color: event.type === "RACE" ? "primary.contrastText" : "text.primary",
            textDecoration: event.eventStatus === "CANCELLED" ? "line-through" : "none",
            "&:hover": { filter: "brightness(0.95)" },
          }}
          title={`${time(event)} ${event.title}`}
        >
          {/* The type's glyph (§112): a run, a flag, a hiker, a cup, a group — read at a glance. */}
          <Glyph aria-hidden="true" sx={{ fontSize: dense ? 14 : 18, flexShrink: 0 }} />
          <Box component="span" sx={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: dense ? "nowrap" : "normal" }}>
            <Box component="span" sx={{ fontWeight: 600, mr: 0.5 }}>
              {time(event)}
            </Box>
            {event.title}
            {event.eventStatus === "CANCELLED" && ` · ${tEvent("cancelled")}`}
          </Box>
        </Box>
      </Link>
    );
  };

  // A string href, because a component reference cannot cross into MUI's client component.
  const stepLink = (target: string, label: string, icon: ReactNode) => (
    <IconButton component="a" href={target} aria-label={label} sx={{ minHeight: 44, minWidth: 44 }}>
      {icon}
    </IconButton>
  );

  /** The agenda of some days: the weekday and the number, then the day's events; `dense` in a month box. */
  const agenda = (days: CalendarDay[], byDay: Map<string, PublicEvent[]>, dense = false) => (
    <Stack component="ol" spacing={dense ? 1 : 1.5} sx={{ listStyle: "none", p: 0, m: 0 }}>
      {days.map((day) => {
        const items = byDay.get(day.key) ?? [];
        const isToday = day.key === today;
        const date = new Date(`${day.key}T12:00:00Z`);
        return (
          <Box component="li" key={day.key} sx={{ display: "grid", gridTemplateColumns: "56px 1fr", columnGap: 1 }}>
            <Box sx={{ textAlign: "center", color: isToday ? "primary.main" : "text.secondary" }}>
              <Typography variant="caption" sx={{ display: "block", textTransform: "uppercase", lineHeight: 1 }}>
                {format.dateTime(date, { timeZone: "UTC", weekday: "short" })}
              </Typography>
              <Typography variant="h6" component="span" sx={{ fontWeight: isToday ? 700 : 500, lineHeight: 1.2 }}>
                {day.day}
              </Typography>
            </Box>
            <Stack spacing={0.5}>{items.map((event) => eventLink(event, dense))}</Stack>
          </Box>
        );
      })}
    </Stack>
  );

  const header = (
    <Stack direction="row" sx={{ alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 1, mb: 1.5 }}>
      <Typography id="calendar-title" component="h2" variant="h2" sx={{ fontSize: "1.25rem", textTransform: "capitalize" }}>
        {title}
      </Typography>
      <Stack direction="row" sx={{ alignItems: "center", flexWrap: "wrap", gap: 1 }}>
        {/* Month or year, by select (§116) — the arrows step one at a time, "today" resets. */}
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
        <Stack direction="row" spacing={0.5} sx={{ alignItems: "center" }}>
          {stepLink(previousHref, view.kind === "month" ? t("calendar.previous") : t("calendar.previousYear"), <ChevronLeftIcon />)}
          <Link href={{ pathname: "/events", query }} style={{ fontSize: "0.875rem", minHeight: 44, display: "inline-flex", alignItems: "center" }}>
            {t("calendar.today")}
          </Link>
          {stepLink(nextHref, view.kind === "month" ? t("calendar.next") : t("calendar.nextYear"), <ChevronRightIcon />)}
        </Stack>
        {/* The view: one month, or the whole year. String hrefs, like the filter chips. */}
        <Stack direction="row" spacing={0.5} role="group" aria-label={`${t("calendar.viewMonth")} / ${t("calendar.viewYear")}`}>
          <Chip
            component="a"
            href={href({ month: monthParam(month) })}
            clickable
            label={t("calendar.viewMonth")}
            color={view.kind === "month" ? "primary" : "default"}
            variant={view.kind === "month" ? "filled" : "outlined"}
            sx={{ height: 44, borderRadius: 22 }}
          />
          <Chip
            component="a"
            href={href({ year: String(month.year) })}
            clickable
            label={t("calendar.viewYear")}
            color={view.kind === "year" ? "primary" : "default"}
            variant={view.kind === "year" ? "filled" : "outlined"}
            sx={{ height: 44, borderRadius: 22 }}
          />
        </Stack>
      </Stack>
    </Stack>
  );

  if (view.kind === "year") {
    const byMonth = groupByMonth(events);
    const months = Array.from({ length: 12 }, (_, i) => ({ year: view.year, month: i + 1 })).filter((ym) => byMonth.has(monthParam(ym)));
    return (
      <Box component="section" aria-labelledby="calendar-title" id="calendar">
        {header}
        {months.length === 0 ? (
          <Typography variant="body2" color="text.secondary">
            {t("calendar.yearEmpty")}
          </Typography>
        ) : (
          /* One box per month (the owner: "the year calendar is not boxed enough"): a card
             each, in columns from `sm` up, so a year reads as a shelf of months rather than
             one long list; on a phone the boxes stack. */
          <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", sm: "repeat(2, minmax(0, 1fr))", lg: "repeat(3, minmax(0, 1fr))" }, gap: 2, alignItems: "start" }}>
            {months.map((ym) => {
              const items = byMonth.get(monthParam(ym)) ?? [];
              const byDay = groupByDay(items);
              const days = monthGrid(ym).flat().filter((day) => day.inMonth && byDay.has(day.key));
              return (
                <Box
                  key={monthParam(ym)}
                  component="section"
                  aria-label={monthNames[ym.month - 1]}
                  sx={{ border: 1, borderColor: "divider", borderRadius: 1, overflow: "hidden", bgcolor: "background.paper" }}
                >
                  <Stack direction="row" spacing={1} sx={{ alignItems: "center", px: 1.5, bgcolor: "action.hover", borderBottom: 1, borderColor: "divider" }}>
                    <Typography component="h3" variant="h3" sx={{ fontSize: "1rem", fontWeight: 600, textTransform: "capitalize" }}>
                      <Link href={{ pathname: "/events", query: { ...query, month: monthParam(ym) } }} style={{ color: "inherit", textDecoration: "none", minHeight: 44, display: "inline-flex", alignItems: "center" }}>
                        {monthNames[ym.month - 1]}
                      </Link>
                    </Typography>
                    <Typography variant="body2" color="text.secondary">
                      · {items.length}
                    </Typography>
                  </Stack>
                  <Box sx={{ p: 1.5 }}>{agenda(days, byDay, true)}</Box>
                </Box>
              );
            })}
          </Box>
        )}
      </Box>
    );
  }

  const weeks = monthGrid(view.month);
  const byDay = groupByDay(events);
  // The agenda: the month's days that have something on them, in order.
  const agendaDays = weeks.flat().filter((day) => day.inMonth && byDay.has(day.key));

  return (
    <Box component="section" aria-labelledby="calendar-title" id="calendar">
      {header}

      {/* The grid, from `sm` up. */}
      <Box
        role="table"
        aria-label={title}
        sx={{
          display: { xs: "none", sm: "grid" },
          gridTemplateColumns: "repeat(7, minmax(0, 1fr))",
          border: 1,
          borderColor: "divider",
          borderRadius: 1,
          overflow: "hidden",
        }}
      >
        {weekdayNames.map((name) => (
          <Box
            key={name}
            role="columnheader"
            sx={{ px: 1, py: 0.75, fontSize: "0.75rem", fontWeight: 600, textTransform: "uppercase", color: "text.secondary", bgcolor: "action.hover", borderBottom: 1, borderColor: "divider" }}
          >
            {name}
          </Box>
        ))}
        {weeks.map((week) =>
          week.map((day) => {
            const items = byDay.get(day.key) ?? [];
            const isToday = day.key === today;
            return (
              <Box
                key={day.key}
                role="cell"
                sx={{
                  minHeight: 80,
                  p: 0.5,
                  borderBottom: 1,
                  borderRight: 1,
                  borderColor: "divider",
                  bgcolor: day.inMonth ? "background.paper" : "action.hover",
                  opacity: day.inMonth ? 1 : 0.6,
                  "&:nth-of-type(7n)": { borderRight: 0 },
                }}
              >
                <Box
                  component="span"
                  sx={{
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    width: 26,
                    height: 26,
                    mb: 0.5,
                    borderRadius: "50%",
                    fontSize: "0.8125rem",
                    fontWeight: isToday ? 700 : 400,
                    bgcolor: isToday ? "primary.main" : "transparent",
                    color: isToday ? "primary.contrastText" : "text.secondary",
                  }}
                  aria-current={isToday ? "date" : undefined}
                >
                  {day.day}
                </Box>
                <Stack spacing={0.25}>{items.map((event) => eventLink(event, true))}</Stack>
              </Box>
            );
          }),
        )}
      </Box>

      {/* The agenda, on a phone. */}
      <Box sx={{ display: { xs: "block", sm: "none" } }}>
        {agendaDays.length === 0 ? (
          <Typography variant="body2" color="text.secondary">
            {t("calendar.empty")}
          </Typography>
        ) : (
          agenda(agendaDays, byDay)
        )}
      </Box>
    </Box>
  );
}
