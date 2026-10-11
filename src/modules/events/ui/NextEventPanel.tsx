import PlaceIcon from "@mui/icons-material/Place";
import ScheduleIcon from "@mui/icons-material/Schedule";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import { getFormatter, getTranslations } from "next-intl/server";
import { formatTime } from "@/i18n/dates";
import type { Locale } from "@/i18n/routing";
import type { PublicEvent } from "@/modules/events/repository";
import type { WeatherReading } from "@/modules/weather/domain/forecast";
import CardWeather from "@/modules/weather/ui/CardWeather";
import ArrowButtonLink from "@/shared/ui/ArrowButtonLink";
import { COLOR, COLOR_DARK } from "@/theme/brand";
import { UNDER_LOOK, UNDER_LOOK_DARK } from "@/theme/look";
import { buildRoutePills } from "./route-pills";
import RoutePills from "./RoutePills";

export type NextEventPanelProps = {
  /** The next date still ahead, from the listing's cached read (`public-cache/reads.ts`), already narrowed by the page's filters. */
  event: PublicEvent;
  locale: Locale;
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
 * their last (§402, §429), and «Vezi detalii» to the event's page (`ArrowButtonLink`, §708).
 *
 * The page asks for it only while the look is on, so with the setting off the calendar reads
 * nothing more and draws nothing more. A Server Component with typed props; nothing crosses into a
 * client component but strings and glyph names.
 */
export default async function NextEventPanel({ event, locale, weather }: NextEventPanelProps) {
  const t = await getTranslations("Events");
  const tEvent = await getTranslations("Event");
  const format = await getFormatter();
  const day = format.dateTime(event.startsAt, { timeZone: event.timezone, weekday: "long", day: "numeric", month: "long", year: "numeric" });
  const pills = buildRoutePills(event, tEvent, format);

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
          bgcolor: COLOR.accentTint,
          color: COLOR.accentInk,
          [UNDER_LOOK_DARK]: { bgcolor: COLOR_DARK.accentTint, color: COLOR_DARK.accentInk },
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
