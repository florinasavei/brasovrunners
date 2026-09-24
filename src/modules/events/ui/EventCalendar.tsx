import Box from "@mui/material/Box";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { getFormatter, getLocale, getTranslations } from "next-intl/server";
import { CLUB_TIME_ZONE, formatTime } from "@/i18n/dates";
import { getPathname, Link } from "@/i18n/navigation";
import { fadeInSoft } from "@/theme/motion";
import {
  type CalendarDay,
  dayKey,
  groupByDay,
  groupByMonth,
  monthGrid,
  monthParam,
  type YearMonth,
} from "../domain/calendar";
import type { PublicEvent } from "../repository";
import { editionDifference, groupSeries, usualOf } from "../domain/series";
import CalendarEventChip from "./CalendarEventChip";
import type { EditionNote } from "./EditionMark";
import { readCoHosts } from "../domain/co-hosts";
import { partnerPhrase } from "./counted-phrases";
import type { GlyphName } from "./glyphs";
import { editionNote } from "./series-sentence";

/** What the calendar shows: one month (`?month=`) or one year (`?year=`, §116). */
export type CalendarView = { kind: "month"; month: YearMonth } | { kind: "year"; year: number };

/** How the month is laid out (§137): the grid, on every width, or the agenda by choice (`?view=list`). */
export type CalendarLayout = "grid" | "list";

/**
 * The calendar's **body**: the month as a grid on every width — or as an agenda when the
 * reader asks (`?view=list`; `DECISIONS.md` §89, §137) — or the year, as the agenda of every
 * month that has something on it (§116).
 *
 * The controls that change the period are `CalendarHeader`, and the split is deliberate
 * (§166): this is the half that costs a query, so this is the half the listing wraps in a
 * `<Suspense>` boundary. `events` therefore arrives as a **promise** — the page starts the
 * query and hands it over without awaiting, so the rest of the page can be sent to the
 * browser while the database is still answering, and this region shows a skeleton of its own
 * exact size until it is not.
 *
 * Server-rendered and navigated by links, so the whole thing is HTML and a crawler reads next
 * month's runs; the event chips (`CalendarEventChip`, for the tooltip) are the only island
 * here, and they only go where a link could. A seven-column grid at 320px has 40px a column:
 * there a chip is its glyphs over the time, and the title is the tooltip's and the page's.
 *
 * Each event is one link with its type's glyph and its surface's (§112). A race is filled in
 * the brand colour, everything else is quiet: the race is what the page advertises, the
 * Monday run is what regulars already know. An event held with a partner wears the handshake
 * at its end (§367), the partner named in the entry's tooltip and accessible name.
 */
export default async function EventCalendar({
  view,
  events,
  now,
  query = {},
  layout = "grid",
  pathname = "/calendar",
}: {
  view: CalendarView;
  /** The page the calendar is on (§251): a day links back to it, never to the listing. */
  pathname?: "/calendar" | "/events";
  /** Awaited here, so the boundary above suspends on the query rather than the page doing it. */
  events: PublicEvent[] | Promise<PublicEvent[]>;
  now: Date;
  /** Other query parameters the month links keep — the type filter (§89), the layout (§137). */
  query?: Record<string, string>;
  layout?: CalendarLayout;
}) {
  const t = await getTranslations("Events");
  const tEvent = await getTranslations("Event");
  const format = await getFormatter();
  const locale = (await getLocale()) as "ro" | "en";
  const rows = await events;

  const today = dayKey(now, CLUB_TIME_ZONE);

  // The grid and the agenda already say the day: the weekday is the column's header (or the
  // label over the day's number), the month and the year the heading — so a cell carries the
  // time alone, and is the one place a date goes without its year (§349).
  const time = (event: PublicEvent) => formatTime(event.startsAt, { locale, timeZone: event.timezone });

  // A date unlike its series' others (§122) — read against the dates on view, which is the
  // series as the reader sees it here; a lone cancelled event is marked too.
  const notes = new Map<string, EditionNote>();
  for (const series of groupSeries(rows)) {
    const usual = series.members.length > 1 ? usualOf(series.members) : { place: null, time: null };
    for (const member of series.members) {
      const note = await editionNote(editionDifference(member, usual));
      if (note) notes.set(member.id, note);
    }
  }

  // Monday first, named in the reader's language from any Monday; the months from any year.
  const weekdayNames = Array.from({ length: 7 }, (_, i) =>
    format.dateTime(new Date(Date.UTC(2024, 0, 1 + i, 12)), { timeZone: "UTC", weekday: "short" }),
  );
  const monthNames = Array.from({ length: 12 }, (_, i) =>
    format.dateTime(new Date(Date.UTC(2024, i, 1, 12)), { timeZone: "UTC", month: "long" }),
  );

  // The chip is a client island (the tooltip); everything crosses as strings and names (§112).
  const eventLink = (event: PublicEvent, dense: boolean) => {
    const glyphs: GlyphName[] = [`type:${event.type}`, ...(event.surface ? [`surface:${event.surface}` as const] : [])];
    return (
      <CalendarEventChip
        key={event.id}
        href={getPathname({ locale, href: { pathname: "/events/[slug]", params: { slug: event.slug } } })}
        time={time(event)}
        title={event.title}
        glyphs={glyphs}
        filled={event.type === "RACE"}
        cancelled={event.eventStatus === "CANCELLED"}
        note={notes.get(event.id) ?? null}
        // Held with a partner (§367): the handshake beside the entry, the words in its tooltip.
        partner={partnerPhrase(tEvent, locale, readCoHosts(event).map((host) => host.name))}
        dense={dense}
      />
    );
  };

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

  if (view.kind === "year") {
    const byMonth = groupByMonth(rows);
    const months = Array.from({ length: 12 }, (_, i) => ({ year: view.year, month: i + 1 })).filter((ym) => byMonth.has(monthParam(ym)));
    return (
      // The streamed swap settles rather than snapping; static for reduced motion (§166).
      <Box sx={fadeInSoft}>
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
                      <Link href={{ pathname, query: { ...query, month: monthParam(ym) } }} style={{ color: "inherit", textDecoration: "none", minHeight: 44, display: "inline-flex", alignItems: "center" }}>
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
  const byDay = groupByDay(rows);
  // The grid's accessible name is the month it shows, the same string the heading above it
  // carries — recomputed here rather than passed down, because it is one `Intl` call and a
  // prop would have tied the streamed body back to the header it was split from.
  const monthTitle = format.dateTime(new Date(Date.UTC(view.month.year, view.month.month - 1, 1, 12)), {
    timeZone: "UTC",
    month: "long",
    year: "numeric",
  });
  // The agenda: the month's days that have something on them, in order.
  const agendaDays = weeks.flat().filter((day) => day.inMonth && byDay.has(day.key));

  return (
    <Box sx={fadeInSoft}>
      {/* The grid, on every width — unless the list was asked for. */}
      {layout === "grid" && (
      <Box
        role="table"
        aria-label={monthTitle}
        sx={{
          display: "grid",
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
                  minHeight: { xs: 56, sm: 80 },
                  p: { xs: 0.25, sm: 0.5 },
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
      )}

      {/* The list, by choice. */}
      {layout === "list" && (
        <Box>
          {agendaDays.length === 0 ? (
            <Typography variant="body2" color="text.secondary">
              {t("calendar.empty")}
            </Typography>
          ) : (
            agenda(agendaDays, byDay)
          )}
        </Box>
      )}
    </Box>
  );
}
