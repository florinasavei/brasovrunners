import { getPathname } from "@/i18n/navigation";
import { env } from "@/shared/config/env";
import { readCoHosts } from "./domain/co-hosts";
import { localizedSchedule, readScheduleItems } from "./domain/schedule";
import { type CalendarEvent, calendarRegistration, calendarStamp } from "./ical";
import type { PublicEvent } from "./repository";

type Locale = "ro" | "en";

/**
 * The public row as the calendar reads it (§107, §159): the page's absolute address, the
 * programme's rows in the reader's language, where registration stands with the form's
 * address, and a stamp that moves when that line does — the four things the row does not
 * carry. One function for the feed, the event's own file and Google's add-event link, so the
 * three never drift apart. Nothing is queried: every fact is on the row already.
 */
export function toCalendarEvent(event: PublicEvent, locale: Locale, now: Date): CalendarEvent {
  return {
    ...event,
    url: `${env.APP_BASE_URL}${getPathname({ locale, href: { pathname: "/events/[slug]", params: { slug: event.slug } } })}`,
    programme: localizedSchedule(readScheduleItems(event.scheduleItems), locale),
    // The partners, resolved here so the feed, the file and Google's link all read the row
    // the same way the page does (§168).
    coHosts: readCoHosts(event),
    registration: calendarRegistration(
      event,
      `${env.APP_BASE_URL}${getPathname({ locale, href: { pathname: "/events/[slug]/register", params: { slug: event.slug } } })}`,
      now,
    ),
    updatedAt: calendarStamp(event, now),
  };
}
