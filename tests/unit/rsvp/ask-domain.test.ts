import { describe, expect, it } from "vitest";
import { RSVP_ASK_CLOCK, RSVP_ASK_HOUR, rsvpAskDue, rsvpAskNextLook, rsvpAskWindow } from "@/modules/rsvp/domain/ask";
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
    expect(RSVP_ASK_HOUR).toBe(8);
    expect(RSVP_ASK_CLOCK).toBe("08:00");
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
