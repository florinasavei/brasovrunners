import { getTranslations } from "next-intl/server";
import { routing } from "@/i18n/routing";
import { toCalendarEvent } from "@/modules/events/calendar";
import { buildCalendar } from "@/modules/events/ical";
import { datedOrNull } from "@/modules/events/domain/dated";
import { eventClockInstants } from "@/modules/events/domain/page-clock";
import { holdPageUntil } from "@/modules/public-cache/page-lifetime";
import { eventBySlugWithLastGood } from "@/modules/resilience/event-copy";
import { env } from "@/shared/config/env";

/**
 * "Add to my calendar" (`DECISIONS.md` §107): this event as an `.ics` file — Apple Calendar,
 * Outlook and the phone's own app open it; Google gets a direct link from the page instead.
 * Public, like the event; the file says nothing the page does not — and reads the same cached
 * row the page does (§333).
 *
 * Static, like the page (§549, amending §129 and §333): made on its first request, kept by the CDN
 * until a save of the event expires the row it was made from (the row's tag files the file too), or
 * until the event's own clock changes what its description says. A literal, as Next requires:
 * `PUBLIC_PAGE_CEILING_SECONDS` (a test holds them together).
 */
export const dynamic = "force-static";
export const revalidate = 86400;

/** Made on its first request, never at build: no event is known before the database is asked (§549). */
export function generateStaticParams(): { locale: string; slug: string }[] {
  return [];
}

export async function GET(_request: Request, { params }: { params: Promise<{ locale: string; slug: string }> }) {
  const { locale, slug } = await params;
  const known = routing.locales.find((candidate) => candidate === locale);
  const found = known ? await eventBySlugWithLastGood(known, slug) : undefined;
  // No file while the date is to be announced (§533): a calendar entry is a date, and the page offers none.
  const event = found ? datedOrNull(found) : null;
  if (!known || !event) return new Response("Not found", { status: 404 });
  const now = new Date();
  // Where registration stands is in the description (§159): kept until the door's next change (§549).
  await holdPageUntil(eventClockInstants(event), now);
  const t = await getTranslations({ locale: known, namespace: "Event" });
  const body = buildCalendar({
    // Every detail the page has, in the description (§159).
    events: [toCalendarEvent(event, known, now)],
    baseUrl: env.APP_BASE_URL,
    name: event.title,
    labels: { locale: known, t },
  });
  return new Response(body, {
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": `attachment; filename="${slug}.ics"`,
      // No Cache-Control of its own (§549): Next writes the static response's, and a save expires the CDN's copy.
    },
  });
}
