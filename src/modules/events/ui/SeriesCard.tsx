import Box from "@mui/material/Box";
import { specialCard } from "@/theme/surfaces";
import Card from "@mui/material/Card";
import Button from "@mui/material/Button";
import CardContent from "@mui/material/CardContent";
import Chip from "@mui/material/Chip";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { getFormatter, getLocale, getTranslations } from "next-intl/server";
import { getPathname, Link } from "@/i18n/navigation";
import { CARD_DOOR_SX } from "./card-door";
import type { Locale } from "@/i18n/routing";
import { DISCLOSURE_SX } from "@/shared/ui/disclosure";
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
 * occurrence's facts, and the coming dates as links. Not one big link like `EventCard` — a
 * card with links inside cannot itself be a link — so the title is the link to the next
 * occurrence's page, and every date is its own. Each link is 44px tall (BR-REQ-041-01
 * criterion 6), like every other on the listing.
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
  const format = await getFormatter();
  const locale = (await getLocale()) as Locale;
  const next = members[0];
  const sentence = await recurrenceSentence(members, next.timezone, locale);
  // The chip says how often, not how many (the owner: "8 dates here is redundant, just show
  // weekly"); a set of dates with no rhythm keeps the count. Every date is shown — "2 more in
  // the calendar" meant nothing to him.
  const recurrence = recurrenceOf(members, next.timezone);
  const rhythm =
    recurrence.kind === "weekly" ? t("series.weeklyChip") : recurrence.kind === "fortnightly" ? t("series.fortnightlyChip") : t("series.count", { count: members.length });
  const special = members.some((member) => member.isSpecial);
  const pageOf = (slug: string) => getPathname({ locale, href: { pathname: "/events/[slug]", params: { slug } } });
  // A date unlike the others — cancelled, elsewhere, at another hour — wears its mark (§122).
  const usual = usualOf(members);
  const dates = await Promise.all(
    members.map(async (member) => ({
      id: member.id,
      href: pageOf(member.slug),
      label: format.dateTime(member.startsAt, { timeZone: member.timezone, weekday: "short", day: "numeric", month: "short" }),
      note: await editionNote(editionDifference(member, usual)),
    })),
  );

  return (
    <Card component="li" variant="outlined" sx={{ ...(special ? specialCard : {}), ...riseIn(index) }}>
      <CardContent>
        <Stack direction="row" spacing={1} sx={{ mb: 1, flexWrap: "wrap", gap: 1, alignItems: "center" }}>
          <EventKindChips type={next.type} surface={next.surface} />
          <GlyphChip glyph="series" variant="outlined" label={rhythm} />
          {/* An edition apart on *any* of the dates (§168, §169). A repeated event is one card
              (§113), so the badge the single-event card wears would otherwise be shown nowhere
              for the owner's own case — "some dates can be special events where we overlap
              with, say, Brașov Marathon on the same Wednesday" — and the lift `SPECIAL_FIRST`
              gives the line would have no visible cause. Which date it is, is the mark in the
              folded list below. */}
          {special && <GlyphChip glyph="special" color="secondary" label={t("special")} />}
          {next.eventStatus === "CANCELLED" && <Chip size="small" color="error" label={t("cancelled")} />}
        </Stack>

        <Typography variant="h2" sx={{ fontSize: "1.25rem", mb: 0.5 }}>
          <Link href={{ pathname: "/events/[slug]", params: { slug: next.slug } }} style={{ display: "inline-flex", alignItems: "center", minHeight: 44 }}>
            {next.title}
          </Link>
        </Typography>

        {/* "Every Monday and Wednesday at 18:30" — the line the card exists for. */}
        <Typography variant="body1" sx={{ fontWeight: 500, mb: 1 }}>
          {sentence}
        </Typography>

        {/* The short description as written, picture and all (§73) — the same excerpt the
            single-event card renders, constrained to the card by `EventExcerpt`. */}
        {/* The summary, pictures and all, on every card since §251. */}
        <EventExcerpt place="card" excerptJson={next.excerptJson} excerpt={next.excerpt} />

        <Typography variant="body2" color="text.secondary" sx={{ mb: 0.25 }}>
          {t("series.nextLabel")}
        </Typography>
        <EventFacts event={next} now={now} variant="compact" />

        {/* Every coming date, each a link to its own page — folded (§154; the owner: "these
            date pills take too much space"): the card is the next date and the rhythm, the
            rest is one press away. A native disclosure, 44px, no JavaScript. */}
        <Box component="details" sx={{ mt: 1.5, ...DISCLOSURE_SX }}>
          <Typography component="summary" variant="body2" color="text.secondary">
            {t("series.allDatesCount", { count: members.length })}
          </Typography>
          <Box sx={{ pt: 0.5 }}>
            <SeriesDates dates={dates} />
          </Box>
        </Box>

        {/* The door to the page, said in words (§305; the owner: "am nevoie de un buton pe carduri
            pentru 'descrierea completa a evenimentului'"). The title was the only link, and a
            title does not announce that a page exists behind it. A plain anchor styled as a
            button — no client island, 44px — to the next date's page, which is where the full
            description, the rules and the programme live. */}
        <Box sx={{ mt: 1.5 }}>
          <Button component="a" href={pageOf(next.slug)} variant="outlined" size="small" sx={CARD_DOOR_SX}>
            {t("series.fullDescription")}
          </Button>
        </Box>
      </CardContent>
    </Card>
  );
}
