import { dayIn, latestBirthDateFor } from "@/modules/registrations/domain/age";

/**
 * The volunteers' tests say a person by their age; the form says it by a date of birth (§NNN) counted on the event's day. This is the
 * bridge: the latest birth date that makes a person exactly `years` old on the day `eventStartsAt` falls on in `timeZone` — the
 * boundary's own day, so a test of «seventeen» is a test of the last day of seventeen, never of a comfortable middle.
 */
export function bornAged(years: number, eventStartsAt: Date, timeZone = "Europe/Bucharest"): string {
  return latestBirthDateFor(years, dayIn(eventStartsAt, timeZone));
}

/** The same, with the event's day given as `YYYY-MM-DD` (the pure rules' tests have no event). */
export function bornAgedOn(years: number, eventDay: string): string {
  return latestBirthDateFor(years, eventDay);
}
