import CalendarMonthIcon from "@mui/icons-material/CalendarMonth";
import DownloadIcon from "@mui/icons-material/Download";
import EventAvailableIcon from "@mui/icons-material/EventAvailable";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";
import type { Locale } from "@/i18n/routing";
import { calendarBoundaryKey } from "@/modules/events/domain/listing";
import { monthGrid } from "@/modules/events/domain/calendar";
import type { EventType } from "@/modules/events/domain/event-type";
import { webcalUrl } from "@/modules/events/ical";
import type { PublicEvent } from "@/modules/events/repository";
import CalendarHeader from "@/modules/events/ui/CalendarHeader";
import EventCalendar, { type CalendarLayout, type CalendarView } from "@/modules/events/ui/EventCalendar";
import { CalendarBodySkeleton } from "@/shared/ui/PublicSkeleton";
import InfoTip from "@/shared/ui/InfoTip";
import { DISCLOSURE_SUMMARY_SX, DISCLOSURE_SX } from "@/shared/ui/disclosure";
import { env } from "@/shared/config/env";

/**
 * The club's month, and the three doors into a reader's own calendar (`DECISIONS.md` §107,
 * §116, §139, §166) — extracted from the listing page in §251, where it had lived since it was
 * written, because the owner asked for it to be a section of its own: "the calendar should be a
 * tab, after events, and not show on the homepage".
 *
 * Nothing about it changed in the move. The controls still render with the shell and stay
 * pressable while the grid streams beneath them (§166): `CalendarHeader` reads the address and
 * never the database, and the `key` on the boundary is what asks for the skeleton — React keeps
 * the content of a boundary that updates and shows the fallback for one that is new, so the key
 * names exactly what the query depends on and nothing else.
 */
const CALENDAR_BUTTON_SX = {
  minHeight: { xs: 44, sm: 32 },
  gap: 0.5,
  px: { xs: 1.5, sm: 1.25 },
  fontSize: { sm: "0.78rem" },
} as const;

export default async function CalendarSection({
  locale,
  view,
  layout,
  type,
  query,
  now,
  events,
}: {
  locale: Locale;
  view: CalendarView;
  layout: CalendarLayout;
  /** The type filter the address carries, so the month's own links keep it. */
  type?: EventType;
  query: Record<string, string>;
  now: Date;
  /** Started by the page and awaited inside the boundary below, never in the page body (§166). */
  events: Promise<PublicEvent[]>;
}) {
  const t = await getTranslations("Events");
  const feed = `${env.APP_BASE_URL}/${locale}/events/calendar.ics`;

  return (
    <Box sx={{ mt: 2, mb: 4 }}>
      <Box component="section" aria-labelledby="calendar-title" id="calendar">
        <CalendarHeader view={view} now={now} query={query} layout={layout} />
        <Suspense
          key={calendarBoundaryKey(view, layout, type)}
          fallback={
            <CalendarBodySkeleton
              label={t("loading")}
              kind={view.kind}
              layout={layout}
              // As many week rows as the month actually spans, four to six (§167): pure
              // arithmetic on the address, so the skeleton is the grid's exact height and
              // the swap moves nothing under it.
              weeks={view.kind === "month" ? monthGrid(view.month).length : 6}
            />
          }
        >
          <EventCalendar view={view} events={events} now={now} query={query} layout={layout} />
        </Suspense>
      </Box>

      {/* "Add to your calendar" (§107, §139): three doors (the owner: "this subscription to
          calendar does not work" — a `webcal://` link does nothing where no app claims the
          scheme, which on a desktop is most browsers): Google Calendar's own "add by URL"
          address, `webcal://` for Apple, Outlook and phones, the file itself; the plain
          address folded away for any other app, and the "when does it update" behind an "i"
          (the feed is fresh on every read, §129; when the phone shows a change is the app's
          clock, and the owner asked why Google still showed the old hour). */}
      <Box component="section" aria-labelledby="add-to-calendar" sx={{ mt: 2, p: 1.5, border: 1, borderColor: "divider", borderRadius: 2 }}>
        <Stack direction="row" sx={{ alignItems: "center", flexWrap: "wrap", gap: 1 }}>
          <Typography id="add-to-calendar" component="h3" variant="body2" sx={{ fontWeight: 600, mr: 0.5 }}>
            {t("calendar.addTitle")}
          </Typography>
          <Button
            component="a"
            href={`https://calendar.google.com/calendar/r?cid=${encodeURIComponent(webcalUrl(feed))}`}
            target="_blank"
            rel="noopener noreferrer"
            size="small"
            variant="outlined"
            sx={CALENDAR_BUTTON_SX}
          >
            <EventAvailableIcon sx={{ fontSize: 18 }} aria-hidden="true" />
            {t("calendar.subscribeGoogle")}
          </Button>
          <Button component="a" href={webcalUrl(feed)} size="small" variant="outlined" sx={CALENDAR_BUTTON_SX}>
            <CalendarMonthIcon sx={{ fontSize: 18 }} aria-hidden="true" />
            {t("calendar.subscribeApple")}
          </Button>
          <Button component="a" href={`/${locale}/events/calendar.ics`} size="small" variant="outlined" sx={CALENDAR_BUTTON_SX}>
            <DownloadIcon sx={{ fontSize: 18 }} aria-hidden="true" />
            {t("calendar.downloadLink")}
          </Button>
          <InfoTip text={t("calendar.refreshNote")} />
        </Stack>
        {/* A fold looks like a fold (§164): the marker back, the pointer, an underline on
            hover and on focus. It had been a flex box, which removes the triangle in
            Chrome and Safari — the owner: "it's not clear that this is expandable". */}
        <Box component="details" sx={{ mt: 0.5, ...DISCLOSURE_SX, "& > summary": { ...DISCLOSURE_SUMMARY_SX, fontSize: "0.8125rem", color: "text.secondary" } }}>
          <summary>{t("calendar.feedAddress")}</summary>
          {/*
            A link, not only a string to copy (§195; the owner, of the address: "ăsta trebuia
            să fie link"). It is still selected whole by one click — `userSelect: all` — for
            the calendar apps that want it pasted, and it is now also pressable for the ones
            that subscribe from the browser. `webcal://` rather than `https://` on the anchor:
            the same address handed to the operating system as a subscription rather than as a
            file to download once, which is the difference between a calendar that updates and
            a snapshot of today.
          */}
          <Box
            component="a"
            href={webcalUrl(feed)}
            sx={{
              display: "inline-block",
              fontFamily: "monospace",
              fontSize: "0.8125rem",
              userSelect: "all",
              wordBreak: "break-all",
              minHeight: 44,
            }}
          >
            {feed}
          </Box>
        </Box>
      </Box>
    </Box>
  );
}
