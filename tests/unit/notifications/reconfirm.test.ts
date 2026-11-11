import { describe, expect, it } from "vitest";
import { RECONFIRM_STATUSES, reconfirmApplies, reconfirmUrlOf } from "@/modules/notifications/domain/cannot-come";
import { STAFF_RESERVE_DAY_MINIMUM, staffBudget, staffReserve } from "@/modules/notifications/domain/bulk";
import { ORGANIZER_SUBJECT_PLACEHOLDERS, organizerMessagePace, organizerMessageResets, organizerParagraphs, readOrganizerAskReconfirm, unknownOrganizerPlaceholders } from "@/modules/notifications/domain/organizer-message";
import { fillReminderBoxes, REMINDER_BOXES, reminderOverwrites } from "@/modules/notifications/ui/reminder-fill";
import en from "../../../messages/en.json";
import ro from "../../../messages/ro.json";

/**
 * «Cere reconfirmarea» (the decision «Cere reconfirmarea»; BR-REQ-036-01, BR-REQ-080-02) — the pure parts: which
 * registrations «Vin» goes to, the link it carries, the staff sends' reserve, the pace line's arithmetic, the fill button's
 * rule, and the ready reminder text in both catalogues.
 */
const NOW = new Date("2026-11-11T10:00:00.000Z");
const AHEAD = { startsAt: new Date("2026-11-20T08:00:00.000Z"), eventStatus: "SCHEDULED" };
const applies = (overrides: Partial<Parameters<typeof reconfirmApplies>[0]> = {}) =>
  reconfirmApplies({
    askReconfirm: true,
    messageType: "ORGANIZER_MESSAGE",
    clubCopy: false,
    recipientParticipantId: "p1",
    registration: { participantId: "p1", status: "CONFIRMED" },
    event: AHEAD,
    now: NOW,
    ...overrides,
  });

describe("«Vin» goes only where a send asked", () => {
  it("asks the confirmed, the declaration owed and the waiting — never an offer, a cancelled or an expired registration", () => {
    expect([...RECONFIRM_STATUSES]).toEqual(["CONFIRMED", "PENDING_DECLARATION", "WAITLISTED"]);
    for (const status of RECONFIRM_STATUSES) expect(applies({ registration: { participantId: "p1", status } }), status).toBe(true);
    for (const status of ["WAITLIST_OFFERED", "CANCELLED", "EXPIRED", "PENDING_EMAIL_CONFIRMATION"] as const) {
      expect(applies({ registration: { participantId: "p1", status } }), status).toBe(false);
    }
  });

  it("needs the tick, the organizer's message, the registration's own address and an event still ahead — never a club copy", () => {
    expect(applies({ askReconfirm: false })).toBe(false);
    expect(applies({ messageType: "EVENT_UPDATE_NOTICE" })).toBe(false);
    expect(applies({ messageType: "EVENT_REMINDER" })).toBe(false);
    expect(applies({ clubCopy: true })).toBe(false);
    expect(applies({ recipientParticipantId: "p2" })).toBe(false);
    expect(applies({ event: { startsAt: new Date(NOW.getTime() - 60_000), eventStatus: "SCHEDULED" } })).toBe(false);
    expect(applies({ event: { ...AHEAD, eventStatus: "CANCELLED" } })).toBe(false);
  });

  it("lands on the same manage page as the cancel, at its own anchor", () => {
    expect(reconfirmUrlOf("https://club.test/ro/inscrieri/gestioneaza/abc")).toBe("https://club.test/ro/inscrieri/gestioneaza/abc#reconfirm");
  });

  it("reads the send's flag from the row's payload, and nothing else as a yes", () => {
    expect(readOrganizerAskReconfirm({ subject: {}, body: {}, askReconfirm: true })).toBe(true);
    for (const payload of [null, {}, { askReconfirm: "true" }, { askReconfirm: 1 }, "askReconfirm"]) expect(readOrganizerAskReconfirm(payload)).toBe(false);
  });
});

describe("the staff sends' reserve (decided for the owner: max(10, 10%))", () => {
  it("keeps ten a day on Mailgun Free, a tenth of a bigger daily allowance, a tenth of a monthly one, nothing with no ceiling", () => {
    expect(STAFF_RESERVE_DAY_MINIMUM).toBe(10);
    expect(staffReserve({ period: "day", allowance: 100 })).toBe(10);
    expect(staffReserve({ period: "day", allowance: 50 })).toBe(10);
    expect(staffReserve({ period: "day", allowance: 300 })).toBe(30);
    expect(staffReserve({ period: "month", allowance: 50_000 })).toBe(5000);
    expect(staffReserve({ period: "month", allowance: 40 })).toBe(4);
    expect(staffReserve({ period: "none", allowance: null })).toBe(0);
  });

  it("lets a staff send use what is left less the reserve, never below zero, and sets no limit without a ceiling", () => {
    expect(staffBudget({ period: "day", allowance: 100, remaining: 15 })).toBe(5);
    expect(staffBudget({ period: "day", allowance: 100, remaining: 8 })).toBe(0);
    expect(staffBudget({ period: "day", allowance: 100, remaining: 100 })).toBe(90);
    expect(staffBudget({ period: "none", allowance: null, remaining: null })).toBeNull();
  });
});

describe("the pace line's arithmetic (part two)", () => {
  it("counts the queue ahead and the send at one batch a run, or at Mailgun's hour when slower, never under an hour", () => {
    // Twenty every fifteen minutes is eighty an hour: 201 messages and nothing ahead, three hours.
    expect(organizerMessagePace({ messages: 201, ahead: 0, batchSize: 20, minutesPerRun: 15, hourlyAllowance: 100 })).toEqual({ hours: 3 });
    // Forty ahead of it: 241, four hours.
    expect(organizerMessagePace({ messages: 201, ahead: 40, batchSize: 20, minutesPerRun: 15, hourlyAllowance: 100 })).toEqual({ hours: 4 });
    // Mailgun's hour slower than the runs: fifty an hour, five hours.
    expect(organizerMessagePace({ messages: 250, ahead: 0, batchSize: 20, minutesPerRun: 15, hourlyAllowance: 50 })).toEqual({ hours: 5 });
    // No pace: the runs alone. A small send: one hour.
    expect(organizerMessagePace({ messages: 400, ahead: 0, batchSize: 20, minutesPerRun: 15, hourlyAllowance: null })).toEqual({ hours: 5 });
    expect(organizerMessagePace({ messages: 3, ahead: 0, batchSize: 20, minutesPerRun: 15, hourlyAllowance: 100 })).toEqual({ hours: 1 });
  });
});

describe("how many more resets a deferred staff send waits for (part two)", () => {
  it("divides what waits by the day's allowance less the reserve: on Free, 111 at 90 a day need two midnights", () => {
    expect(organizerMessageResets(111, 90)).toBe(2);
    expect(organizerMessageResets(90, 90)).toBe(1);
    expect(organizerMessageResets(1, 90)).toBe(1);
    expect(organizerMessageResets(0, 90)).toBe(0);
    // A reserve as large as the allowance still counts one a day, never a division by zero.
    expect(organizerMessageResets(5, 0)).toBe(5);
  });
});

describe("«Completează cu textul de reminder» without the browser", () => {
  const TEXTS = { subjectRo: "s-ro", subjectEn: "s-en", bodyRo: "b-ro", bodyEn: "b-en" };

  it("writes all four boxes, each with its own text, through the writer the island hands it", () => {
    const boxes = new Map(REMINDER_BOXES.map((name) => [name, { name, value: "" }]));
    const written: string[] = [];
    const count = fillReminderBoxes(
      (name) => boxes.get(name),
      TEXTS,
      (box, text) => {
        box.value = text;
        written.push(box.name);
      },
    );
    expect(count).toBe(4);
    expect(written).toEqual(["subjectRo", "subjectEn", "bodyRo", "bodyEn"]);
    expect([...boxes.values()].map((box) => box.value)).toEqual(["s-ro", "s-en", "b-ro", "b-en"]);
    // A box the form does not hold is skipped, never invented.
    expect(fillReminderBoxes((name) => (name === "bodyEn" ? null : boxes.get(name)), TEXTS, () => {})).toBe(3);
  });

  it("asks first only when a box already holds words", () => {
    expect(reminderOverwrites({ subjectRo: "", subjectEn: " ", bodyRo: "\n", bodyEn: "" })).toBe(false);
    expect(reminderOverwrites({ subjectRo: "", subjectEn: "", bodyRo: "Salut", bodyEn: "" })).toBe(true);
  });
});

describe("the ready reminder text, in both catalogues", () => {
  const PARTS = ["subject", "p1", "p2", "p3", "p4", "p5", "p6"] as const;
  const textOf = (catalogue: typeof ro) => catalogue.Admin.participantMessages.reminderText;

  it("has the same parts and the same placeholders in Romanian and English, each one the message can fill", () => {
    const names = (value: string) => [...value.matchAll(/\{(\w+)\}/g)].map((match) => match[1]).sort();
    for (const part of PARTS) {
      expect(names(textOf(ro)[part]), part).toEqual(names(textOf(en)[part]));
      for (const name of names(textOf(ro)[part])) expect(ORGANIZER_SUBJECT_PLACEHOLDERS as readonly string[], `${part} {${name}}`).toContain(name);
      expect(unknownOrganizerPlaceholders(textOf(ro)[part], part === "subject" ? "subject" : "body"), part).toEqual([]);
      expect(textOf(ro)[part].length, part).toBeLessThanOrEqual(200);
      expect(textOf(en)[part].length, part).toBeLessThanOrEqual(200);
    }
  });

  it("says that pressing nothing leaves the registration as it is, and never that silence costs the place", () => {
    expect(textOf(ro).p5).toBe("Dacă nu apeși nimic, înscrierea ta rămâne exact cum e.");
    expect(textOf(en).p5).toBe("If you press nothing, your registration stays exactly as it is.");
    for (const catalogue of [ro, en]) {
      const all = PARTS.map((part) => textOf(catalogue)[part]).join(" ");
      expect(all).not.toMatch(/pierzi|se anulează automat|vei fi anulat|lose your place|cancelled automatically|will be cancelled/i);
    }
    // Six paragraphs, as the composer joins them and the send reads them back.
    expect(organizerParagraphs(PARTS.slice(1).map((part) => textOf(ro)[part]).join("\n\n"))).toHaveLength(6);
  });

  it("names the buttons by their own words in both languages, and the composer's help line says nobody is cancelled automatically", () => {
    expect(textOf(ro).p3).toContain("„Vin”");
    expect(textOf(ro).p4).toContain("„Nu mai pot ajunge”");
    expect(textOf(en).p3).toContain("“I'm coming”");
    expect(textOf(en).p4).toContain("“I can't make it any more”");
    expect(ro.Admin.participantMessages.reconfirmHelp).toContain("Nu se anulează nimeni automat");
    expect(en.Admin.participantMessages.reconfirmHelp).toContain("Nobody is cancelled automatically");
    // The page's button is not the RSVP feature's «Da, vin».
    expect(ro.Registrations.reconfirm.yes).toBe("Da, vin la cursă");
    expect(ro.Registrations.reconfirm.optional).toContain("înscrierea rămâne exact cum e");
  });
});
