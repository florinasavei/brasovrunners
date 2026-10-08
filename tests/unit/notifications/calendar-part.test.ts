import { describe, expect, it } from "vitest";
import { emailMessageType, type EmailMessageType } from "@/db/schema/email-outbox";
import { calendarSequenceMoves, type EventChangeFacts } from "@/modules/events/domain/event-changes";
import { calendarPartFor } from "@/modules/notifications/domain/calendar-part";
import { calendarRsvpToSchema } from "@/modules/notifications/domain/calendar-rsvp";

/**
 * `DECISIONS.md` §672 — which message carries which calendar part, the address's rule, and when the
 * invitation's `SEQUENCE` moves. Pure: the table the renderer asks and the comparison the save asks.
 */
const RSVP = "club+calendar@example.org";

describe("§672 which calendar part a message carries", () => {
  it("unset: today's file on the confirmation and the reminder, and nothing on any other message", () => {
    for (const messageType of emailMessageType.enumValues as readonly EmailMessageType[]) {
      const part = calendarPartFor({ messageType, clubCopy: false, rsvpTo: null, confirmed: true, changes: ["time"] });
      expect(part, messageType).toBe(messageType === "REGISTRATION_CONFIRMED" || messageType === "EVENT_REMINDER" ? "file" : null);
    }
  });

  it("set: the five messages, and no other", () => {
    const carrying = (emailMessageType.enumValues as readonly EmailMessageType[]).flatMap((messageType) => {
      const part = calendarPartFor({ messageType, clubCopy: false, rsvpTo: RSVP, confirmed: true, changes: ["place"] });
      return part ? [[messageType, part]] : [];
    });
    expect(Object.fromEntries(carrying)).toEqual({
      REGISTRATION_CONFIRMED: "REQUEST",
      EVENT_REMINDER: "REQUEST",
      EVENT_UPDATE_NOTICE: "REQUEST",
      EVENT_CANCELLED: "CANCEL",
      GROUP_RUN_DECLARATION_SIGNED: "REQUEST",
    });
  });

  it("set: the update only about the time, the place or a date on again", () => {
    const update = (changes: Parameters<typeof calendarPartFor>[0]["changes"]) =>
      calendarPartFor({ messageType: "EVENT_UPDATE_NOTICE", clubCopy: false, rsvpTo: RSVP, confirmed: true, changes });
    expect(update(["time"])).toBe("REQUEST");
    expect(update(["place"])).toBe("REQUEST");
    expect(update(["reinstated"])).toBe("REQUEST");
    expect(update(["programme"])).toBeNull();
    expect(update([])).toBeNull();
  });

  it("set: nobody without a place is invited; a confirmation for one keeps the file", () => {
    expect(calendarPartFor({ messageType: "EVENT_CANCELLED", clubCopy: false, rsvpTo: RSVP, confirmed: false })).toBeNull();
    expect(calendarPartFor({ messageType: "EVENT_UPDATE_NOTICE", clubCopy: false, rsvpTo: RSVP, confirmed: false, changes: ["time"] })).toBeNull();
    expect(calendarPartFor({ messageType: "REGISTRATION_CONFIRMED", clubCopy: false, rsvpTo: RSVP, confirmed: false })).toBe("file");
  });

  it("a club copy and an archive copy carry nothing, set or not (§320)", () => {
    for (const rsvpTo of [null, RSVP]) {
      for (const messageType of emailMessageType.enumValues as readonly EmailMessageType[]) {
        expect(calendarPartFor({ messageType, clubCopy: true, rsvpTo, confirmed: true, changes: ["time"] }), messageType).toBeNull();
      }
      expect(calendarPartFor({ messageType: "GROUP_RUN_DECLARATION_ARCHIVE", clubCopy: false, rsvpTo, confirmed: true })).toBeNull();
      expect(calendarPartFor({ messageType: "DECLARATION_ARCHIVE", clubCopy: false, rsvpTo, confirmed: true })).toBeNull();
    }
  });
});

describe("§672 the address", () => {
  it("is empty (off) or one address, trimmed", () => {
    expect(calendarRsvpToSchema.parse({})).toEqual({ to: "" });
    expect(calendarRsvpToSchema.parse({ to: "" })).toEqual({ to: "" });
    expect(calendarRsvpToSchema.parse({ to: `  ${RSVP}  ` })).toEqual({ to: RSVP });
    for (const wrong of ["nu-e-adresa", "a@b", "a b@example.org", "x@example.org; y@example.org", "mailto:x@example.org", `${"a".repeat(320)}@example.org`]) {
      expect(calendarRsvpToSchema.safeParse({ to: wrong }).success, wrong).toBe(false);
    }
    expect(calendarRsvpToSchema.safeParse({ to: RSVP, other: 1 }).success).toBe(false);
  });
});

describe("§672 the invitation's SEQUENCE moves with what the calendar holds", () => {
  const before: EventChangeFacts = {
    eventStatus: "SCHEDULED",
    startsAt: new Date("2026-10-11T07:00:00.000Z"),
    raceStartsAt: null,
    locationName: "Parcul Tractorul",
    locationAddress: null,
    mapUrl: null,
    scheduleItems: null,
  };

  it("moves for the start, the race's start, the place, a cancellation and a date on again", () => {
    expect(calendarSequenceMoves(before, { ...before, startsAt: new Date("2026-10-11T08:00:00.000Z") })).toBe(true);
    expect(calendarSequenceMoves(before, { ...before, raceStartsAt: new Date("2026-10-11T07:30:00.000Z") })).toBe(true);
    expect(calendarSequenceMoves(before, { ...before, locationName: "Poiana Brașov" })).toBe(true);
    expect(calendarSequenceMoves(before, { ...before, mapUrl: "https://maps.app.goo.gl/x" })).toBe(true);
    expect(calendarSequenceMoves(before, { ...before, eventStatus: "CANCELLED" })).toBe(true);
    expect(calendarSequenceMoves({ ...before, eventStatus: "CANCELLED" }, before)).toBe(true);
  });

  it("stays for the programme, an unchanged save, and a place still to be announced", () => {
    const programme = [{ startsAt: "2026-10-11T06:00:00.000Z", endsAt: null, label: { ro: "Numere", en: "Bibs" }, place: null }];
    expect(calendarSequenceMoves(before, { ...before, scheduleItems: programme })).toBe(false);
    expect(calendarSequenceMoves(before, { ...before })).toBe(false);
    expect(calendarSequenceMoves({ ...before, locationToBeAnnounced: true }, { ...before, locationName: "Altundeva", locationToBeAnnounced: true })).toBe(false);
    expect(calendarSequenceMoves({ ...before, eventStatus: "CANCELLED" }, { ...before, eventStatus: "CANCELLED" })).toBe(false);
  });
});
