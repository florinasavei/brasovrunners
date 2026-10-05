import { confirmationWindow } from "@/modules/registrations/domain/hold-deadlines";
import { publicListClosesAt, type Deadlines } from "@/modules/deadlines/domain/deadlines";
import { WEATHER_WINDOW_DAYS, weatherInstant } from "@/modules/weather/domain/forecast";
import { readsForecast } from "@/modules/weather/domain/mode";
import { SIGNING_GRACE_MINUTES } from "@/modules/group-run-declarations/domain";
import { registrationClosesOrStarts } from "./registration-window";
import { fromWallTimeInput, toWallTimeInput } from "./zoned-time";

/**
 * The instants at which a public page that shows an event reads differently, with nothing written
 * in between (§549, amending §333): a static page is kept until the first of them, so the CDN never
 * serves a door as open after it closed for longer than one visit — the one visit that asks for
 * the new copy.
 *
 * Pure, and it says nothing about *what* changes — the page works that out again when it is
 * rendered. It only has to name every moment something could: an instant too many costs one
 * render; an instant missing is a page wrong until midnight (`nextWallMidnight`, which every such
 * page adds) or the next write.
 *
 * Covered here, per event:
 * - the start, the race's own start and the end — upcoming becomes past, the countdown and the
 *   desk's words (§76–§79);
 * - the group run's signing close, `SIGNING_GRACE_MINUTES` after the start (§393, `signingOpen`),
 *   where the declaration's section leaves the page — named for every event, since an instant too
 *   many costs one render and the page clock does not know which events offer one;
 * - the registration window — opens, closes (`registrationState`, the door §409, «în curând» §451,
 *   the interest box §146);
 * - the weather window — seven days before the start the forecast line appears (§402), and from
 *   then the forecast's own one-hour cache keeps the page to the hour by itself;
 * - the confirmation window's two instants (§104, §407) — the five steps and the door's words;
 * - the public list's end (§421) when the club's deadlines are given.
 *
 * Not here, because the reads already key them by the clock (`public-cache/reads.ts` holds the page
 * to the next of those instants itself): an event passing into the past on the listing, a
 * waiting-list offer lapsing in the free places, a legal version taking effect.
 */
type ClockedEvent = {
  startsAt: Date | null;
  raceStartsAt?: Date | null;
  endsAt?: Date | null;
  registrationOpensAt?: Date | null;
  registrationClosesAt?: Date | null;
  confirmationOpensDaysBefore?: number | null;
  confirmationDeadlineDaysBefore?: number | null;
  /** «Vremea» (§NNN); absent reads as the forecast. */
  weatherMode?: string | null;
};

const DAY_MS = 24 * 60 * 60_000;

export function eventClockInstants(event: ClockedEvent, deadlines?: Pick<Deadlines, "publicListDays">): Date[] {
  const instants: (Date | null | undefined)[] = [event.registrationOpensAt];
  const startsAt = event.startsAt;
  if (startsAt) {
    instants.push(startsAt, event.raceStartsAt, event.endsAt, new Date(startsAt.getTime() + SIGNING_GRACE_MINUTES * 60_000));
    instants.push(registrationClosesOrStarts({ registrationClosesAt: event.registrationClosesAt ?? null, startsAt }));
    // Only an event whose weather is the forecast has a window to open (§NNN): the club's own text
    // and «Fără vreme» read the same on every day, and no forecast keeps such a page to the hour.
    if (readsForecast(event)) instants.push(new Date(weatherInstant({ startsAt, raceStartsAt: event.raceStartsAt }).getTime() - WEATHER_WINDOW_DAYS * DAY_MS));
    const window = confirmationWindow({ ...event, startsAt });
    if (window) instants.push(window.opensAt, window.deadline);
    if (deadlines) instants.push(publicListClosesAt({ startsAt, endsAt: event.endsAt }, deadlines));
  } else {
    instants.push(event.registrationClosesAt);
  }
  return instants.filter((instant): instant is Date => instant instanceof Date && !Number.isNaN(instant.getTime()));
}

/**
 * The next midnight on `timeZone`'s wall clock after `now`: where "în 3 zile" becomes "în 2 zile",
 * "azi" becomes "ieri" and a calendar's month turns (§76, §116). Every page that says a day relative
 * to today adds it, so none of those words outlives its day.
 */
export function nextWallMidnight(now: Date, timeZone: string): Date {
  const [year, month, day] = toWallTimeInput(now, timeZone).slice(0, 10).split("-").map(Number);
  const tomorrow = new Date(Date.UTC(year, month - 1, day + 1)).toISOString().slice(0, 10);
  return fromWallTimeInput(`${tomorrow}T00:00`, timeZone) ?? new Date(now.getTime() + DAY_MS);
}
