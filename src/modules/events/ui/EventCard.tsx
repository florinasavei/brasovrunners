import Box from "@mui/material/Box";
import Card from "@mui/material/Card";
import Chip from "@mui/material/Chip";
import Typography from "@mui/material/Typography";
import { getLocale, getTranslations } from "next-intl/server";
import { getPathname, Link } from "@/i18n/navigation";
import type { Locale } from "@/i18n/routing";
import { riseIn } from "@/theme/motion";
import { specialCard } from "@/theme/surfaces";
import type { PublicEvent } from "../repository";
import CardDoor from "./CardDoor";
import { CARD_BODY_SX, CARD_CHIPS_SX, CARD_DOOR_SX, CARD_TITLE_SX, GROUP_GAP } from "./card-layout";
import EventExcerpt from "./EventExcerpt";
import EventFacts from "./EventFacts";
import EventKindChips from "./EventKindChips";
import GlyphChip from "./GlyphChip";
import PartnerChip from "./PartnerChip";

/**
 * One event on the listing — the single-date card, beside `SeriesCard`, and since §NNN the same
 * structure as it: the chips, the title as the link, the summary, the facts, the door. It lived
 * inside `events/page.tsx` until the two cards were given one shape and a test had to render it.
 * Each card rises into place in reading order — CSS only, and none of it for a reader who asked
 * for less motion (`theme/motion.ts`).
 *
 * **Not one link any more.** The whole card was an `<a>` (`CardLink`), which is why its title was
 * a black heading beside the series cards' blue links and why its place could not be the map link
 * the club had pasted — a link cannot hold another link. The owner, 2026-09-24, of "Trail to Road
 * cu Brașov Running Festival": "I am missing the blue link for this event, why?" and "I do not see
 * the google maps link for this event, although I've put the maps URL". Now the title is the link,
 * in the one blue style every card's title has, and the facts carry their links (the map) as they
 * do on the series card and the page. The lift under a pointer went with the whole-card link: it
 * said "all of this is one press", which is no longer true, and the series card never had it.
 *
 * Every card carries the summary, pictures and all (§251). It did not under the featured event
 * — §242 kept that list dense so the lead was not followed by a scroll — and the owner asked
 * for the opposite once a picture could be cropped to the shape a card shows (§241): "on the
 * event card I wanna be able to see pictures in the preview".
 */
export default async function EventCard({
  event,
  index,
  now,
}: {
  event: PublicEvent;
  index: number;
  now: Date;
}) {
  const tEvent = await getTranslations("Event");
  const locale = (await getLocale()) as Locale;
  const page = getPathname({ locale, href: { pathname: "/events/[slug]", params: { slug: event.slug } } });
  return (
    <Card
      component="li"
      variant="outlined"
      /* An event the club marked special wears it on the whole card (§272), not only as a chip. */
      sx={{ ...riseIn(index), ...(event.isSpecial ? specialCard : {}) }}
    >
      {/* The shape the series card has, from the same constants (`card-layout.ts`, §NNN): the door
          right after the facts, and what the row leaves over below it rather than above it. */}
      <Box sx={CARD_BODY_SX}>
        <Box sx={CARD_CHIPS_SX}>
          {/* What it is, with its glyph (§112). What it is run on is a pill with the facts below,
              said once on the card (§NNN). */}
          <EventKindChips type={event.type} surface={null} />
          {/* An edition apart (§168): an anniversary, a charity run, a date the club joins
              somebody else's race. Any number of events may wear it. */}
          {event.isSpecial && <GlyphChip glyph="special" color="secondary" label={tEvent("special")} />}
          {/* Held with a partner (§367): the handshake and the partner's name. */}
          <PartnerChip event={event} />
          {/* BR-REQ-020-01 criterion 2: a cancelled event stays listed and says so. */}
          {event.eventStatus === "CANCELLED" && <Chip size="small" color="error" label={tEvent("cancelled")} />}
          {event.eventStatus === "COMPLETED" && <Chip size="small" label={tEvent("completed")} />}
        </Box>

        {/* The title is the card's link to its page, in the one style every card's title has
            (`CARD_TITLE_SX`): the club's blue, visited or not, underlined under a pointer or the
            keyboard. A screen reader hears the title, not every word on the card. */}
        <Typography variant="h2" sx={CARD_TITLE_SX}>
          <Link href={{ pathname: "/events/[slug]", params: { slug: event.slug } }}>{event.title}</Link>
        </Typography>

        {/* The short description as it was written, picture and all (§73), three lines of it and
            no link (`CARD_EXCERPT_SX`, §NNN). `EventExcerpt` renders nothing when there is
            nothing, which is what the old `event.excerpt &&` did. */}
        <EventExcerpt place="card" excerptJson={event.excerptJson} excerpt={event.excerpt} />

        {/* The facts, with their links: the place is the map the club pasted. */}
        <Box sx={{ mt: GROUP_GAP }}>
          <EventFacts event={event} now={now} variant="compact" />
        </Box>

        {/* The door to the page, said in words (§305; the owner: "am nevoie de un buton pe carduri
            pentru 'descrierea completa a evenimentului'") — the same door the series card wears,
            so the two kinds of card read alike. */}
        <Box sx={CARD_DOOR_SX}>
          <CardDoor href={page} label={tEvent("series.fullDescription")} />
        </Box>
      </Box>
    </Card>
  );
}
