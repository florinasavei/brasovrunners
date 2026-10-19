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
 *
 * **«Vin!» is the one fact that is not on the row** (§815): how many say they come. A caller that has it — the feed, the
 * event's file, the emails' attachment — passes `coming` (`readComing`: id → count, present exactly where the page draws
 * «Confirmă prezența (opțional)»), and the description gains «Vin! → <page>#vin» and the count. The entry's stamp then moves to `now`: the
 * count changed with no write to the row, and a subscribed app that re-reads an entry only when its stamp moves would keep
 * the old number. Absent, the entry is what it was.
 */
export function toCalendarEvent(event: PublicEvent, locale: Locale, now: Date, options: { coming?: ReadonlyMap<string, number> } = {}): CalendarEvent {
  const count = options.coming?.get(event.id);
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
    coming: count === undefined ? null : { count },
    updatedAt: count === undefined ? calendarStamp(event, now) : now,
  };
}
