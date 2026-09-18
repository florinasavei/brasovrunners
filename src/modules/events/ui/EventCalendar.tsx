import ChevronLeftIcon from "@mui/icons-material/ChevronLeft";
import ChevronRightIcon from "@mui/icons-material/ChevronRight";
import Box from "@mui/material/Box";
import IconButton from "@mui/material/IconButton";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { getFormatter, getLocale, getTranslations } from "next-intl/server";
import type { ReactNode } from "react";
import { getPathname, Link } from "@/i18n/navigation";
import { CLUB_TIME_ZONE } from "@/modules/jobs/quiet-hours";
import { dayKey, groupByDay, monthGrid, monthParam, shiftMonth, type YearMonth } from "../domain/calendar";
import type { PublicEvent } from "../repository";

/**
 * The month, as a grid from `sm` up and as an agenda on a phone (`DECISIONS.md` §89).
 *
 * Server-rendered and navigated by links — `?month=2026-10` — so the whole thing is HTML
 * and a crawler reads next month's runs. A seven-column grid at 320px has 40px a column,
 * which fits a day number and a dot and nothing a reader could tap; there the same month is a
 * list of days, which is what a phone calendar shows in "schedule" view anyway.
 *
 * Each event is one link. A race is filled in the brand colour, everything else is quiet:
 * the race is what the page advertises, the Monday run is what regulars already know.
 */
export default async function EventCalendar({
  month,
  events,
  now,
  query = {},
}: {
  month: YearMonth;
  events: PublicEvent[];
  now: Date;
  /** Other query parameters the month links keep — the type filter (§89). */
  query?: Record<string, string>;
}) {
  const t = await getTranslations("Events");
  const tEvent = await getTranslations("Event");
  const format = await getFormatter();
  const locale = (await getLocale()) as "ro" | "en";

  const weeks = monthGrid(month);
  const byDay = groupByDay(events);
  const today = dayKey(now, CLUB_TIME_ZONE);
  const anchor = new Date(Date.UTC(month.year, month.month - 1, 1, 12));
  const title = format.dateTime(anchor, { timeZone: "UTC", month: "long", year: "numeric" });
  const previous = shiftMonth(month, -1);
  const next = shiftMonth(month, 1);

  const time = (event: PublicEvent) =>
    format.dateTime(event.startsAt, { timeZone: event.timezone, hour: "2-digit", minute: "2-digit" });

  // Monday first, named in the reader's language from any Monday.
  const weekdayNames = Array.from({ length: 7 }, (_, i) =>
    format.dateTime(new Date(Date.UTC(2024, 0, 1 + i, 12)), { timeZone: "UTC", weekday: "short" }),
  );

  const eventLink = (event: PublicEvent, dense: boolean) => (
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

  // A string href, because a component reference cannot cross into MUI's client component.
  const monthLink = (target: YearMonth, label: string, icon: ReactNode) => (
    <IconButton
      component="a"
      href={getPathname({ locale, href: { pathname: "/events", query: { ...query, month: monthParam(target) } } })}
      aria-label={label}
      sx={{ minHeight: 44, minWidth: 44 }}
    >
      {icon}
    </IconButton>
  );

  // The agenda: the month's days that have something on them, in order.
  const agendaDays = weeks
    .flat()
    .filter((day) => day.inMonth && byDay.has(day.key));

  return (
    <Box component="section" aria-labelledby="calendar-title" id="calendar">
      <Stack direction="row" spacing={1} sx={{ alignItems: "center", justifyContent: "space-between", mb: 1.5 }}>
        <Typography id="calendar-title" component="h2" variant="h2" sx={{ fontSize: "1.25rem", textTransform: "capitalize" }}>
          {title}
        </Typography>
        <Stack direction="row" spacing={0.5} sx={{ alignItems: "center" }}>
          {monthLink(previous, t("calendar.previous"), <ChevronLeftIcon />)}
          <Link href={{ pathname: "/events", query }} style={{ fontSize: "0.875rem", minHeight: 44, display: "inline-flex", alignItems: "center" }}>
            {t("calendar.today")}
          </Link>
          {monthLink(next, t("calendar.next"), <ChevronRightIcon />)}
        </Stack>
      </Stack>

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
          <Stack component="ol" spacing={1.5} sx={{ listStyle: "none", p: 0, m: 0 }}>
            {agendaDays.map((day) => {
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
                  <Stack spacing={0.5}>{items.map((event) => eventLink(event, false))}</Stack>
                </Box>
              );
            })}
          </Stack>
        )}
      </Box>
    </Box>
  );
}
