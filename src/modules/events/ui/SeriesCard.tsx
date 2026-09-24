import Box from "@mui/material/Box";
import { specialCard } from "@/theme/surfaces";
import Card from "@mui/material/Card";
import Chip from "@mui/material/Chip";
import Typography from "@mui/material/Typography";
import { getLocale, getTranslations } from "next-intl/server";
import { formatDay } from "@/i18n/dates";
import { getPathname, Link } from "@/i18n/navigation";
import { countForm } from "@/i18n/count-form";
import CardDoor from "./CardDoor";
import { CARD_BODY_SX, CARD_CHIPS_SX, CARD_DOOR_SX, CARD_FOLD_SX, CARD_TITLE_SX, GROUP_GAP } from "./card-layout";
import type { Locale } from "@/i18n/routing";
import { riseIn } from "@/theme/motion";
import { editionDifference, recurrenceOf, usualOf } from "../domain/series";
import type { PublicEvent } from "../repository";
import EventExcerpt from "./EventExcerpt";
import EventFacts from "./EventFacts";
import EventKindChips from "./EventKindChips";
import GlyphChip from "./GlyphChip";
import SeriesDates from "./SeriesDates";
import { editionNote, recurrenceSentence } from "./series-sentence";

/** How many dates the card lists before pointing at the month view for the rest. */

/**
 * A repeated event as one card (`DECISIONS.md` §113): the title once, how it recurs, the next
 * occurrence's facts, and the coming dates as links. Not one press wherever it is pressed like
 * `EventCard` — a fold and a link per date would sit on a card-sized target that took every near
 * miss (`CARD_STRETCHED_TITLE_SX`) — so the title is the link to the next occurrence's page, and
 * every date is its own. Each link is 44px tall (BR-REQ-041-01 criterion 6), like every other on
 * the listing.
 */
export default async function SeriesCard({
  members,
  index,
  now,
}: {
  /** Soonest first; at least two. */
  members: readonly PublicEvent[];
  index: number;
  now: Date;
}) {
  const t = await getTranslations("Event");
  const locale = (await getLocale()) as Locale;
  const next = members[0];
  const sentence = await recurrenceSentence(members, next.timezone, locale);
  // The chip says how often, not how many (the owner: "8 dates here is redundant, just show
  // weekly"); a set of dates with no rhythm keeps the count. Every date is shown — "2 more in
  // the calendar" meant nothing to him.
  const recurrence = recurrenceOf(members, next.timezone);
  const rhythm =
    recurrence.kind === "weekly"
      ? t("series.weeklyChip")
      : recurrence.kind === "fortnightly"
        ? t("series.fortnightlyChip")
        // "1 dată", "2 date", "20 de date" (§341): the count picks the catalogue's phrasing.
        : t(`series.count.${countForm(members.length, locale)}`, { count: members.length });
  const special = members.some((member) => member.isSpecial);
  const pageOf = (slug: string) => getPathname({ locale, href: { pathname: "/events/[slug]", params: { slug } } });
  // A date unlike the others — cancelled, elsewhere, at another hour — wears its mark (§122).
  const usual = usualOf(members);
  const dates = await Promise.all(
    members.map(async (member) => ({
      id: member.id,
      href: pageOf(member.slug),
      // A chip: the short form, formatted here and handed to the island as text (§349, §324).
      label: formatDay(member.startsAt, { locale, timeZone: member.timezone, style: "short" }),
      note: await editionNote(editionDifference(member, usual)),
    })),
  );

  /*
    The same shape as the single-date card, from the same constants (`card-layout.ts`, §NNN): the
    chips, the title, the rhythm, the summary, the next date's facts and pills, the dates folded,
    the door — each a group's gap from the one before it and nothing else.
  */
  return (
    <Card component="li" variant="outlined" sx={{ ...(special ? specialCard : {}), ...riseIn(index) }}>
      <Box sx={CARD_BODY_SX}>
        <Box sx={CARD_CHIPS_SX}>
          {/* The type; the surface is a pill with the facts below, said once (§NNN). */}
          <EventKindChips type={next.type} surface={null} />
          <GlyphChip glyph="series" variant="outlined" label={rhythm} />
          {/* An edition apart on *any* of the dates (§168, §169). A repeated event is one card
              (§113), so the badge the single-event card wears would otherwise be shown nowhere
              for the owner's own case — "some dates can be special events where we overlap
              with, say, Brașov Marathon on the same Wednesday" — and the lift `SPECIAL_FIRST`
              gives the line would have no visible cause. Which date it is, is the mark in the
              folded list below. */}
          {special && <GlyphChip glyph="special" color="secondary" label={t("special")} />}
          {next.eventStatus === "CANCELLED" && <Chip size="small" color="error" label={t("cancelled")} />}
        </Box>

        {/* The title in the one style every card's title has (`CARD_TITLE_SX`): the text's colour,
            visited or not, underlined under a pointer or the keyboard — no longer the browser's
            blue-then-purple underlined link beside a black one (§NNN). */}
        <Typography variant="h2" sx={CARD_TITLE_SX}>
          <Link href={{ pathname: "/events/[slug]", params: { slug: next.slug } }}>{next.title}</Link>
        </Typography>

        {/* "În fiecare luni, la 18:30" — the line the card exists for, right under its title. */}
        <Typography variant="body1" sx={{ fontWeight: 500, mt: 0.5 }}>
          {sentence}
        </Typography>

        {/* The short description as written, picture and all (§73), three lines of it and no
            address (`CARD_EXCERPT_SX`, §NNN) — the same excerpt the single-event card renders. */}
        <EventExcerpt place="card" excerptJson={next.excerptJson} excerpt={next.excerpt} />

        {/* The next date's facts: "Următoarea: Luni, 28 sept. 2026 · 18:30" on one line — the
            label used to be a line of its own above them — then the place and the pills. */}
        <Box sx={{ mt: GROUP_GAP }}>
          <EventFacts event={next} now={now} variant="compact" whenLead={t("series.nextLabel")} />
        </Box>

        {/* Every coming date, each a link to its own page — folded (§154; the owner: "these
            date pills take too much space"): the card is the next date and the rhythm, the
            rest is one press away. A native disclosure, 44px, no JavaScript. No margin: the
            summary's own 44 pixels hold the group's gap above its words — and 44 is all they
            are here, without the fold's usual ten pixels of padding on top of them. */}
        <Box component="details" sx={CARD_FOLD_SX}>
          <Typography component="summary" variant="body2" color="text.secondary">
            {t("series.allDatesCount", { count: members.length })}
          </Typography>
          <Box sx={{ pt: 0.5 }}>
            <SeriesDates dates={dates} />
          </Box>
        </Box>

        {/* The door to the page, said in words (§305; the owner: "am nevoie de un buton pe carduri
            pentru 'descrierea completa a evenimentului'"). The title was the only link, and a
            title does not announce that a page exists behind it. A plain anchor — no client
            island, 44px — to the next date's page, which is where the full description, the
            rules and the programme live. */}
        <Box sx={CARD_DOOR_SX}>
          <CardDoor href={pageOf(next.slug)} label={t("series.fullDescription")} />
        </Box>
      </Box>
    </Card>
  );
}
