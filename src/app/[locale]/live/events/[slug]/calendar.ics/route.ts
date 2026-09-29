import { getTranslations } from "next-intl/server";
import { routing } from "@/i18n/routing";
import { toCalendarEvent } from "@/modules/events/calendar";
import { buildCalendar } from "@/modules/events/ical";
import { datedOrNull } from "@/modules/events/domain/dated";
import { membersEventBySlug } from "@/modules/events/members-only";
import { env } from "@/shared/config/env";

/**
 * A members' event's "Add to my calendar" (§552; the file itself is §107's): the static `.ics`
 * beside the event page is `force-static` and reads the public row, which never meets a members'
 * event, so this twin answers the one link a members' page gives (§549's live twin, as a file).
 *
 * Per request: it asks the account (`events/members-only.ts`) and reads the event live, never
 * through the public cache or a last good copy. Only a members' event, only for a members' session;
 * anybody else, and every public event (whose file is the static one), gets the 404 an unknown slug
 * gives. Never kept by a shared cache or the browser, and never indexed.
 */
export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: Promise<{ locale: string; slug: string }> }) {
  const { locale, slug } = await params;
  const known = routing.locales.find((candidate) => candidate === locale);
  const found = known ? await membersEventBySlug(known, slug) : undefined;
  // No file while the date is to be announced (§533): a calendar entry is a date, and the page offers none.
  const event = found ? datedOrNull(found) : null;
  if (!known || !event) return new Response("Not found", { status: 404, headers: { "Cache-Control": "private, no-store, max-age=0" } });
  const t = await getTranslations({ locale: known, namespace: "Event" });
  const body = buildCalendar({
    events: [toCalendarEvent(event, known, new Date())],
    baseUrl: env.APP_BASE_URL,
    name: event.title,
    labels: { locale: known, t },
  });
  return new Response(body, {
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": `attachment; filename="${slug}.ics"`,
      // A members' file is nobody else's (§552).
      "Cache-Control": "private, no-store, max-age=0",
      "X-Robots-Tag": "noindex, nofollow",
    },
  });
}
