import { getTranslations } from "next-intl/server";
import { getDb } from "@/db/client";
import { getPathname } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";
import { localizedSchedule, readScheduleItems } from "@/modules/events/domain/schedule";
import { buildCalendar } from "@/modules/events/ical";
import { findPublishedEventBySlug } from "@/modules/events/repository";
import { env } from "@/shared/config/env";

/**
 * "Add to my calendar" (`DECISIONS.md` §107): this event as an `.ics` file — Apple Calendar,
 * Outlook and the phone's own app open it; Google gets a direct link from the page instead.
 * Public, like the event; the file says nothing the page does not.
 */
export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: Promise<{ locale: string; slug: string }> }) {
  const { locale, slug } = await params;
  const known = routing.locales.find((candidate) => candidate === locale);
  const event = known ? await findPublishedEventBySlug(getDb(), known, slug) : undefined;
  if (!known || !event) return new Response("Not found", { status: 404 });
  const t = await getTranslations({ locale: known, namespace: "Event" });
  const url = `${env.APP_BASE_URL}${getPathname({ locale: known, href: { pathname: "/events/[slug]", params: { slug } } })}`;
  const body = buildCalendar({
    events: [{ ...event, url, programme: localizedSchedule(readScheduleItems(event.scheduleItems), known) }],
    baseUrl: env.APP_BASE_URL,
    name: event.title,
    labels: { programme: t("schedule"), locale: known },
  });
  return new Response(body, {
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": `attachment; filename="${slug}.ics"`,
      "Cache-Control": "no-cache",
    },
  });
}
