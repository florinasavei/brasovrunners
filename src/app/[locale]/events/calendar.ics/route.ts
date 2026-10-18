import { contentDisposition } from "@/shared/http/content-disposition";
import { getTranslations } from "next-intl/server";
import { routing } from "@/i18n/routing";
import { toCalendarEvent } from "@/modules/events/calendar";
import { buildCalendar, calendarFeedFileName } from "@/modules/events/ical";
import { cachedPublishedEventsBetween } from "@/modules/public-cache/reads";
import { holdPageUntil } from "@/modules/public-cache/page-lifetime";
import { eventClockInstants } from "@/modules/events/domain/page-clock";
import { readWithLastGood } from "@/modules/resilience/last-good";
import { readOrWhileAway } from "@/modules/resilience/optional-read";
import { readPublicComing } from "@/modules/rsvp/public-page";
import { env } from "@/shared/config/env";

/**
 * The club's calendar feed (`DECISIONS.md` §107): every published event from a month ago to
 * a year ahead, as one `.ics` that Google Calendar ("From URL"), Apple and Outlook subscribe
 * to and refresh on their own. Public.
 *
 * §129 kept it out of the CDN: the CDN's hour of cache served a time the organizer had changed,
 * and a stale copy is a runner at the wrong hour. That was an hour of cache *by the clock*. Since
 * §549 (amending §129 and §333) the feed is a static response the CDN keeps until a write expires
 * it — the rows behind it are the public cache's (§333), tagged, and the very save that changes a
 * time expires the rows and the file together — or until its clock says it reads differently: the
 * next UTC day (the window's own day), a registration door opening or closing (its description
 * says where registration stands). A subscriber's app asking a few times a day no longer starts a
 * function for each ask.
 *
 * **«Vin!» in the description** (§812): for an event whose page offers the answer, «Vin! → <page>#vin» and how many come.
 * The count is a cached read filed under "places" (`cachedRsvpCounts`), the tag a confirmation or a withdrawal expires, so the
 * feed is made again after each write to "places" (an answer, a registration) — once per write, never per poll, §549's rule
 * kept — and, with no ticked event ahead, the feed reads nothing it did not read before. While the database is away the lines are left out and the file is kept a minute.
 */
export const dynamic = "force-static";
/** A literal, as Next requires: `PUBLIC_PAGE_CEILING_SECONDS` (a test holds them together). */
export const revalidate = 86400;

/** Made on its first request, never at build: no database in CI (§549). */
export function generateStaticParams(): { locale: string }[] {
  return [];
}

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
  // Kept until the window's day turns, or an event's door or start changes what the file says (§549).
  await holdPageUntil([new Date(startOfUtcDay(now.getTime()) + DAY), ...events.flatMap((event) => eventClockInstants(event))], now);
  const t = await getTranslations({ locale: known, namespace: "Event" });
  // «Vin!» (§812): which of these the page offers the answer to, with how many come — one read for the whole feed.
  const coming = await readOrWhileAway(() => readPublicComing(events, now), new Map<string, number>());
  const body = buildCalendar({
    // Every detail the page has, in the description (§159); where registration stands is read against `now`.
    events: events.map((event) => toCalendarEvent(event, known, now, { coming })),
    baseUrl: env.APP_BASE_URL,
    name: t("calendar.feedName"),
    labels: { locale: known, t },
  });
  return new Response(body, {
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      // The club's name from the platform's constant (§357), never written in: "brasov-runners-ro.ics".
      "Content-Disposition": contentDisposition("inline", calendarFeedFileName(known), "calendar"),
      // No Cache-Control of its own (§549): Next writes the static response's, and a write expires the CDN's copy.
    },
  });
}
