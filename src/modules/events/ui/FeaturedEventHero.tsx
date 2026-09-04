import Box from "@mui/material/Box";
import Chip from "@mui/material/Chip";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { getTranslations } from "next-intl/server";
import ButtonLink from "@/shared/ui/ButtonLink";
import type { PublicEvent } from "../repository";
import EventFacts from "./EventFacts";

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

  return (
    <Box
      component="section"
      aria-labelledby="featured-event-title"
      sx={{
        mb: 4,
        p: { xs: 2, sm: 3 },
        borderRadius: 2,
        border: 1,
        borderColor: "divider",
        bgcolor: "background.paper",
      }}
    >
      <Stack direction="row" spacing={1} sx={{ mb: 1, flexWrap: "wrap", gap: 1 }}>
        <Chip size="small" color="primary" label={t("featured")} />
        <Chip size="small" label={tEvent(`kind.${event.kind}`)} />
        {/* BR-REQ-020-01 criterion 2: a cancelled event says so wherever it appears. */}
        {event.eventStatus === "CANCELLED" && (
          <Chip size="small" color="error" label={tEvent("cancelled")} />
        )}
      </Stack>

      <Typography
        id="featured-event-title"
        variant="h2"
        sx={{ fontSize: { xs: "1.5rem", sm: "2rem" }, mb: 1 }}
      >
        {event.title}
      </Typography>

      {event.excerpt && (
        <Typography variant="body1" color="text.secondary" sx={{ mb: 2 }}>
          {event.excerpt}
        </Typography>
      )}

      <EventFacts event={event} now={now} />

      <Box sx={{ mt: 3 }}>
        <ButtonLink
          variant="contained"
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
