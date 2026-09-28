import { getTranslations } from "next-intl/server";
import { routing } from "@/i18n/routing";
import { toCalendarEvent } from "@/modules/events/calendar";
import { buildCalendar } from "@/modules/events/ical";
import { datedOrNull } from "@/modules/events/domain/dated";
import { membersEventBySlug } from "@/modules/events/members-only";
import { eventBySlugWithLastGood } from "@/modules/resilience/event-copy";
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
  const publicRow = known ? await eventBySlugWithLastGood(known, slug) : undefined;
  // A members' event (§NNN): its file for a members' session only, read live and never cached.
  const membersRow = known && !publicRow ? await membersEventBySlug(known, slug) : undefined;
  const found = publicRow ?? membersRow;
  // No file while the date is to be announced (§533): a calendar entry is a date, and the page offers none.
  const event = found ? datedOrNull(found) : null;
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
      // A members' file is nobody else's: never kept by a shared cache or the browser (§NNN).
      "Cache-Control": membersRow ? "private, no-store, max-age=0" : "no-cache",
      ...(membersRow ? { "X-Robots-Tag": "noindex, nofollow" } : {}),
    },
  });
}
