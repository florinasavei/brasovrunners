import Box from "@mui/material/Box";
import Chip from "@mui/material/Chip";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { getFormatter, getTranslations } from "next-intl/server";
import ButtonLink from "@/shared/ui/ButtonLink";
import { raceWeek } from "../domain/race-week";
import type { PublicEvent } from "../repository";
import EventExcerpt from "./EventExcerpt";
import EventFacts from "./EventFacts";
import RegistrationCta from "./RegistrationCta";
import { fadeIn } from "@/theme/motion";

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
}: {
  event: PublicEvent;
  now: Date;
}) {
  const t = await getTranslations("Events");
  const tEvent = await getTranslations("Event");
  const format = await getFormatter();
  // The last seven days (`DECISIONS.md` §78): a countdown line, counted on the event's own
  // calendar, above the button — the one thing a visitor wants to know that week.
  const week = raceWeek(event, now);

  return (
    <Box
      component="section"
      aria-labelledby="featured-event-title"
      sx={{
        // Arrives with the page rather than snapping in; static for reduced motion.
        ...fadeIn,
        mb: 4,
        p: { xs: 2.5, sm: 4 },
        borderRadius: 2,
        // The one event the club is leading with looks like it (the owner, 2026-09-18: "the
        // main event must be more highlighted, the rest can be other events"): a two-pixel
        // border in the club's blue, a shadow, a bigger title. Everything below it is a plain
        // outlined card under "Other events".
        border: 2,
        borderColor: "primary.main",
        boxShadow: 3,
        bgcolor: "background.paper",
      }}
    >
      <Stack direction="row" spacing={1} sx={{ mb: 1, flexWrap: "wrap", gap: 1 }}>
        <Chip size="small" color="primary" label={t("featured")} />
        <Chip size="small" label={tEvent(`type.${event.type}`)} />
        {event.surface && (
          <Chip size="small" variant="outlined" label={tEvent(`surface.${event.surface}`)} />
        )}
        {/* BR-REQ-020-01 criterion 2: a cancelled event says so wherever it appears. */}
        {event.eventStatus === "CANCELLED" && (
          <Chip size="small" color="error" label={tEvent("cancelled")} />
        )}
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
            days: week.days,
            when: format.dateTime(event.startsAt, {
              timeZone: event.timezone,
              weekday: "long",
              hour: "2-digit",
              minute: "2-digit",
            }),
          })}
        </Typography>
      )}

      <EventFacts event={event} now={now} />

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
