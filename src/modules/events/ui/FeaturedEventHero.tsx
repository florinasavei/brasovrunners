import Box from "@mui/material/Box";
import Chip from "@mui/material/Chip";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { getLocale, getTranslations } from "next-intl/server";
import { formatDay } from "@/i18n/dates";
import { durationPhrase } from "@/modules/deadlines/domain/duration-words";
import ButtonLink from "@/shared/ui/ButtonLink";
import { raceWeek } from "../domain/race-week";
import type { EventForecast } from "@/modules/weather/domain/forecast";
import type { PublicEvent } from "../repository";
import EventExcerpt from "./EventExcerpt";
import EventFacts from "./EventFacts";
import EventKindChips from "./EventKindChips";
import GlyphChip from "./GlyphChip";
import PartnerChip from "./PartnerChip";
import RegistrationCta from "./RegistrationCta";
import { DENSITY } from "@/theme/density";
import { fadeIn } from "@/theme/motion";
import { heroSurface } from "@/theme/surfaces";

/**
 * The event the club is leading with, above the ordinary listing.
 *
 * This is what the site is for: somebody arrives to find the club's next race and enter it,
 * and the answer should be the first thing on the page rather than the fourth card down. One
 * event at a time — the database refuses a second featured row — so this renders once or not
 * at all.
 *
 * Everything in it is text (BR-REQ-070-03 criterion 2) and nothing has a fixed width
 * (BR-REQ-041-01 criterion 1): at 320px the facts stack, the heading wraps, and the page still
 * does not scroll sideways.
 */
export default async function FeaturedEventHero({
  event,
  now,
  raceWeekDays,
  weather = null,
}: {
  event: PublicEvent;
  now: Date;
  /** How many days before the start the countdown shows — the club's "Termene" (§377), read by the page. */
  raceWeekDays: number;
  /** The forecast at the start, read by the listing (§416): «Vremea» among the hero's facts, within seven days of it. */
  weather?: EventForecast | null;
}) {
  const t = await getTranslations("Events");
  const tEvent = await getTranslations("Event");
  const locale = await getLocale();
  // The last days before the start (`DECISIONS.md` §78; seven unless the club changed it, §377):
  // a countdown line, counted on the event's own calendar, above the button — the one thing a
  // visitor wants to know that week.
  const week = raceWeek(event, now, { raceWeekDays });

  return (
    <Box
      component="section"
      aria-labelledby="featured-event-title"
      sx={{
        // Arrives with the page rather than snapping in; static for reduced motion.
        ...fadeIn,
        mb: { xs: DENSITY.sectionGapLg, sm: 4 },
        p: { xs: DENSITY.heroPad, sm: 4 },
        borderRadius: 2,
        // The one event the club is leading with looks like it (the owner, 2026-09-18: "the
        // main event must be more highlighted, the rest can be other events"): a two-pixel
        // border in the club's blue, a shadow, a bigger title. Everything below it is a plain
        // outlined card under "Other events".
        border: 2,
        borderColor: "primary.main",
        boxShadow: 3,
        // A gradient rather than a flat card (§166; the owner: "I need more gradients"): the
        // card colour walked a few steps towards the club's blue, and no further — body text,
        // muted text and the countdown are all asserted against both ends of both schemes in
        // `tests/unit/theme/brand.test.ts`. `bgcolor` stays underneath as the fallback.
        bgcolor: "background.paper",
        ...heroSurface,
      }}
    >
      <Stack direction="row" spacing={1} sx={{ mb: 1, flexWrap: "wrap", gap: 1 }}>
        <GlyphChip glyph="featured" color="primary" label={t("featured")} />
        {/* Special is not featured (§168): the lead event may also be an edition apart, and
            then it says both — "the one we are leading with" and "not an ordinary one". */}
        {event.isSpecial && <GlyphChip glyph="special" color="secondary" label={tEvent("special")} />}
        <EventKindChips type={event.type} surface={event.surface} />
        {/* Held with a partner (§367), as on every listing card. */}
        <PartnerChip event={event} />
        {/* BR-REQ-020-01 criterion 2: a cancelled event says so wherever it appears. */}
        {event.eventStatus === "CANCELLED" && (
          <Chip size="small" color="error" label={tEvent("cancelled")} />
        )}
        {event.eventStatus === "COMPLETED" && <Chip size="small" label={tEvent("completed")} />}
      </Stack>

      <Typography
        id="featured-event-title"
        variant="h2"
        sx={{ fontSize: { xs: "1.75rem", sm: "2.5rem" }, lineHeight: 1.15, mb: 1.5 }}
      >
        {event.title}
      </Typography>

      <EventExcerpt excerptJson={event.excerptJson} excerpt={event.excerpt} />

      {week && (
        <Typography
          variant="h3"
          component="p"
          data-testid="race-week-countdown"
          sx={{ fontSize: { xs: "1.125rem", sm: "1.25rem" }, fontWeight: 700, color: "primary.main", mb: 2 }}
        >
          {t(week.days === 0 ? "raceWeek.today" : week.days === 1 ? "raceWeek.tomorrow" : "raceWeek.inDays", {
            // "3 zile", "20 de zile" — the noun agreeing with the number (§377: race week can be three weeks now).
            days: durationPhrase(locale, week.days, "days"),
            // "În 3 zile, sâmbătă, 21 nov. 2026, 10:00" — after the comma, lower case (§349).
            when: formatDay(event.startsAt, { locale, timeZone: event.timezone, style: "long", withTime: true, position: "inline" }),
          })}
        </Typography>
      )}

      <EventFacts event={event} now={now} weather={weather} />

      {/*
        Registration first, details second.

        The lead event is here because somebody arrived to enter it, so the primary button is
        the one that starts that — and when registration is not open, this renders the sentence
        saying so, or nothing at all. "See the details" then steps down to outlined: two filled
        buttons side by side is two primary actions, which is none.
      */}
      <RegistrationCta event={event} now={now} raceWeek={week !== null} />

      <Box sx={{ mt: 2 }}>
        <ButtonLink
          variant="outlined"
          // 44px is the minimum tap target BR-REQ-041-01 criterion 6 names; MUI's medium
          // button is 36.5px, which passes on a mouse and fails on a thumb.
          sx={{ minHeight: 44 }}
          href={{ pathname: "/events/[slug]", params: { slug: event.slug } }}
        >
          {t("featuredCallToAction")}
        </ButtonLink>
      </Box>
    </Box>
  );
}
