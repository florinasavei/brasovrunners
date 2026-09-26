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
  /** The first event of a series — it carries the repeat rule (§113). */
  repeats: boolean;
  /** Held with other organizers: the event names at least one partner (§344). */
  partnered: boolean;
};

/**
 * Whether an event is announced: published and scheduled, its start ahead, first published within
 * the window — and not the calendar's rhythm: never a repeated group run (§111, §113 — the weekly
 * run, source or date), nor a later date of any series. A group run held once is news like any
 * event. A special edition (§168) is always news, a special date of a series included: the
 * special-events topic would otherwise never hear of it.
 */
export function eventAlertWanted(event: AlertCandidate, now: Date): boolean {
  if (event.editorialStatus !== "PUBLISHED" || event.eventStatus !== "SCHEDULED") return false;
  const repeatedGroupRun = event.type === "GROUP_RUN" && (event.repeats || event.repeatOf !== null);
  if (!event.isSpecial && (repeatedGroupRun || event.repeatOf !== null)) return false;
  if (event.startsAt.getTime() <= now.getTime() || event.publishedAt === null) return false;
  return now.getTime() - event.publishedAt.getTime() <= EVENT_ALERT_WINDOW_DAYS * 24 * 60 * 60_000;
}

/**
 * The topics an event's announcement goes to: new events, always; the club's big days for a race;
 * special events — as the topic's own hint promises, "special editions, themed runs and events held
 * with other organizers" — for a special edition (§168), another organizer's event (`EXTERNAL`) and
 * an event held with partners (§344); gear testing for a gear test. A subscriber receives it when
 * they asked for everything or for any one of these (`receives`).
 */
export function eventAlertTopics(event: Pick<AlertCandidate, "type" | "isSpecial" | "partnered">): NewsletterTopic[] {
  const special = event.isSpecial || event.type === "EXTERNAL" || event.partnered;
  return [
    "NEW_EVENTS",
    ...(event.type === "RACE" ? (["BIG_EVENTS"] as const) : []),
    ...(special ? (["SPECIAL_EVENTS"] as const) : []),
    ...(event.type === "GEAR_TEST" ? (["GEAR_TESTING"] as const) : []),
  ];
}
