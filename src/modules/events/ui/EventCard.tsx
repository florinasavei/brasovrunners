import Box from "@mui/material/Box";
import Card from "@mui/material/Card";
import Chip from "@mui/material/Chip";
import Typography from "@mui/material/Typography";
import { getLocale, getTranslations } from "next-intl/server";
import { formatDay } from "@/i18n/dates";
import { getPathname, Link } from "@/i18n/navigation";
import type { Locale } from "@/i18n/routing";
import { durationPhrase } from "@/modules/deadlines/domain/duration-words";
import { riseIn } from "@/theme/motion";
import { featuredCard, specialCard } from "@/theme/surfaces";
import type { WeatherReading } from "@/modules/weather/domain/forecast";
import { raceWeek } from "../domain/race-week";
import type { PublicEvent } from "../repository";
import CardDoor from "./CardDoor";
import { CARD_BODY_SX, CARD_CHIPS_SX, CARD_DOOR_SX, CARD_TAP_SX, CARD_TITLE_SX, GROUP_GAP } from "./card-layout";
import EventExcerpt from "./EventExcerpt";
import EventFacts from "./EventFacts";
import EventKindChips from "./EventKindChips";
import GlyphChip from "./GlyphChip";
import PartnerChip from "./PartnerChip";
import { repeatTooltip, rhythmLabel } from "./series-sentence";

/**
 * One event on the listing — the single-date card, beside `SeriesCard`, and since §366 the same
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
 * **One press anywhere, all the same** (§NNN): the title's link is stretched over the card
 * (`CARD_TAP_SX`, `CARD_TITLE_SX`), so a thumb on the summary, the pills or the room under the door
 * opens the page, while the map, the door and the registration button stay links of their own —
 * the whole-card tap without the `<a>` around it that took the map link away.
 *
 * **A date of a repeated event says so** (§NNN): when the listing's filters or the lead (§470) leave
 * one date of a series alone on this card, it wears the series card's repeat chip with its rhythm
 * — «Săptămânal» — so a weekly run does not read as a one-off. `seriesDates` is the whole series,
 * read by the page before any filter.
 *
 * Every card carries the summary, pictures and all (§251). It did not under the featured event
 * — §242 kept that list dense so the lead was not followed by a scroll — and the owner asked
 * for the opposite once a picture could be cropped to the shape a card shows (§241): "on the
 * event card I wanna be able to see pictures in the preview".
 *
 * **The featured event is this card too** (§470, replacing the hero above the listing; the owner,
 * 2026-09-26: "vreau doar sa fie primul, nu neaparat mai lat pe desktop, e ok sa afisam 2 sau 3
 * carduri, dar toate cardurile trebuie sa aiba aceeasi latime"). Given `featured`, it is the first
 * card of the grid, at the grid's one width, and differs only by its frame and background
 * (`featuredCard`) and the «Evenimentul principal» chip first among its marks — plus, in the club's
 * race week (§78, §377), the countdown line and the desk's "come with the QR" once registration has
 * closed, which are the one thing a visitor wants that week. It is a region named by its title, as
 * the hero was, so a screen reader can still jump to "the event the club leads with".
 */
export default async function EventCard({
  event,
  index,
  now,
  weather = null,
  featured,
  seriesDates,
}: {
  event: PublicEvent;
  index: number;
  now: Date;
  /** The forecast at the start (§416), read by the listing for every card at once (`forecastsForEvents`); null outside the seven days or on any failure. */
  weather?: WeatherReading | null;
  /** The listing's lead event (§470): the club's race-week days (§377), read by the page from the data cache. */
  featured?: { raceWeekDays: number };
  /**
   * Every date of the repeated event this one belongs to (§113), this one included, when it has
   * others — the page groups its whole list before the filters (`seriesLookup`). Absent, or a
   * single date, the card wears no repeat chip.
   */
  seriesDates?: readonly { startsAt: Date }[];
}) {
  const tEvent = await getTranslations("Event");
  const locale = (await getLocale()) as Locale;
  const page = getPathname({ locale, href: { pathname: "/events/[slug]", params: { slug: event.slug } } });
  // The last days before the start (§78; seven unless the club changed it, §377), counted on the
  // event's own calendar — the featured card only.
  const week = featured ? raceWeek(event, now, featured) : null;
  const tEvents = featured ? await getTranslations("Events") : null;
  const rhythm = seriesDates && seriesDates.length > 1 ? await rhythmLabel(seriesDates, event.timezone, locale) : null;
  // The rule behind the word, on hover, on a tap and to a screen reader (§NNN): «Se repetă în fiecare marți, la 18:30».
  const repeats = seriesDates && seriesDates.length > 1 ? await repeatTooltip(seriesDates, event.timezone, locale) : undefined;
  return (
    <Card
      component="li"
      variant="outlined"
      data-featured={featured ? "true" : undefined}
      data-series={rhythm ? "true" : undefined}
      /* The lead event wears its frame and background (§470); one the club marked special wears
         that on the whole card (§272), not only as a chip. One frame per card: the lead's wins. */
      sx={{ ...CARD_TAP_SX, ...riseIn(index), ...(featured ? featuredCard : event.isSpecial ? specialCard : {}) }}
    >
      {/* The shape the series card has, from the same constants (`card-layout.ts`, §366): the door
          right after the facts, and what the row leaves over below it rather than above it. The
          lead's body is a region named by its title (§470), as the hero's `<section>` was. */}
      <Box
        component={featured ? "section" : "div"}
        aria-labelledby={featured ? "featured-event-title" : undefined}
        sx={CARD_BODY_SX}
      >
        <Box sx={CARD_CHIPS_SX}>
          {/* The one mark that says "the event the club leads with" (§470), first. */}
          {tEvents && <GlyphChip glyph="featured" color="primary" label={tEvents("featured")} />}
          {/* What it is, with its glyph (§112). What it is run on is a pill with the facts below,
              said once on the card (§366). */}
          <EventKindChips type={event.type} surface={null} />
          {/* One date of a repeated event, alone on its card (§NNN): the series card's repeat chip,
              in the same place, so the rhythm is read the same way on both cards. */}
          {rhythm && <GlyphChip glyph="repeat" variant="outlined" label={rhythm} tooltip={repeats} srSuffix={repeats} />}
          {/* An edition apart (§168): an anniversary, a charity run, a date the club joins
              somebody else's race. Any number of events may wear it. */}
          {event.isSpecial && <GlyphChip glyph="special" color="secondary" label={tEvent("special")} />}
          {/* Held with a partner (§367, amended §375, §379): the handshake and the generic "Colaborare" / "Partnership". */}
          <PartnerChip event={event} />
          {/* BR-REQ-020-01 criterion 2: a cancelled event stays listed and says so. */}
          {event.eventStatus === "CANCELLED" && <Chip size="small" color="error" label={tEvent("cancelled")} />}
          {event.eventStatus === "COMPLETED" && <Chip size="small" label={tEvent("completed")} />}
        </Box>

        {/* The title is the card's link to its page, in the one style every card's title has
            (`CARD_TITLE_SX`): the club's blue, visited or not, underlined under a pointer or the
            keyboard. A screen reader hears the title, not every word on the card. */}
        <Typography variant="h2" id={featured ? "featured-event-title" : undefined} sx={CARD_TITLE_SX}>
          <Link href={{ pathname: "/events/[slug]", params: { slug: event.slug } }}>{event.title}</Link>
        </Typography>

        {/* The short description as it was written, picture and all (§73), three lines of it and
            no link (`CARD_EXCERPT_SX`, §366). `EventExcerpt` renders nothing when there is
            nothing, which is what the old `event.excerpt &&` did. */}
        <EventExcerpt place="card" excerptJson={event.excerptJson} excerpt={event.excerpt} />

        {/* The countdown (§78), the lead's alone and only in race week: "În 3 zile, sâmbătă, 21 nov.
            2026, la 10:00" — the noun agreeing with the number (§377), the date inline (§349, §452).
            In the club's blue and bold, at the card's own size; a group's gap above it like any group. */}
        {week && tEvents && (
          <Typography
            component="p"
            variant="body1"
            data-testid="race-week-countdown"
            sx={{ mt: GROUP_GAP, mb: 0, fontWeight: 700, color: "primary.main" }}
          >
            {tEvents(week.days === 0 ? "raceWeek.today" : week.days === 1 ? "raceWeek.tomorrow" : "raceWeek.inDays", {
              days: durationPhrase(locale, week.days, "days"),
              when: formatDay(event.startsAt, { locale, timeZone: event.timezone, style: "long", withTime: true, position: "inline" }),
            })}
          </Typography>
        )}

        {/* The facts, with their links: the place is the map the club pasted. The weather at the
            start, a glyph and the degrees (§416), within seven days of it, is the last pill of the
            route's row — the umbrella when rain is likely (§429).

            Card height (review finding, §429): the pill left the marks row above the title
            (`CARD_CHIPS_SX`) for the last slot of this row (`RoutePills`' `trailing`), at the
            same 24px height as the route pills it now sits among (`CardWeather`) — no taller than
            a chip already there. Both rows already wrap (`flexWrap: "wrap"`), so a card's total
            height changes only where a row's own wrap count changes at a given width; it does not
            change where either row already fit its pills on one line before and after. This round
            did not capture a live 320/360/390/412px measurement of a card with weather (it needs
            a forecast fixture inside the seven-day window plus a live browser, which the shared
            machine's one-build-at-a-time rule made too slow to add here) — a follow-up should add
            it to `tests/e2e/weather-place.spec.ts` or `tests/e2e/listing-cards.spec.ts`, the way
            other breakpoints in this module are measured and pasted (`EventFacts.tsx`'s own
            comments). */}
        <Box sx={{ mt: GROUP_GAP }}>
          <EventFacts event={event} now={now} variant="compact" cardWeather={weather} raceWeek={week !== null} />
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
