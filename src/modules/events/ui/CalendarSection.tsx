import CalendarMonthIcon from "@mui/icons-material/CalendarMonth";
import DownloadIcon from "@mui/icons-material/Download";
import EventAvailableIcon from "@mui/icons-material/EventAvailable";
import RssFeedIcon from "@mui/icons-material/RssFeed";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { getTranslations } from "next-intl/server";
import type { Locale } from "@/i18n/routing";
import type { PublicEvent } from "@/modules/events/repository";
import CalendarHeader, { calendarStepHrefs } from "@/modules/events/ui/CalendarHeader";
import CalendarAddress from "@/modules/events/ui/CalendarAddress";
import CalendarLegend, { calendarLegendWords } from "@/modules/events/ui/CalendarLegend";
import CalendarIntroFold, { calendarFeedLinks, feedAddressHints } from "@/modules/events/ui/CalendarIntroFold";
import CalendarSwipe from "@/modules/events/ui/CalendarSwipe";
import EventCalendar, { type CalendarLayout, type CalendarView } from "@/modules/events/ui/EventCalendar";
import InfoTip from "@/shared/ui/InfoTip";
import { DISCLOSURE_SUMMARY_SX, DISCLOSURE_SX, FOLD_GLYPH_SX } from "@/shared/ui/disclosure";
import { env } from "@/shared/config/env";
import { DENSITY } from "@/theme/density";
import { OFF_UNDER_LOOK, UNDER_LOOK } from "@/theme/look";

/**
 * The club's month, and the three doors into a reader's own calendar (`DECISIONS.md` §107,
 * §116, §139, §166) — extracted from the listing page in §251, where it had lived since it was
 * written, because the owner asked for it to be a section of its own: "the calendar should be a
 * tab, after events, and not show on the homepage".
 *
 * The month is drawn from rows the page already holds (§413, amending §166 here): no streamed
 * boundary between the controls and the grid, because a streamed region is revealed by a script and
 * the calendar has to read with scripts off — the filter panel above it is a GET form. With a
 * script, a month change is a soft navigation that keeps this month on screen until the next one is
 * ready, where §166 had shown a skeleton in its place.
 */
const CALENDAR_BUTTON_SX = {
  minHeight: { xs: 44, sm: 32 },
  gap: 0.5,
  px: { xs: 1.5, sm: 1.25 },
  fontSize: { sm: "0.78rem" },
} as const;

/** The month's card under the look, from `sm`: paper, a 16-pixel radius, the grid inset by its padding. */
const MONTH_CARD_SX = {
  [UNDER_LOOK]: {
    p: { sm: 2 },
    border: { sm: 1 },
    borderColor: { sm: "divider" },
    borderRadius: { sm: "16px" },
    bgcolor: { sm: "background.paper" },
    // The grid inside: its own edge quieter, its radius the card's less the padding.
    "& [role='table']": { borderRadius: { sm: "12px" } },
  },
} as const;

export default async function CalendarSection({
  locale,
  view,
  layout,
  query,
  now,
  events,
  lookOn = false,
}: {
  locale: Locale;
  view: CalendarView;
  layout: CalendarLayout;
  /** What the period's own links keep — the filters (a group ticked twice is an array); the period and the layout are the path's (§574). */
  query: Record<string, string | string[]>;
  now: Date;
  /** The period's rows, already read and narrowed by the page (§413). */
  events: PublicEvent[];
  /**
   * «Tema v2» is on (§NNN): the «?» help stands here, at the end of a row of its own under the
   * controls, instead of in the page's head, and the dates on days gone are faded. Off, neither:
   * the page draws the head's fold on a phone, and nothing is marked.
   */
  lookOn?: boolean;
}) {
  const t = await getTranslations("Events");
  // The same two doors the page head's «?» carries on a phone (§487), built in one place.
  const links = calendarFeedLinks(env.APP_BASE_URL, locale);
  const steps = calendarStepHrefs({ view, layout, query, locale, now });

  return (
    // Under «Aspectul nou» a phone gives this gap and the filter slot's back to the first week, under the chips row (phase 4, §569).
    <Box sx={{ mt: { xs: DENSITY.gapSm, sm: 2 }, mb: { xs: DENSITY.sectionGapLg, sm: 4 }, [UNDER_LOOK]: { mt: { xs: 0, sm: 2 } } }}>
      <Box component="section" aria-labelledby="calendar-title" id="calendar">
        {/* Under «Aspectul nou», from `sm`, the period's controls and the month are one card (the
            mock-up's): its top meets the next-event card's beside it, and the heading lines up
            with the grid's edges. Off, and on a phone, no card: the controls and the grid as before. */}
        <Box sx={MONTH_CARD_SX} data-testid="calendar-month-card">
          <CalendarHeader view={view} now={now} query={query} layout={layout} />
          {/* Under «Tema v2» the «?» (§487, §NNN): just under the controls, at the row's end, its
              panel opening from here over the month. The page's head carries it off the look, on a
              phone only; never both. A native fold, so it opens with scripts off. */}
          {lookOn && (
            <Box data-testid="calendar-help-row" sx={{ position: "relative", display: "flex", justifyContent: "flex-end" }}>
              <CalendarIntroFold locale={locale} baseUrl={env.APP_BASE_URL} />
            </Box>
          )}
          {/* A sideways swipe on a touch screen goes where the arrows go (§475). */}
          <CalendarSwipe previousHref={steps.previous} nextHref={steps.next}>
            <EventCalendar view={view} events={events} now={now} query={query} layout={layout} fadePast={lookOn} />
          </CalendarSwipe>
        </Box>
        {/* What the three colours mean, under «Aspectul nou» only (phase 4): a word beside every colour. */}
        <CalendarLegend {...calendarLegendWords(t)} />
      </Box>

      {/* "Add to your calendar" (§107, §139): three doors (the owner: "this subscription to
          calendar does not work" — a `webcal://` link does nothing where no app claims the
          scheme, which on a desktop is most browsers): Google Calendar's own "add by URL"
          address, `webcal://` for Apple and Outlook (not «telefon» any more: on Android no app claims
          the scheme, and the hint under the address says to use calendar.google.com), the file itself; the plain
          address folded away, to copy (§674), and the "when does it update" behind an "i"
          (the feed is fresh on every read, §129; when the phone shows a change is the app's
          clock, and the owner asked why Google still showed the old hour). */}
      {/* Under «Aspectul nou» the subscribe box in the second column says all of it (`SubscribeBox`, phase 4). */}
      <Box component="section" aria-labelledby="add-to-calendar" sx={{ mt: 2, p: 1.5, border: 1, borderColor: "divider", borderRadius: 2, ...OFF_UNDER_LOOK }}>
        <Stack direction="row" sx={{ alignItems: "center", flexWrap: "wrap", gap: 1 }}>
          <Typography id="add-to-calendar" component="h3" variant="body2" sx={{ fontWeight: 600, mr: 0.5 }}>
            {t("calendar.addTitle")}
          </Typography>
          <Button
            component="a"
            href={links.google}
            target="_blank"
            rel="noopener noreferrer"
            size="small"
            variant="outlined"
            sx={CALENDAR_BUTTON_SX}
          >
            <EventAvailableIcon sx={{ fontSize: 18 }} aria-hidden="true" />
            {t("calendar.subscribeGoogle")}
          </Button>
          <Button component="a" href={links.webcal} size="small" variant="outlined" sx={CALENDAR_BUTTON_SX}>
            <CalendarMonthIcon sx={{ fontSize: 18 }} aria-hidden="true" />
            {t("calendar.subscribeApple")}
          </Button>
          <Button component="a" href={`/${locale}/events/calendar.ics`} size="small" variant="outlined" sx={CALENDAR_BUTTON_SX}>
            <DownloadIcon sx={{ fontSize: 18 }} aria-hidden="true" />
            {t("calendar.downloadLink")}
          </Button>
          <InfoTip text={t("calendar.refreshNote")} />
        </Stack>
        {/* The two ways, said in the open (§674; the owner: «we need to write that on the website so people know how to use them»). */}
        <Typography variant="body2" color="text.secondary" sx={{ mt: 0.75 }} data-testid="calendar-two-ways">
          {t("calendar.twoWays")}
        </Typography>
        {/* A fold looks like a fold (§164): the marker back, the pointer, an underline on
            hover and on focus. It had been a flex box, which removes the triangle in
            Chrome and Safari — the owner: "it's not clear that this is expandable". */}
        <Box component="details" sx={{ mt: 0.5, ...DISCLOSURE_SX, "& > summary": { ...DISCLOSURE_SUMMARY_SX, fontSize: "0.8125rem", color: "text.secondary" } }}>
          <summary>
            <RssFeedIcon aria-hidden sx={FOLD_GLYPH_SX} />
            {t("calendar.feedAddress")}
          </summary>
          {/*
            The address to copy (§674, amending §195). §195 made it a `webcal://` link, to press
            as well as to copy; the «Apple / Outlook / telefon» button above is that link, so the
            fold now holds the plain `https://` address in a read-only box with «Copiază» — what
            Google Calendar's «Din URL» wants pasted when its quick-add button does nothing (a
            calendar hidden or removed before is kept by its address) — and the three sentences
            that say so.
          */}
          <CalendarAddress
            id="calendar-feed-address"
            address={links.feed}
            label={t("calendar.addressLabel")}
            copyLabel={t("calendar.copy")}
            copiedLabel={t("calendar.copied")}
            hints={feedAddressHints(t)}
          />
        </Box>
      </Box>
    </Box>
  );
}
