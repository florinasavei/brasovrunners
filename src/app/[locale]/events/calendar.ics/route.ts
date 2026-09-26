import { getTranslations } from "next-intl/server";
import { routing } from "@/i18n/routing";
import { toCalendarEvent } from "@/modules/events/calendar";
import { buildCalendar, calendarFeedFileName } from "@/modules/events/ical";
import { cachedPublishedEventsBetween } from "@/modules/public-cache/reads";
import { readWithLastGood } from "@/modules/resilience/last-good";
import { env } from "@/shared/config/env";

/**
 * The club's calendar feed (`DECISIONS.md` §107): every published event from a month ago to
 * a year ahead, as one `.ics` that Google Calendar ("From URL"), Apple and Outlook subscribe
 * to and refresh on their own. Public. Never cached by the CDN (§129): the CDN's hour of cache
 * served a time the organizer had changed, and a stale copy is a runner at the wrong hour.
 *
 * The rows behind it are cached (§333), which is not the same thing: the public cache is expired
 * by the very save that changes a time, so a subscriber's app asking a few times a day reads the
 * organizer's latest words without waking the database for each ask.
 */
export const dynamic = "force-dynamic";

const DAY = 24 * 60 * 60_000;

/** Midnight UTC at or before `time` — the whole days the cached rows are asked for. */
const startOfUtcDay = (time: number) => Math.floor(time / DAY) * DAY;

export async function GET(_request: Request, { params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const known = routing.locales.find((candidate) => candidate === locale);
  if (!known) return new Response("Not found", { status: 404 });
  const now = new Date();
  /*
    The window is a month back and a year ahead of *this instant*, which would make a new cache
    key every millisecond. So whole days are read — a day before the window's start to a day after
    its end, the same key all day — and the exact window is cut from them here, which is what the
    feed carried before to the millisecond.
  */
  const from = now.getTime() - 30 * DAY;
  const to = now.getTime() + 365 * DAY;
  // With its last good copy behind it (§447): a subscribed calendar that refreshes during an
  // outage keeps the club's events rather than being told the feed is gone. One copy per
  // language — the key names the feed, not the day, so the store holds one object, not one a day.
  const days = (
    await readWithLastGood(`ics-feed:${known}`, () => cachedPublishedEventsBetween(known, new Date(startOfUtcDay(from)), new Date(startOfUtcDay(to) + DAY)), now)
  ).value;
  const events = days.filter((event) => event.startsAt.getTime() >= from && event.startsAt.getTime() < to);
  const t = await getTranslations({ locale: known, namespace: "Event" });
  const body = buildCalendar({
    // Every detail the page has, in the description (§159); where registration stands is read against `now`.
    events: events.map((event) => toCalendarEvent(event, known, now)),
    baseUrl: env.APP_BASE_URL,
    name: t("calendar.feedName"),
    labels: { locale: known, t },
  });
  return new Response(body, {
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      // The club's name from the platform's constant (§357), never written in: "brasov-runners-ro.ics".
      "Content-Disposition": `inline; filename="${calendarFeedFileName(known)}"`,
      "Cache-Control": "no-cache",
    },
  });
}
