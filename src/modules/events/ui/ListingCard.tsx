import type { WeatherReading } from "@/modules/weather/domain/forecast";
import type { PublicEvent } from "../repository";
import EventCard from "./EventCard";
import SeriesCard from "./SeriesCard";

export type ListingCardProps = {
  /** The dates of one card, soonest first (`groupSeries`, §113): two or more are a series, one a single event. */
  members: readonly PublicEvent[];
  /** The rise-in order on the page (`theme/motion.ts`). */
  index: number;
  now: Date;
  /** The forecast at the first date's start (§416), the date whose facts the card shows; null outside the seven days. */
  weather?: WeatherReading | null;
  /**
   * Every date of the repeated event a single date belongs to (§486), read off the whole list before
   * any filter (`seriesLookup`): the one-date card then wears the series card's repeat chip.
   */
  seriesDates?: readonly { startsAt: Date }[];
};

/**
 * One card of the listing «Alergări», whichever it is: a series is `SeriesCard`, a single date is
 * `EventCard` (§113, §366). The listing's grid and the home page's run sections both draw their
 * cards through it (§NNN), so what a run looks like is decided in one place and the two pages cannot
 * drift apart. The lead event (`EventCard`'s `featured`, §470) is the listing's own and stays there.
 *
 * A Server Component: rows in, the listing's markup out — no element crosses into a client component (§370).
 */
export default function ListingCard({ members, index, now, weather = null, seriesDates }: ListingCardProps) {
  return members.length > 1 ? (
    <SeriesCard members={members} index={index} now={now} weather={weather} />
  ) : (
    <EventCard event={members[0]} index={index} now={now} weather={weather} seriesDates={seriesDates} />
  );
}
