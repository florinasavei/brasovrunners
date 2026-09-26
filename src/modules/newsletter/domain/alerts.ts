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
};

/**
 * Whether an event is announced: published and scheduled, its start ahead, first published within
 * the window — and neither the weekly group run (§111), which is the calendar's rhythm rather than
 * news, nor a later date of a series.
 */
export function eventAlertWanted(event: AlertCandidate, now: Date): boolean {
  if (event.editorialStatus !== "PUBLISHED" || event.eventStatus !== "SCHEDULED") return false;
  if (event.type === "GROUP_RUN" || event.repeatOf !== null) return false;
  if (event.startsAt.getTime() <= now.getTime() || event.publishedAt === null) return false;
  return now.getTime() - event.publishedAt.getTime() <= EVENT_ALERT_WINDOW_DAYS * 24 * 60 * 60_000;
}

/**
 * The topics an event's announcement goes to: new events, always; the club's big days for a race;
 * special events for a special edition (§168); gear testing for a gear test. A subscriber receives
 * it when they asked for everything or for any one of these (`receives`).
 */
export function eventAlertTopics(event: Pick<AlertCandidate, "type" | "isSpecial">): NewsletterTopic[] {
  return [
    "NEW_EVENTS",
    ...(event.type === "RACE" ? (["BIG_EVENTS"] as const) : []),
    ...(event.isSpecial ? (["SPECIAL_EVENTS"] as const) : []),
    ...(event.type === "GEAR_TEST" ? (["GEAR_TESTING"] as const) : []),
  ];
}
