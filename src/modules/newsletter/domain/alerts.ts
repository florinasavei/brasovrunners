import type { NewsletterTopic } from "@/db/schema/newsletter";

/**
 * "A new event is on the calendar" (§NNN): which events the platform announces by itself, and to
 * which topics. Pure, so the job and its test read one rule.
 */

/**
 * How long after its first publication an event is still news. The job announces an event on its
 * first run after publication — minutes, with the save waking it (§334) — and this bound is what
 * keeps the first run after this feature is deployed from announcing every event already on the
 * calendar, and an event published, taken down and put back months later from being "new" again.
 * It is also how long an event may wait its turn behind the one-a-day rule (`alertDayOf`).
 */
export const EVENT_ALERT_WINDOW_DAYS = 7;

export type AlertCandidate = {
  type: string;
  isSpecial: boolean;
  editorialStatus: string;
  eventStatus: string;
  startsAt: Date;
  publishedAt: Date | null;
  /** A date of a series (§122): the series is announced by its first event, never date by date. */
  repeatOf: string | null;
  /** Held with other organizers: the event names at least one partner (§344). */
  partnered: boolean;
};

/**
 * Whether an event is announced: published and scheduled, its start ahead, first published within
 * the window — and **once per series**: a series (the weekly group run above all, §111, §113) is
 * announced by its first event, the one carrying the repeat rule, and never by the dates the
 * series creates after it. A special edition (§168) is news on its own, a special date of a series
 * included: the special-events topic would otherwise never hear of it. A cancelled or unpublished
 * event is never announced (§331: a cancelled event goes quiet), and one cancelled while its alert
 * waited is withdrawn as it leaves (`render.ts`).
 */
export function eventAlertWanted(event: AlertCandidate, now: Date): boolean {
  if (event.editorialStatus !== "PUBLISHED" || event.eventStatus !== "SCHEDULED") return false;
  if (event.repeatOf !== null && !event.isSpecial) return false;
  if (event.startsAt.getTime() <= now.getTime() || event.publishedAt === null) return false;
  return now.getTime() - event.publishedAt.getTime() <= EVENT_ALERT_WINDOW_DAYS * 24 * 60 * 60_000;
}

/**
 * The topics an event's announcement goes to (the brief's own mapping, 2026-09-26):
 *
 * - a race → «Evenimente mari» — the club's big days;
 * - a group run — a new weekly series, or one held once → «Alergările săptămânale»;
 * - another organizer's event (`EXTERNAL`), an event held with partners (§344) or a special edition
 *   (§168) → «Evenimente speciale»;
 * - a gear test → «Testări de încălțăminte».
 *
 * An event none of these describes — a hike, a coffee — goes to «Toate noutățile» alone (`ALL`):
 * the subscriber who asked for everything hears of it, nobody else. A subscriber receives the
 * announcement when they asked for everything or for any one of its topics (`receives`).
 */
export function eventAlertTopics(event: Pick<AlertCandidate, "type" | "isSpecial" | "partnered">): NewsletterTopic[] {
  const special = event.isSpecial || event.type === "EXTERNAL" || event.partnered;
  const topics: NewsletterTopic[] = [
    ...(event.type === "RACE" ? (["BIG_EVENTS"] as const) : []),
    ...(event.type === "GROUP_RUN" ? (["WEEKLY_RUNS"] as const) : []),
    ...(special ? (["SPECIAL_EVENTS"] as const) : []),
    ...(event.type === "GEAR_TEST" ? (["GEAR_TESTING"] as const) : []),
  ];
  return topics.length > 0 ? topics : ["ALL"];
}

/**
 * The club's calendar day an instant falls on, "2026-09-26", in the club's zone. **Never two
 * announcements in one day**: the job queues at most one new-event alert that reaches somebody per
 * club day — a second event published the same day is announced on the next, oldest publication
 * first, while it is still within the window. A subscriber's inbox gets one "new on the calendar" a
 * day at most, whatever the organizers publish.
 */
export function alertDayOf(at: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(at);
  const part = (type: string) => parts.find((entry) => entry.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}
