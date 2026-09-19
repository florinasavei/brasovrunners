import { getTranslations } from "next-intl/server";
import { getDb } from "@/db/client";
import { getPathname } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";
import { localizedSchedule, readScheduleItems } from "@/modules/events/domain/schedule";
import { buildCalendar } from "@/modules/events/ical";
import { listPublishedEventsBetween } from "@/modules/events/repository";
import { env } from "@/shared/config/env";

/**
 * The club's calendar feed (`DECISIONS.md` §107): every published event from a month ago to
 * a year ahead, as one `.ics` that Google Calendar ("From URL"), Apple and Outlook subscribe
 * to and refresh on their own. Public. Never cached (§129): the CDN's hour of cache served a
 * time the organizer had changed, and a subscriber's app asks a few times a day at most — one
 * read per ask is nothing, a stale copy is a runner at the wrong hour.
 */
export const dynamic = "force-dynamic";

const DAY = 24 * 60 * 60_000;

export async function GET(_request: Request, { params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const known = routing.locales.find((candidate) => candidate === locale);
  if (!known) return new Response("Not found", { status: 404 });
  const now = new Date();
  const events = await listPublishedEventsBetween(getDb(), known, new Date(now.getTime() - 30 * DAY), new Date(now.getTime() + 365 * DAY));
  const t = await getTranslations({ locale: known, namespace: "Event" });
  const body = buildCalendar({
    events: events.map((event) => ({
      ...event,
      url: `${env.APP_BASE_URL}${getPathname({ locale: known, href: { pathname: "/events/[slug]", params: { slug: event.slug } } })}`,
      programme: localizedSchedule(readScheduleItems(event.scheduleItems), known),
    })),
    baseUrl: env.APP_BASE_URL,
    name: t("calendar.feedName"),
    labels: { programme: t("schedule"), locale: known },
  });
  return new Response(body, {
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": `inline; filename="brasov-runners-${known}.ics"`,
      "Cache-Control": "no-cache",
    },
  });
}
