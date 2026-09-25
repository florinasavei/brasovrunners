import type { events } from "@/db/schema/events";
import type { EventForRegistration } from "./service";

type Event = typeof events.$inferSelect;

/**
 * The event as the public registration form hands it to the allocator (§420): every field a
 * decision behind that form rests on, read off the event's own row.
 *
 * One function for both of the form's doors — the ordinary submission and the link for another
 * person on the same address (§389) — because each used to build its own literal, and both left
 * out the participation window (§104). `confirmationWindow()` reads an absent window as none, so a
 * verified runner restarting a cancelled registration weeks before a race was given the club's
 * thirty-minute hold (§377) rather than the window's deadline, and lost the place to the waiting
 * list half an hour later. Every other door already passed the window (`token-actions.ts`,
 * `admin-service.ts`, `my-registrations.ts`, `maintenance.ts`); this one now does too.
 *
 * `publishedAt` is the public row's, as the form always passed: the page the person submitted from.
 */
export function publicFormEvent(
  row: Pick<
    Event,
    | "id"
    | "eventStatus"
    | "registrationMode"
    | "startsAt"
    | "registrationOpensAt"
    | "registrationClosesAt"
    | "capacity"
    | "raceId"
    | "timezone"
    | "minAge"
    | "confirmationOpensDaysBefore"
    | "confirmationDeadlineDaysBefore"
    | "reminderHoursBefore"
  >,
  publishedAt: Date | null,
): EventForRegistration {
  return {
    id: row.id,
    eventStatus: row.eventStatus,
    registrationMode: row.registrationMode,
    startsAt: row.startsAt,
    registrationOpensAt: row.registrationOpensAt,
    registrationClosesAt: row.registrationClosesAt,
    capacity: row.capacity,
    raceId: row.raceId,
    publishedAt,
    // The day the minimum age is counted against is the race's own (§321), and so is the number (§329).
    timezone: row.timezone,
    minAge: row.minAge,
    // The participation window (§104): a hold made behind this form is the window's, as at every other door.
    confirmationOpensDaysBefore: row.confirmationOpensDaysBefore,
    confirmationDeadlineDaysBefore: row.confirmationDeadlineDaysBefore,
    // The event's own reminder lead (§377), for when the job next has work (§334).
    reminderHoursBefore: row.reminderHoursBefore,
  };
}
