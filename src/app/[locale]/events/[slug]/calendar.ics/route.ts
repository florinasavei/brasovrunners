import { getTranslations } from "next-intl/server";
import { routing } from "@/i18n/routing";
import { toCalendarEvent } from "@/modules/events/calendar";
import { buildCalendar } from "@/modules/events/ical";
import { cachedPublishedEventBySlug } from "@/modules/public-cache/reads";
import { env } from "@/shared/config/env";

/**
 * "Add to my calendar" (`DECISIONS.md` §107): this event as an `.ics` file — Apple Calendar,
 * Outlook and the phone's own app open it; Google gets a direct link from the page instead.
 * Public, like the event; the file says nothing the page does not — and reads the same cached
 * row the page does (§333).
 */
export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: Promise<{ locale: string; slug: string }> }) {
  const { locale, slug } = await params;
  const known = routing.locales.find((candidate) => candidate === locale);
  const event = known ? await cachedPublishedEventBySlug(known, slug) : undefined;
  if (!known || !event) return new Response("Not found", { status: 404 });
  const t = await getTranslations({ locale: known, namespace: "Event" });
  const body = buildCalendar({
    // Every detail the page has, in the description (§159).
    events: [toCalendarEvent(event, known, new Date())],
    baseUrl: env.APP_BASE_URL,
    name: event.title,
    labels: { locale: known, t },
  });
  return new Response(body, {
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": `attachment; filename="${slug}.ics"`,
      "Cache-Control": "no-cache",
    },
  });
}
