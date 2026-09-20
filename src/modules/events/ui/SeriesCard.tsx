import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import Chip from "@mui/material/Chip";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { getFormatter, getLocale, getTranslations } from "next-intl/server";
import { getPathname, Link } from "@/i18n/navigation";
import type { Locale } from "@/i18n/routing";
import { riseIn } from "@/theme/motion";
import { editionDifference, recurrenceOf, usualOf } from "../domain/series";
import type { PublicEvent } from "../repository";
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
  underHero = false,
}: {
  /** Soonest first; at least two. */
  members: readonly PublicEvent[];
  index: number;
  now: Date;
  underHero?: boolean;
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
    <Card component="li" variant="outlined" sx={{ ...riseIn(index) }}>
      <CardContent>
        <Stack direction="row" spacing={1} sx={{ mb: 1, flexWrap: "wrap", gap: 1, alignItems: "center" }}>
          <EventKindChips type={next.type} surface={next.surface} />
          <GlyphChip glyph="series" variant="outlined" label={rhythm} />
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

        {next.excerpt && !underHero && (
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            {next.excerpt}
          </Typography>
        )}

        <Typography variant="body2" color="text.secondary" sx={{ mb: 0.25 }}>
          {t("series.nextLabel")}
        </Typography>
        <EventFacts event={next} now={now} variant="compact" />

        {/* Every coming date, each a link to its own page. */}
        <Typography variant="body2" color="text.secondary" sx={{ mt: 2, mb: 0.5 }}>
          {t("series.allDates")}
        </Typography>
        <SeriesDates dates={dates} />
      </CardContent>
    </Card>
  );
}
