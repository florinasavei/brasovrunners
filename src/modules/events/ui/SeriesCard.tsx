import Box from "@mui/material/Box";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import Chip from "@mui/material/Chip";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { getFormatter, getLocale, getTranslations } from "next-intl/server";
import { getPathname, Link } from "@/i18n/navigation";
import type { Locale } from "@/i18n/routing";
import { riseIn } from "@/theme/motion";
import type { PublicEvent } from "../repository";
import EventFacts from "./EventFacts";
import EventKindChips from "./EventKindChips";
import GlyphChip from "./GlyphChip";
import { recurrenceSentence } from "./series-sentence";

/** How many dates the card lists before pointing at the month view for the rest. */
const DATES_SHOWN = 6;

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
  const shown = members.slice(0, DATES_SHOWN);
  const rest = members.length - shown.length;
  const pageOf = (slug: string) => getPathname({ locale, href: { pathname: "/events/[slug]", params: { slug } } });

  return (
    <Card component="li" variant="outlined" sx={{ ...riseIn(index) }}>
      <CardContent>
        <Stack direction="row" spacing={1} sx={{ mb: 1, flexWrap: "wrap", gap: 1, alignItems: "center" }}>
          <EventKindChips type={next.type} surface={next.surface} />
          <GlyphChip glyph="series" variant="outlined" label={t("series.count", { count: members.length })} />
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

        {/* The coming dates, each a link to its own page; the month view has the rest. */}
        <Typography variant="body2" color="text.secondary" sx={{ mt: 2, mb: 0.5 }}>
          {t("series.allDates")}
        </Typography>
        <Box sx={{ display: "flex", flexWrap: "wrap", gap: 1, alignItems: "center" }}>
          {shown.map((member) => (
            <Chip
              key={member.id}
              component="a"
              href={pageOf(member.slug)}
              clickable
              variant="outlined"
              label={format.dateTime(member.startsAt, { timeZone: member.timezone, weekday: "short", day: "numeric", month: "short" })}
              sx={{ height: 44, borderRadius: 22, px: 0.5, ...(member.eventStatus === "CANCELLED" ? { textDecoration: "line-through" } : {}) }}
            />
          ))}
          {rest > 0 && (
            <Typography variant="body2" color="text.secondary">
              {t("series.moreInCalendar", { count: rest })}
            </Typography>
          )}
        </Box>
      </CardContent>
    </Card>
  );
}
