import { dayIn, latestBirthDateFor } from "@/modules/registrations/domain/age";

/**
 * The volunteers' tests say a person by their age; the form says it by a date of birth (§773) counted on the event's day. This is the
 * bridge: the latest birth date that makes a person `years` old on the day `eventStartsAt` falls on in `timeZone` — the day they
 * turn `years` is that very day, so a test of «eighteen» is a test of someone who turned eighteen the morning of the race, and the
 * day after it is someone who turns eighteen tomorrow: the boundary's own day, never a comfortable middle.
 */
export function bornAged(years: number, eventStartsAt: Date, timeZone = "Europe/Bucharest"): string {
  return latestBirthDateFor(years, dayIn(eventStartsAt, timeZone));
}

/** The same, with the event's day given as `YYYY-MM-DD` (the pure rules' tests have no event). */
export function bornAgedOn(years: number, eventDay: string): string {
  return latestBirthDateFor(years, eventDay);
}
