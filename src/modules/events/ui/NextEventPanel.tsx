import PlaceIcon from "@mui/icons-material/Place";
import ScheduleIcon from "@mui/icons-material/Schedule";
import TodayIcon from "@mui/icons-material/Today";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import { getFormatter, getTranslations } from "next-intl/server";
import { countForm } from "@/i18n/count-form";
import { CLUB_TIME_ZONE, formatTime } from "@/i18n/dates";
import type { Locale } from "@/i18n/routing";
import { awayFrom } from "@/modules/events/domain/next-event-away";
import type { PublicEvent } from "@/modules/events/repository";
import type { WeatherReading } from "@/modules/weather/domain/forecast";
import CardWeather from "@/modules/weather/ui/CardWeather";
import ArrowButtonLink from "@/shared/ui/ArrowButtonLink";
import { COLOR, COLOR_DARK } from "@/theme/brand";
import { LOOK_ACCENT_TINT, UNDER_LOOK, UNDER_LOOK_DARK } from "@/theme/look";
import { buildRoutePills } from "./route-pills";
import RoutePills from "./RoutePills";

export type NextEventPanelProps = {
  /** The next date still ahead, from the listing's cached read (`public-cache/reads.ts`), already narrowed by the page's filters. */
  event: PublicEvent;
  locale: Locale;
  /**
   * The page's own clock (§834): the card says how far away the event is from it, in calendar days
   * on the club's wall clock (`CLUB_TIME_ZONE`), deliberately the clock the page rolls at even when the
   * event's own zone differs, so near midnight it may disagree with the day line above it. The calendar
   * page holds itself to the next club midnight (`holdPageUntil`), so the words roll with the page (the
   * visit that triggers the new render may still get the old copy, as for today's square, §549); the
   * design page passes its fixed sample instant.
   */
  now: Date;
  /** The forecast at its start (§402, cached an hour), or null outside the seven days, on a failure, or for an event that shows none. */
  weather: WeatherReading | null;
};

/** A fact's line: its glyph, then the words, as the event page draws its own. */
const FACT_SX = { display: "flex", alignItems: "center", gap: 1, fontSize: "0.9375rem", "& > svg": { fontSize: 20, color: "primary.main", flexShrink: 0 } } as const;

/**
 * «Următorul eveniment» — the calendar's next-event panel under «Aspectul nou» (the facelift's
 * phase 4, `docs/REDESIGN.md` § What exists versus what is new): the next upcoming date the page's
 * filters let through, in the second column from `md` (under the grid on a phone) — its day in
 * words, a pill that says what the panel is, the title, the time and the place, the route's pills
 * exactly as a listing card draws them (`buildRoutePills`, §366) with the weather at the start as
 * their last (§402, §429), and «Vezi detalii» to the event's page (`ArrowButtonLink`, §708). Under the
 * day, a line says how far away it is — «Azi», «Mâine», «Peste 5 zile», «Peste 3 săptămâni», «Peste 2 luni»,
 * «Acum» once it has started (`awayFrom`, §834) — with a calendar glyph (the hourglass already means the waiting list), in the fact lines' own pattern.
 *
 * The page asks for it only while the look is on, so with the setting off the calendar reads
 * nothing more and draws nothing more. A Server Component with typed props; nothing crosses into a
 * client component but strings and glyph names.
 */
export default async function NextEventPanel({ event, locale, now, weather }: NextEventPanelProps) {
  const t = await getTranslations("Events");
  const tEvent = await getTranslations("Event");
  const format = await getFormatter();
  const day = format.dateTime(event.startsAt, { timeZone: event.timezone, weekday: "long", day: "numeric", month: "long", year: "numeric" });
  const pills = buildRoutePills(event, tEvent, format);
  const away = awayFrom(event.startsAt, now, CLUB_TIME_ZONE);
  const awayWords =
    away.kind === "days" || away.kind === "weeks" || away.kind === "months"
      ? t(`calendar.look.nextEvent.away.${away.kind}.${countForm(away.count, locale)}`, { count: away.count })
      : t(`calendar.look.nextEvent.away.${away.kind}`);

  return (
    <Box
      component="section"
      aria-labelledby="calendar-next-title"
      data-testid="calendar-next-event"
      sx={{ p: 2, border: 1, borderColor: "divider", borderRadius: "16px", bgcolor: "background.paper", display: "grid", gap: 1.25 }}
    >
      <Typography component="p" sx={{ fontWeight: 700, fontSize: "1.0625rem", m: 0, "&::first-letter": { textTransform: "uppercase" } }}>
        {day}
      </Typography>
      <Box sx={{ ...FACT_SX, fontWeight: 600 }} data-testid="calendar-next-away" data-away={away.kind}>
        <TodayIcon aria-hidden="true" />
        <span>{awayWords}</span>
      </Box>
      <Box
        component="span"
        sx={{
          justifySelf: "start",
          px: 1,
          py: 0.25,
          borderRadius: "999px",
          fontSize: "0.75rem",
          fontWeight: 700,
          letterSpacing: "0.04em",
          textTransform: "uppercase",
          // The accent's pale band and its words: the club's accent through the layout's variables, one rule for both schemes.
          bgcolor: LOOK_ACCENT_TINT,
          color: "primary.main",
        }}
      >
        {t("calendar.look.nextEvent.title")}
      </Box>
      <Typography
        id="calendar-next-title"
        component="h2"
        variant="h3"
        sx={{ fontSize: "1.25rem", m: 0, overflowWrap: "anywhere", [UNDER_LOOK]: { color: COLOR.inkStrong }, [UNDER_LOOK_DARK]: { color: COLOR_DARK.inkStrong } }}
      >
        {event.title}
      </Typography>
      <Box component="dl" sx={{ m: 0, display: "grid", gap: 0.75, "& dd": { m: 0 } }}>
        <Box sx={FACT_SX}>
          <ScheduleIcon aria-hidden="true" />
          <Box component="dt" sx={VISUALLY_HIDDEN}>
            {t("calendar.look.nextEvent.time")}
          </Box>
          <dd>{formatTime(event.startsAt, { locale, timeZone: event.timezone })}</dd>
        </Box>
        {event.locationName && !event.locationToBeAnnounced && (
          <Box sx={FACT_SX}>
            <PlaceIcon aria-hidden="true" />
            <Box component="dt" sx={VISUALLY_HIDDEN}>
              {t("calendar.look.nextEvent.place")}
            </Box>
            <dd>{event.locationName}</dd>
          </Box>
        )}
      </Box>
      <RoutePills pills={pills} trailing={weather ? <CardWeather reading={weather} locale={locale} /> : undefined} />
      <ArrowButtonLink
        href={{ pathname: "/events/[slug]", params: { slug: event.slug } }}
        label={t("calendar.look.nextEvent.details")}
        data-testid="calendar-next-details"
      />
    </Box>
  );
}

const VISUALLY_HIDDEN = { position: "absolute", width: "1px", height: "1px", overflow: "hidden", clip: "rect(0 0 0 0)", whiteSpace: "nowrap" } as const;
