import HistoryIcon from "@mui/icons-material/History";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import { getTranslations } from "next-intl/server";
import EventCard from "@/modules/events/ui/EventCard";
import SeriesCard from "@/modules/events/ui/SeriesCard";
import { groupSeries, seriesLookup } from "@/modules/events/domain/series";
import { activeFilterCount, matchingPastEvents, type FilterFacts, type ListingFilter } from "@/modules/events/domain/listing-filter";
import type { PublicEvent } from "@/modules/events/repository";
import { DISCLOSURE_SUMMARY_SX, FOLD_GLYPH_SX } from "@/shared/ui/disclosure";
import { DENSITY } from "@/theme/density";
import { CARD_GRID_SX } from "@/modules/events/ui/card-layout";

/**
 * How many finished events the foot of the listing carries (§267).
 *
 * A weekly run is fifty rows a year, so this is a window rather than an archive: twelve is
 * about a season of Mondays, and the calendar — which shows any month of any year (§116) — is
 * where the rest lives. The section says so in its own words rather than growing a pager.
 */
export const PAST_EVENTS_SHOWN = 12;

/**
 * The events that have already happened, at the bottom of the listing, in their own category (§267).
 *
 * The owner: "old or closed events must be shown at the bottom on a different category". The
 * listing is "what is on next" and that is right, but an event the club held was reachable only
 * through the calendar's month view — so a runner looking for last month's race, or for the page
 * with its photographs, had nowhere obvious to go.
 *
 * **Folded at every width, unlike the "other events" fold above it**, which opens from `sm` up
 * (§78). That difference is the whole point: what is to come is what the page is for, and what
 * is past is something a reader goes looking for. A closed `<details>` is also a section that
 * costs a phone nothing to scroll past.
 *
 * **The listing's filters reach it** (§413, §NNN — the owner, 2026-10-01: «Mi-ar trebui aceleași
 * filtre și pentru evenimentele din trecut»): the same parsed address and the same predicate as the
 * cards above (`matchingPastEvents`), over the page's one cached window, and a filtered page opens
 * the fold. A filtered address is the live twin (§549), a route of its own, so a tick remounts the
 * page and a fold the reader had opened came back closed — the matches were there, behind a
 * heading nobody reads twice. Unfiltered, it stays closed as §267 has it.
 *
 * Between seasons the lead already shows the club's last event with a notice (§167), so this
 * section skips that one row: it would be the same card twice on one page.
 */
export default async function PastEvents({
  rows,
  now,
  filter,
  facts,
  shownAbove,
}: {
  /** The page's past window (§413), newest first, read beside the listing's own rows. */
  rows: readonly PublicEvent[];
  now: Date;
  /** The filters above (§272, §413) — the past narrows by them too, in memory. */
  filter: ListingFilter;
  facts: FilterFacts<PublicEvent>;
  /** The past event the lead already shows between seasons (§167), if any. */
  shownAbove: string | undefined;
}) {
  const filtered = activeFilterCount(filter) > 0;
  // The heading names the kind when one kind is all that is ticked, as `?type=` always did (§272).
  const sourceType = filter.type.length === 1 ? filter.type[0] : undefined;
  const events = matchingPastEvents(rows, filter, facts, shownAbove);
  if (events.length === 0) return null;

  const t = await getTranslations("Events");
  const tEvent = await getTranslations("Event");
  // A repeated event is one card here too (§113) — "Happy Monday" is one line, not eleven.
  const cards = groupSeries(events.slice(0, PAST_EVENTS_SHOWN));
  // A date left alone on its card by the filter or the cut still wears its series' rhythm (§486):
  // the series is read off every past row the page holds, before either.
  const seriesOf = seriesLookup(rows);
  const onlyOneType = sourceType !== undefined && activeFilterCount(filter) === 1;

  return (
    <Box
      component="details"
      data-testid="past-events"
      data-filtered={filtered ? "true" : undefined}
      open={filtered}
      sx={{ mt: { xs: DENSITY.sectionGapLg, sm: 4 } }}
    >
      <Typography component="summary" variant="h2" sx={{ ...DISCLOSURE_SUMMARY_SX, fontSize: "1.25rem", mb: 1.5 }}>
        <HistoryIcon aria-hidden sx={FOLD_GLYPH_SX} />
        {onlyOneType
          ? t("pastCountOfType", { count: cards.length, type: tEvent(`type.${sourceType}`) })
          : filtered
            ? t("pastCountFiltered", { count: cards.length })
            : t("pastCount", { count: cards.length })}
      </Typography>
      <Box component="ul" sx={CARD_GRID_SX}>
        {cards.map((series, index) =>
          series.members.length > 1 ? (
            <SeriesCard key={series.key} members={series.members} index={index} now={now} />
          ) : (
            <EventCard key={series.key} event={series.members[0]} index={index} now={now} seriesDates={seriesOf(series.members[0])} />
          ),
        )}
      </Box>
    </Box>
  );
}
