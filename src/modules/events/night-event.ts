import { env } from "@/shared/config/env";
import { nightEvent, type NightEventFacts, type NightEventSource } from "./domain/night";

/**
 * `nightEvent` at the club's own place (`CLUB_COORDINATES`, §394) — the binding every server
 * surface calls, so the coordinates are read in one place. The occurrence is the row's own start
 * unless the caller names another: a series' dates are rows of their own (§113), each with its
 * own start and so its own sunset.
 */
export function clubNightEvent(event: NightEventSource & { startsAt: Date }, occurrenceStartsAt: Date | null = event.startsAt): NightEventFacts {
  return nightEvent(event, occurrenceStartsAt, env.CLUB_COORDINATES);
}
