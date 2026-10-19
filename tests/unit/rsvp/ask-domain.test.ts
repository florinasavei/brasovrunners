import { describe, expect, it } from "vitest";
import {
  DEFAULT_RSVP_ASK_TIMING,
  rsvpAskClock,
  rsvpAskDaysAway,
  rsvpAskDue,
  rsvpAskLookAheadMs,
  rsvpAskNextLook,
  rsvpAskWindow,
} from "@/modules/rsvp/domain/ask";
import { rsvpAskDayPhrase } from "@/modules/rsvp/domain/ask-words";
import { AUTOMATIC_TOPICS, isSendableTopic, NEWSLETTER_TOPICS, normalizeTopics, receives, SENDABLE_TOPICS } from "@/modules/newsletter/domain/topics";

/**
 * §818 (builds on §812, amends §775) — «Vii mâine la …?»: WHEN the question goes (the club's calendar day before, from 08:00 club time, until
 * the midnight that opens the event's day, across both changes of the clock) and WHO is asked (the subscribers of the topic and of
 * "everything" — the one `receives` rule — and nobody through the composer).
 *
 * The club's zone is Europe/Bucharest: UTC+3 in summer time, UTC+2 in winter time; the changes are the last Sunday of March (03:00 → 04:00)
 * and of October (04:00 → 03:00).
 */
describe("§818 «Vii mâine la …?» — the window", () => {
  it("opens at 08:00 club time on the day before and closes at the midnight that opens the event's day", () => {
    // Saturday 2026-10-17, summer time (UTC+3): the run is at 10:00 on Sunday the 18th.
    const startsAt = new Date("2026-10-18T07:00:00.000Z");
    const window = rsvpAskWindow(startsAt);
    expect(window?.opensAt.toISOString()).toBe("2026-10-17T05:00:00.000Z");
    expect(window?.closesAt.toISOString()).toBe("2026-10-17T21:00:00.000Z");
    // The defaults are what the platform did before the club could choose: the day before, from 08:00.
    expect(DEFAULT_RSVP_ASK_TIMING).toEqual({ daysBefore: 1, hour: 8 });
    expect(rsvpAskClock(DEFAULT_RSVP_ASK_TIMING.hour)).toBe("08:00");
    expect(rsvpAskWindow(startsAt, { daysBefore: 1, hour: 8 })).toEqual(window);
  });

  it("is due from 08:00 on the day before, not a minute earlier, and not on the day itself", () => {
    const startsAt = new Date("2026-10-18T07:00:00.000Z");
    expect(rsvpAskDue(startsAt, new Date("2026-10-17T04:59:59.000Z"))).toBe(false);
    expect(rsvpAskDue(startsAt, new Date("2026-10-17T05:00:00.000Z"))).toBe(true);
    expect(rsvpAskDue(startsAt, new Date("2026-10-17T20:59:59.000Z"))).toBe(true);
    // Midnight club time opens the event's day: a question about "tomorrow" would be a lie.
    expect(rsvpAskDue(startsAt, new Date("2026-10-17T21:00:00.000Z"))).toBe(false);
    expect(rsvpAskDue(startsAt, new Date("2026-10-18T05:00:00.000Z"))).toBe(false);
    // Two days ahead: not yet.
    expect(rsvpAskDue(startsAt, new Date("2026-10-16T12:00:00.000Z"))).toBe(false);
  });

  it("asks an event ticked only on the day itself never — the window had closed", () => {
    const startsAt = new Date("2026-10-18T07:00:00.000Z");
    // Sunday, from 00:00 to just before the 10:00 start (club time): no run of the day asks "tomorrow".
    for (const at of ["2026-10-17T21:00:00.000Z", "2026-10-18T00:00:00.000Z", "2026-10-18T05:00:00.000Z", "2026-10-18T06:59:00.000Z"]) {
      expect(rsvpAskDue(startsAt, new Date(at)), at).toBe(false);
    }
  });

  it("is the calendar's tomorrow, not twenty-four hours: a start just after midnight is asked on the morning of the day before", () => {
    // Sunday 2026-10-18 00:30 club time (21:30Z on Saturday the 17th): asked on Saturday the 17th from 08:00 club time.
    const startsAt = new Date("2026-10-17T21:30:00.000Z");
    const window = rsvpAskWindow(startsAt);
    // The start's club day is Sunday the 18th, so the day before is Saturday the 17th: 08:00 club time = 05:00Z.
    expect(window?.opensAt.toISOString()).toBe("2026-10-17T05:00:00.000Z");
    expect(rsvpAskDue(startsAt, new Date("2026-10-17T05:00:00.000Z"))).toBe(true);
    expect(rsvpAskDue(startsAt, new Date("2026-10-17T20:59:00.000Z"))).toBe(true);
    // From the start's own midnight (21:00Z) the window is closed, though the start itself is half an hour away.
    expect(rsvpAskDue(startsAt, new Date("2026-10-17T21:00:00.000Z"))).toBe(false);
  });

  it("holds 08:00 on the wall clock across the autumn change (the last Sunday of October, UTC+3 → UTC+2)", () => {
    // Sunday 2026-10-25 10:00 club time is 08:00Z (winter); Saturday the 24th is still summer time: 08:00 = 05:00Z.
    const startsAt = new Date("2026-10-25T08:00:00.000Z");
    expect(rsvpAskWindow(startsAt)?.opensAt.toISOString()).toBe("2026-10-24T05:00:00.000Z");
    expect(rsvpAskDue(startsAt, new Date("2026-10-24T05:00:00.000Z"))).toBe(true);
    expect(rsvpAskDue(startsAt, new Date("2026-10-24T04:59:00.000Z"))).toBe(false);
    // The event's own midnight is in summer time too: Sunday 00:00 = Saturday 21:00Z... the change is at 04:00 on Sunday, after it.
    expect(rsvpAskWindow(startsAt)?.closesAt.toISOString()).toBe("2026-10-24T21:00:00.000Z");
  });

  it("holds 08:00 on the wall clock across the spring change (the last Sunday of March, UTC+2 → UTC+3)", () => {
    // Sunday 2027-03-28 10:00 club time is 07:00Z (summer); Saturday the 27th is still winter time: 08:00 = 06:00Z.
    const startsAt = new Date("2027-03-28T07:00:00.000Z");
    expect(rsvpAskWindow(startsAt)?.opensAt.toISOString()).toBe("2027-03-27T06:00:00.000Z");
    expect(rsvpAskDue(startsAt, new Date("2027-03-27T06:00:00.000Z"))).toBe(true);
    expect(rsvpAskDue(startsAt, new Date("2027-03-27T05:59:00.000Z"))).toBe(false);
    // Midnight that opens the Sunday is still winter time: 22:00Z on Saturday.
    expect(rsvpAskWindow(startsAt)?.closesAt.toISOString()).toBe("2027-03-27T22:00:00.000Z");
  });

  it("finds the day before across a month and a year end", () => {
    // Friday 2027-01-01 10:00 club time (winter, 08:00Z): asked on Thursday 2026-12-31 from 08:00 = 06:00Z.
    expect(rsvpAskWindow(new Date("2027-01-01T08:00:00.000Z"))?.opensAt.toISOString()).toBe("2026-12-31T06:00:00.000Z");
    // Monday 2026-11-02 (winter): Sunday 2026-11-01.
    expect(rsvpAskWindow(new Date("2026-11-02T08:00:00.000Z"))?.opensAt.toISOString()).toBe("2026-11-01T06:00:00.000Z");
  });

  it("says when the job should next look: the opening, while it is ahead; never once open or after the start", () => {
    const startsAt = new Date("2026-10-18T07:00:00.000Z");
    expect(rsvpAskNextLook(startsAt, new Date("2026-10-15T12:00:00.000Z"))?.toISOString()).toBe("2026-10-17T05:00:00.000Z");
    expect(rsvpAskNextLook(startsAt, new Date("2026-10-17T05:00:00.000Z"))).toBeNull();
    expect(rsvpAskNextLook(startsAt, new Date("2026-10-17T12:00:00.000Z"))).toBeNull();
    expect(rsvpAskNextLook(startsAt, new Date("2026-10-18T07:00:01.000Z"))).toBeNull();
  });
});

describe("§818 «Vii mâine la …?» — who is asked", () => {
  it("is a topic of its own that a subscriber chooses, off by default, and a composer never writes for", () => {
    expect(NEWSLETTER_TOPICS).toContain("RSVP_ASK");
    expect(AUTOMATIC_TOPICS).toEqual(["RSVP_ASK"]);
    expect(SENDABLE_TOPICS).not.toContain("RSVP_ASK");
    expect(isSendableTopic("RSVP_ASK")).toBe(false);
    // A subscriber can still choose it, and "everything" still includes it.
    expect(normalizeTopics(["RSVP_ASK", "BIG_EVENTS"])).toEqual(["BIG_EVENTS", "RSVP_ASK"]);
    expect(normalizeTopics(["RSVP_ASK", "ALL"])).toEqual(["ALL"]);
  });

  it("goes to the subscriber of the topic and to the one who asked for everything, and to nobody else", () => {
    expect(receives(["RSVP_ASK"], ["RSVP_ASK"])).toBe(true);
    expect(receives(["ALL"], ["RSVP_ASK"])).toBe(true);
    // «Alergările săptămânale» promised «o dată pe serie, nu la fiecare alergare»: that topic is NOT the question's audience.
    expect(receives(["WEEKLY_RUNS"], ["RSVP_ASK"])).toBe(false);
    expect(receives(["BIG_EVENTS", "SPECIAL_EVENTS"], ["RSVP_ASK"])).toBe(false);
  });
});

/**
 * §823 (amends §818, §813) — the club sets how many days before the start the question goes (0–7) and from which hour of its clock (0–23).
 * The window is found on the wall clock of Europe/Bucharest, never by adding hours, so each answer below is the instant the CLUB's clock
 * reads that hour on that calendar day. Summer time is UTC+3, winter UTC+2; the changes are the last Sunday of March (the hour 03:00–03:59
 * does not exist) and of October (the hour 03:00–03:59 is read twice).
 */
describe("§823 the «Vii?» window — days before and hour, set by the club", () => {
  const opens = (startsAt: string, daysBefore: number, hour: number) => rsvpAskWindow(new Date(startsAt), { daysBefore, hour })?.opensAt.toISOString();
  const closes = (startsAt: string, daysBefore: number, hour: number) => rsvpAskWindow(new Date(startsAt), { daysBefore, hour })?.closesAt.toISOString();

  it("asks nobody at 0 days: no window, never due, nothing for the job to wake for", () => {
    const startsAt = new Date("2026-10-18T07:00:00.000Z");
    const none = { daysBefore: 0, hour: 8 };
    expect(rsvpAskWindow(startsAt, none)).toBeNull();
    for (const at of ["2026-10-16T12:00:00.000Z", "2026-10-17T05:00:00.000Z", "2026-10-17T20:00:00.000Z", "2026-10-18T05:00:00.000Z"]) {
      expect(rsvpAskDue(startsAt, new Date(at), none), at).toBe(false);
    }
    expect(rsvpAskNextLook(startsAt, new Date("2026-10-10T12:00:00.000Z"), none)).toBeNull();
  });

  it("opens N calendar days before the start's day, at the hour, and closes at the midnight that opens the start's day", () => {
    // Sunday 2026-10-18 at 10:00 club time (summer, 07:00Z).
    const sunday = "2026-10-18T07:00:00.000Z";
    expect(opens(sunday, 1, 8)).toBe("2026-10-17T05:00:00.000Z");
    expect(opens(sunday, 3, 8)).toBe("2026-10-15T05:00:00.000Z");
    expect(opens(sunday, 7, 8)).toBe("2026-10-11T05:00:00.000Z");
    for (const days of [1, 3, 7]) expect(closes(sunday, days, 8), `${days} days`).toBe("2026-10-17T21:00:00.000Z");
    // The hour: 00:00 of the day before is 21:00Z of the day before that; 23:00 is 20:00Z.
    expect(opens(sunday, 1, 0)).toBe("2026-10-16T21:00:00.000Z");
    expect(opens(sunday, 1, 23)).toBe("2026-10-17T20:00:00.000Z");
    expect(opens(sunday, 3, 0)).toBe("2026-10-14T21:00:00.000Z");
    expect(opens(sunday, 3, 23)).toBe("2026-10-15T20:00:00.000Z");
  });

  it("is due from the chosen hour N days ahead, not a minute earlier, and not on the start's day", () => {
    const sunday = new Date("2026-10-18T07:00:00.000Z");
    const three = { daysBefore: 3, hour: 8 };
    expect(rsvpAskDue(sunday, new Date("2026-10-15T04:59:59.000Z"), three)).toBe(false);
    expect(rsvpAskDue(sunday, new Date("2026-10-15T05:00:00.000Z"), three)).toBe(true);
    // A date ticked later than the opening is asked at once, until the midnight of the start's day.
    expect(rsvpAskDue(sunday, new Date("2026-10-17T20:59:59.000Z"), three)).toBe(true);
    expect(rsvpAskDue(sunday, new Date("2026-10-17T21:00:00.000Z"), three)).toBe(false);
    // An hour chosen late in the evening: from 23:00 on the day before.
    const late = { daysBefore: 1, hour: 23 };
    expect(rsvpAskDue(sunday, new Date("2026-10-17T19:59:59.000Z"), late)).toBe(false);
    expect(rsvpAskDue(sunday, new Date("2026-10-17T20:00:00.000Z"), late)).toBe(true);
    expect(rsvpAskDue(sunday, new Date("2026-10-17T20:59:59.000Z"), late)).toBe(true);
    // Midnight chosen: from the first second of the day.
    const midnight = { daysBefore: 1, hour: 0 };
    expect(rsvpAskDue(sunday, new Date("2026-10-16T20:59:59.000Z"), midnight)).toBe(false);
    expect(rsvpAskDue(sunday, new Date("2026-10-16T21:00:00.000Z"), midnight)).toBe(true);
  });

  it("says when the job looks next with the club's numbers", () => {
    const sunday = new Date("2026-10-18T07:00:00.000Z");
    expect(rsvpAskNextLook(sunday, new Date("2026-10-10T12:00:00.000Z"), { daysBefore: 3, hour: 8 })?.toISOString()).toBe("2026-10-15T05:00:00.000Z");
    expect(rsvpAskNextLook(sunday, new Date("2026-10-10T12:00:00.000Z"), { daysBefore: 1, hour: 23 })?.toISOString()).toBe("2026-10-17T20:00:00.000Z");
    // Open already: nothing to wake for.
    expect(rsvpAskNextLook(sunday, new Date("2026-10-16T12:00:00.000Z"), { daysBefore: 3, hour: 8 })).toBeNull();
  });

  describe("across the spring change (Sunday 2027-03-28; the hour 03:00–03:59 does not exist)", () => {
    // The question for Monday 2027-03-29 at 12:00 club time (summer, 09:00Z), asked one day before: on the change day itself.
    const monday = "2027-03-29T09:00:00.000Z";
    it("keeps midnight and the hours before the gap on the winter clock, and the hours after it on the summer clock", () => {
      expect(opens(monday, 1, 0)).toBe("2027-03-27T22:00:00.000Z");
      expect(opens(monday, 1, 2)).toBe("2027-03-28T00:00:00.000Z");
      expect(opens(monday, 1, 4)).toBe("2027-03-28T01:00:00.000Z");
      expect(opens(monday, 1, 8)).toBe("2027-03-28T05:00:00.000Z");
      expect(opens(monday, 1, 23)).toBe("2027-03-28T20:00:00.000Z");
    });
    it("opens an hour inside the skipped one at the first instant after the gap: never earlier than the hour typed, never skipping the day", () => {
      expect(opens(monday, 1, 3)).toBe("2027-03-28T01:00:00.000Z");
      // Asked from 03:00 on a day whose 03:00 never was: due from 04:00 (01:00Z), not from 00:59Z.
      const startsAt = new Date(monday);
      expect(rsvpAskDue(startsAt, new Date("2027-03-28T00:59:59.000Z"), { daysBefore: 1, hour: 3 })).toBe(false);
      expect(rsvpAskDue(startsAt, new Date("2027-03-28T01:00:00.000Z"), { daysBefore: 1, hour: 3 })).toBe(true);
    });
    it("closes at the start's own midnight on the right clock when the start's day follows the change", () => {
      // Monday's midnight is summer time: Sunday 21:00Z.
      expect(closes(monday, 1, 8)).toBe("2027-03-28T21:00:00.000Z");
      // A question three days before the Wednesday after: opened on Sunday after the change (summer).
      expect(opens("2027-03-31T09:00:00.000Z", 3, 8)).toBe("2027-03-28T05:00:00.000Z");
      // …and one that starts before it: Friday the 26th's question three days ahead opens Tuesday the 23rd, winter.
      expect(opens("2027-03-26T09:00:00.000Z", 3, 8)).toBe("2027-03-23T06:00:00.000Z");
    });
    it("a question spanning the change keeps the hour on the wall clock, not 72 hours earlier", () => {
      // Start Tuesday 2027-03-30 10:00 (summer, 07:00Z), three days before: Saturday the 27th 08:00 in winter time (06:00Z).
      expect(opens("2027-03-30T07:00:00.000Z", 3, 8)).toBe("2027-03-27T06:00:00.000Z");
    });
  });

  describe("across the autumn change (Sunday 2026-10-25; the hour 03:00–03:59 is read twice)", () => {
    // The question for Monday 2026-10-26 at 12:00 club time (winter, 10:00Z), asked one day before: on the change day itself.
    const monday = "2026-10-26T10:00:00.000Z";
    it("keeps midnight and the hours before the repeated one on the summer clock, and the hours after it on the winter clock", () => {
      expect(opens(monday, 1, 0)).toBe("2026-10-24T21:00:00.000Z");
      expect(opens(monday, 1, 2)).toBe("2026-10-24T23:00:00.000Z");
      expect(opens(monday, 1, 4)).toBe("2026-10-25T02:00:00.000Z");
      expect(opens(monday, 1, 8)).toBe("2026-10-25T06:00:00.000Z");
      expect(opens(monday, 1, 23)).toBe("2026-10-25T21:00:00.000Z");
    });
    it("opens a repeated hour at its later reading: never before the hour typed, and once", () => {
      // 03:00 happens at 00:00Z (summer) and again at 01:00Z (winter); the wall-clock reader places it at the later one, and the hours stay in order.
      const at = opens(monday, 1, 3);
      expect(at).toBe("2026-10-25T01:00:00.000Z");
      const instants = [0, 1, 2, 3, 4].map((hour) => Date.parse(opens(monday, 1, hour) ?? ""));
      for (let index = 1; index < instants.length; index += 1) expect(instants[index]).toBeGreaterThan(instants[index - 1]);
    });
    it("closes at the start's midnight on the winter clock, and counts three days on the wall clock", () => {
      expect(closes(monday, 1, 8)).toBe("2026-10-25T22:00:00.000Z");
      // Start Wednesday 2026-10-28 10:00 (winter, 08:00Z): three days before is Sunday the 25th, 08:00 winter = 06:00Z.
      expect(opens("2026-10-28T08:00:00.000Z", 3, 8)).toBe("2026-10-25T06:00:00.000Z");
      // Start Sunday 2026-10-25 10:00 (winter): three days before is Thursday the 22nd, still summer: 08:00 = 05:00Z.
      expect(opens("2026-10-25T08:00:00.000Z", 3, 8)).toBe("2026-10-22T05:00:00.000Z");
    });
  });

  it("counts the days from the send to the start on the club's calendar, for the words of the email", () => {
    const sunday = new Date("2026-10-18T07:00:00.000Z");
    expect(rsvpAskDaysAway(sunday, new Date("2026-10-17T05:00:00.000Z"))).toBe(1);
    expect(rsvpAskDaysAway(sunday, new Date("2026-10-16T05:00:00.000Z"))).toBe(2);
    expect(rsvpAskDaysAway(sunday, new Date("2026-10-15T05:00:00.000Z"))).toBe(3);
    // A start just after the club's midnight is the calendar's tomorrow, not 24 hours away.
    expect(rsvpAskDaysAway(new Date("2026-10-17T21:30:00.000Z"), new Date("2026-10-17T05:00:00.000Z"))).toBe(1);
    // Across the autumn change a "day" is still a calendar day.
    expect(rsvpAskDaysAway(new Date("2026-10-26T10:00:00.000Z"), new Date("2026-10-24T20:00:00.000Z"))).toBe(2);
    expect(rsvpAskDaysAway(sunday, sunday)).toBe(0);
  });

  it("says the day in words in each language, for any number", () => {
    expect(rsvpAskDayPhrase("ro", 1)).toBe("mâine");
    expect(rsvpAskDayPhrase("en", 1)).toBe("tomorrow");
    expect(rsvpAskDayPhrase("ro", 2)).toBe("poimâine");
    expect(rsvpAskDayPhrase("en", 2)).toBe("the day after tomorrow");
    expect(rsvpAskDayPhrase("ro", 3)).toBe("peste 3 zile");
    expect(rsvpAskDayPhrase("en", 3)).toBe("in 3 days");
    expect(rsvpAskDayPhrase("ro", 7)).toBe("peste 7 zile");
    // A held message the send drops anyway never names a wrong day.
    expect(rsvpAskDayPhrase("ro", 0)).toBe("astăzi");
    expect(rsvpAskDayPhrase("en", -1)).toBe("today");
  });

  it("looks ahead far enough for the club's days, with room for both changes of the clock", () => {
    const day = 86_400_000;
    expect(rsvpAskLookAheadMs({ daysBefore: 1, hour: 8 })).toBe(2 * day + 2 * 3_600_000);
    expect(rsvpAskLookAheadMs({ daysBefore: 7, hour: 0 })).toBe(8 * day + 2 * 3_600_000);
    expect(rsvpAskLookAheadMs({ daysBefore: 0, hour: 8 })).toBe(day + 2 * 3_600_000);
  });
});
