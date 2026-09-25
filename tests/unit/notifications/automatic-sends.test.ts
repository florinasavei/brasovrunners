import { describe, expect, it } from "vitest";
import { DEFAULT_DEADLINES } from "@/modules/deadlines/domain/deadlines";
import {
  declarationLastCallDueAt,
  eventReminderDueAt,
  interestAction,
  isEventReminderDue,
  isParticipationConfirmationDue,
  nextInLineOffers,
  nextInLineReleases,
  participationConfirmationDueAt,
  registrationOpenedDueAt,
} from "@/modules/notifications/domain/automatic-sends";
import { wantedLapsedHoldReleases } from "@/modules/registrations/domain/capacity";

const NOW = new Date("2026-10-09T09:00:00.000Z");
const HOUR = 60 * 60_000;
const DAY = 24 * HOUR;
const at = (ms: number) => new Date(NOW.getTime() + ms);

/**
 * §383 — when the platform emails a participant on its own, as the pure functions the maintenance
 * job and the forecast on `/admin/emails` both ask. The boundaries are the ones the job's SQL
 * used to draw (§81, §104, §126, §146, §160, §377).
 */
describe("§383 when an automatic email is due", () => {
  const start = at(3 * DAY);

  it("reminds a reminder lead before the start — the event's own, the club's, or none", () => {
    expect(eventReminderDueAt({ startsAt: start, reminderHoursBefore: null, confirmedAt: null }, DEFAULT_DEADLINES)).toEqual(at(DAY));
    expect(eventReminderDueAt({ startsAt: start, reminderHoursBefore: 24, confirmedAt: null }, DEFAULT_DEADLINES)).toEqual(at(2 * DAY));
    expect(eventReminderDueAt({ startsAt: start, reminderHoursBefore: 0, confirmedAt: null }, DEFAULT_DEADLINES)).toBeNull();
    expect(eventReminderDueAt({ startsAt: start, reminderHoursBefore: null, confirmedAt: null }, { reminderHours: 0 })).toBeNull();
  });

  it("waits a day after a late confirmation (§126), and not past the start", () => {
    // Confirmed inside the lead: a day after the confirmation.
    expect(eventReminderDueAt({ startsAt: start, reminderHoursBefore: null, confirmedAt: at(1.5 * DAY) }, DEFAULT_DEADLINES)).toEqual(at(2.5 * DAY));
    // Confirmed less than a day before the start: no reminder at all.
    expect(eventReminderDueAt({ startsAt: start, reminderHoursBefore: null, confirmedAt: at(2.5 * DAY) }, DEFAULT_DEADLINES)).toBeNull();
  });

  it("is due from its moment until the start, never before and never after", () => {
    const candidate = { startsAt: start, reminderHoursBefore: null, confirmedAt: at(-2 * DAY) };
    expect(isEventReminderDue(candidate, at(DAY - 1), DEFAULT_DEADLINES)).toBe(false);
    expect(isEventReminderDue(candidate, at(DAY), DEFAULT_DEADLINES)).toBe(true);
    expect(isEventReminderDue(candidate, at(3 * DAY - 1), DEFAULT_DEADLINES)).toBe(true);
    expect(isEventReminderDue(candidate, start, DEFAULT_DEADLINES)).toBe(false);
  });

  it("puts the last call to sign at the reminder's lead", () => {
    expect(declarationLastCallDueAt({ startsAt: start, reminderHoursBefore: null }, DEFAULT_DEADLINES)).toEqual(at(DAY));
    expect(declarationLastCallDueAt({ startsAt: start, reminderHoursBefore: 0 }, DEFAULT_DEADLINES)).toBeNull();
  });

  it("asks for the participation confirmation when the window opens, only of a hold the window gave (§104)", () => {
    const race = { startsAt: at(8 * DAY), confirmationOpensDaysBefore: 7, confirmationDeadlineDaysBefore: 2 };
    const windowHold = { ...race, holdExpiresAt: at(6 * DAY) };
    expect(participationConfirmationDueAt(windowHold, NOW)).toEqual(at(DAY));
    expect(isParticipationConfirmationDue(windowHold, at(DAY - 1))).toBe(false);
    expect(isParticipationConfirmationDue(windowHold, at(DAY))).toBe(true);
    // The club's thirty-minute hold, taken inside the window: somebody signing now.
    expect(isParticipationConfirmationDue({ ...race, holdExpiresAt: at(2 * DAY + 30 * 60_000) }, at(2 * DAY))).toBe(false);
    // Already open, still owed: at once.
    expect(participationConfirmationDueAt(windowHold, at(3 * DAY))).toEqual(at(3 * DAY));
    // Past the deadline, or no window: never.
    expect(participationConfirmationDueAt(windowHold, at(6 * DAY))).toBeNull();
    expect(participationConfirmationDueAt({ ...windowHold, confirmationOpensDaysBefore: 0 }, NOW)).toBeNull();
  });

  it("offers a lapsed place to the next in line while anybody waits, and not after the start", () => {
    const lapses = [at(20 * HOUR), at(DAY), at(DAY), at(-HOUR), at(5 * DAY)];
    expect(nextInLineOffers({ lapses, waiting: 3, startsAt: at(4 * DAY), registrationClosesAt: null, now: NOW })).toEqual([
      { at: NOW, count: 1 },
      { at: at(20 * HOUR), count: 1 },
      { at: at(DAY), count: 1 },
    ]);
    expect(nextInLineOffers({ lapses, waiting: 0, startsAt: at(4 * DAY), registrationClosesAt: null, now: NOW })).toEqual([]);
    expect(nextInLineOffers({ lapses: [at(5 * DAY)], waiting: 2, startsAt: at(4 * DAY), registrationClosesAt: null, now: NOW })).toEqual([]);
  });

  it("offers nobody a place from the close on, while the release still spends the person waiting (§420)", () => {
    // Registration closes in a day: an offer made at or after it would be born lapsed, and
    // `fillAvailableSpots` makes none (BR-REQ-035-02 criterion 3).
    const lapses = [at(20 * HOUR), at(DAY), at(2 * DAY)];
    const input = { lapses, waiting: 3, startsAt: at(4 * DAY), registrationClosesAt: at(DAY), now: NOW };
    expect(nextInLineOffers(input)).toEqual([{ at: at(20 * HOUR), count: 1 }]);
    // The job still releases the lapses to the queue — the desk gives those places — so each one
    // after the close still spends a person waiting, and is owed no last call.
    expect(nextInLineReleases(input)).toEqual([
      { at: at(20 * HOUR), count: 1 },
      { at: at(DAY), count: 1 },
      { at: at(2 * DAY), count: 1 },
    ]);
    // A close already behind: nothing is offered, not even at the job's next run.
    expect(nextInLineOffers({ ...input, lapses: [at(-HOUR)], registrationClosesAt: at(-2 * HOUR) })).toEqual([]);
    // A close after the start caps nothing the start does not.
    expect(nextInLineOffers({ ...input, registrationClosesAt: at(5 * DAY) })).toEqual(nextInLineReleases(input));
  });

  it("counts the same releases as the job's own wantedLapsedHoldReleases when nothing is free (§160)", () => {
    // A lapse is only ever released to a queue at all when the queue wants it — `free` is 0 at
    // that instant — which is the one case `nextInLineReleases` (the forecast's own arithmetic) and
    // `wantedLapsedHoldReleases` (the job's) both cover, so their counts must agree there.
    const lapses = [at(20 * HOUR), at(DAY), at(2 * DAY)];
    for (const waiting of [0, 1, 2, 3, 5]) {
      const released = nextInLineReleases({ lapses, waiting, startsAt: at(10 * DAY), now: NOW }).reduce((sum, release) => sum + release.count, 0);
      expect(released).toBe(wantedLapsedHoldReleases({ lapsed: lapses.length, waiting, free: 0 }));
    }
  });

  it("announces an opened registration to the addresses left, once it is open and published (§146)", () => {
    const event = {
      registrationMode: "INTERNAL" as const,
      eventStatus: "SCHEDULED" as const,
      editorialStatus: "PUBLISHED",
      startsAt: at(20 * DAY),
      registrationOpensAt: at(2 * DAY),
      registrationClosesAt: null,
      publishedAt: at(-DAY),
    };
    expect(interestAction(event, NOW)).toBe("wait");
    expect(interestAction(event, at(2 * DAY))).toBe("announce");
    expect(interestAction({ ...event, editorialStatus: "DRAFT" }, at(2 * DAY))).toBe("wait");
    expect(interestAction({ ...event, eventStatus: "CANCELLED" }, at(2 * DAY))).toBe("drop");
    expect(registrationOpenedDueAt(event, NOW)).toEqual(at(2 * DAY));
    expect(registrationOpenedDueAt({ ...event, editorialStatus: "DRAFT" }, NOW)).toBeNull();
  });
});
