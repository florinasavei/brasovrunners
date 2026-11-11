import { describe, expect, it } from "vitest";
import { RECONFIRM_STATUSES, reconfirmApplies, reconfirmUrlOf } from "@/modules/notifications/domain/cannot-come";
import {
  isSendToManyMessage,
  SEND_TO_MANY_MESSAGE_TYPES,
  sendOrderOf,
  sendsToManyAfter,
  URGENT_SEND_TO_MANY_MESSAGE_TYPES,
  WAITS_FOR_MAILGUN_MESSAGE_TYPES,
  waitsAsSendToMany,
  waitsForMailgunDuringStop,
} from "@/modules/notifications/domain/bulk";
import { BULK_CLUB_COPY_MESSAGES } from "@/modules/notifications/domain/club-notices";
import { ORGANIZER_SUBJECT_PLACEHOLDERS, organizerParagraphs, organizerSendOutlook, readOrganizerAskReconfirm, unknownOrganizerPlaceholders } from "@/modules/notifications/domain/organizer-message";
import { fillReminderBoxes, REMINDER_BOXES, reminderOverwrites } from "@/modules/notifications/ui/reminder-fill";
import en from "../../../messages/en.json";
import ro from "../../../messages/ro.json";

/**
 * «Cere reconfirmarea» (the decision «Cere reconfirmarea»; BR-REQ-080-01, BR-REQ-080-02) — the pure parts: which
 * registrations «Vin» goes to, the link it carries, the claim's order, the line before «Trimite»'s arithmetic, the fill button's
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

  it("reads the row's flag from its payload, and nothing else as a yes", () => {
    expect(readOrganizerAskReconfirm({ subject: {}, body: {}, askReconfirm: true })).toBe(true);
    for (const payload of [null, {}, { askReconfirm: "true" }, { askReconfirm: 1 }, "askReconfirm"]) expect(readOrganizerAskReconfirm(payload)).toBe(false);
  });
});

describe("the order of the claim (part two): the sends to many in one constant, no reserve", () => {
  it("puts the six sends to many after every registration's own, the cancellation first and «s-au deschis înscrierile» last", () => {
    expect([...SEND_TO_MANY_MESSAGE_TYPES]).toEqual([
      "EVENT_CANCELLED",
      "EVENT_UPDATE_NOTICE",
      "EVENT_REMINDER",
      "ORGANIZER_MESSAGE",
      "EVENT_THANKS",
      "REGISTRATION_OPENED",
    ]);
    expect(sendOrderOf("VERIFY_REGISTRATION_EMAIL")).toBe(0);
    expect(sendOrderOf("WAITLIST_SPOT_OFFER")).toBe(0);
    SEND_TO_MANY_MESSAGE_TYPES.forEach((type, index) => expect(sendOrderOf(type), type).toBe(index + 1));
    for (const type of SEND_TO_MANY_MESSAGE_TYPES) expect(isSendToManyMessage(type), type).toBe(true);
    for (const type of ["REGISTRATION_CONFIRMED", "WAITLIST_SPOT_OFFER", "NEWSLETTER", "RSVP_ASK"] as const) expect(isSendToManyMessage(type), type).toBe(false);
  });

  it("makes a manual resend of any of them the person's own message: step 0, and not waiting as a send to many", () => {
    for (const type of SEND_TO_MANY_MESSAGE_TYPES) {
      expect(sendOrderOf(type, true), type).toBe(0);
      expect(waitsAsSendToMany(type, true), type).toBe(false);
      expect(waitsAsSendToMany(type), type).toBe(true);
    }
    expect(waitsAsSendToMany("VERIFY_REGISTRATION_EMAIL")).toBe(false);
  });

  it("names the event's two urgent notices, and only the other four wait for Mailgun during a stop", () => {
    expect([...URGENT_SEND_TO_MANY_MESSAGE_TYPES]).toEqual(["EVENT_CANCELLED", "EVENT_UPDATE_NOTICE"]);
    expect([...WAITS_FOR_MAILGUN_MESSAGE_TYPES]).toEqual(["EVENT_REMINDER", "ORGANIZER_MESSAGE", "EVENT_THANKS", "REGISTRATION_OPENED"]);
    for (const type of WAITS_FOR_MAILGUN_MESSAGE_TYPES) {
      expect(waitsForMailgunDuringStop(type), type).toBe(true);
      expect(waitsForMailgunDuringStop(type, true), type).toBe(false);
    }
    for (const type of [...URGENT_SEND_TO_MANY_MESSAGE_TYPES, "VERIFY_REGISTRATION_EMAIL", "WAITLIST_SPOT_OFFER", "NEWSLETTER"] as const) {
      expect(waitsForMailgunDuringStop(type), type).toBe(false);
    }
  });

  it("says what a new organizers' message does not wait behind: the thanks and «s-au deschis înscrierile»", () => {
    expect([...sendsToManyAfter("ORGANIZER_MESSAGE")]).toEqual(["EVENT_THANKS", "REGISTRATION_OPENED"]);
    expect([...sendsToManyAfter("REGISTRATION_OPENED")]).toEqual([]);
  });

  it("keeps the club-copy rule apart: one copy per send for the organizers' message and «Detalii actualizate» only", () => {
    expect([...BULK_CLUB_COPY_MESSAGES].sort()).toEqual(["EVENT_UPDATE_NOTICE", "ORGANIZER_MESSAGE"]);
    expect(SEND_TO_MANY_MESSAGE_TYPES).not.toBe(BULK_CLUB_COPY_MESSAGES);
  });
});

describe("the line before «Trimite», worked out per road with no reserve (part two)", () => {
  const MAILGUN = { road: "mailgun" as const, batchSize: 20, minutesPerRun: 15, hourlyAllowance: 100 };

  it("on Free's 100 a day with 5 sent, 201 messages: 95 today in about 2 hours, the other 106 over 2 more days at 100 a day, 3 days of the allowance", () => {
    expect(organizerSendOutlook({ ...MAILGUN, messages: 201, ahead: 0, period: "day", allowance: 100, remaining: 95 })).toEqual({
      road: "mailgun",
      period: "day",
      messages: 201,
      now: 95,
      deferred: 106,
      hours: 2,
      restDays: 2,
      perDay: 100,
      daysUsed: 3,
    });
  });

  it("counts what waits ahead on the same road out of today's room and into the hours", () => {
    const outlook = organizerSendOutlook({ ...MAILGUN, messages: 201, ahead: 15, period: "day", allowance: 100, remaining: 95 });
    expect(outlook).toMatchObject({ now: 80, deferred: 121, hours: 2, restDays: 2, daysUsed: 3 });
    // Today already spent: nothing today, the days of the rest alone.
    expect(organizerSendOutlook({ ...MAILGUN, messages: 201, ahead: 0, period: "day", allowance: 100, remaining: 0 })).toMatchObject({ now: 0, hours: 0, restDays: 3, daysUsed: 3 });
    // It fits: no deferral, no rest.
    expect(organizerSendOutlook({ ...MAILGUN, messages: 50, ahead: 0, period: "day", allowance: 100, remaining: 95 })).toMatchObject({ now: 50, deferred: 0, restDays: 0, daysUsed: 1, hours: 1 });
  });

  it("on a monthly plan, 201 messages leave now in about three hours at twenty every fifteen minutes; more with a queue ahead, or Mailgun's slower hour", () => {
    expect(organizerSendOutlook({ ...MAILGUN, messages: 201, ahead: 0, period: "month", allowance: 10_000, remaining: 9_000 })).toEqual({
      road: "mailgun",
      period: "month",
      messages: 201,
      now: 201,
      deferred: 0,
      hours: 3,
    });
    expect(organizerSendOutlook({ ...MAILGUN, messages: 201, ahead: 40, period: "month", allowance: 10_000, remaining: 9_000 }).hours).toBe(4);
    expect(organizerSendOutlook({ ...MAILGUN, hourlyAllowance: 50, messages: 250, ahead: 0, period: "month", allowance: 10_000, remaining: 9_000 }).hours).toBe(5);
    expect(organizerSendOutlook({ ...MAILGUN, messages: 201, ahead: 0, period: "month", allowance: 10_000, remaining: 150 })).toMatchObject({ now: 150, deferred: 51 });
    // No ceiling and no pace: the runs alone; a small send is one hour.
    expect(organizerSendOutlook({ ...MAILGUN, hourlyAllowance: null, messages: 400, ahead: 0, period: "none", allowance: null, remaining: null })).toMatchObject({ now: 400, deferred: 0, hours: 5 });
    expect(organizerSendOutlook({ ...MAILGUN, messages: 3, ahead: 0, period: "none", allowance: null, remaining: null }).hours).toBe(1);
  });

  it("on the club's Gmail, its own room and pace: four a pass is sixteen an hour, and what the rolling day has no room for waits", () => {
    expect(organizerSendOutlook({ road: "gmail", messages: 201, ahead: 0, batchSize: 20, minutesPerRun: 15, gmailRoom: 200, gmailPerPass: 4 })).toEqual({
      road: "gmail",
      messages: 201,
      now: 200,
      waiting: 1,
      hours: 13,
      perPass: 4,
    });
    expect(organizerSendOutlook({ road: "gmail", messages: 30, ahead: 10, batchSize: 20, minutesPerRun: 15, gmailRoom: 200, gmailPerPass: 4 })).toMatchObject({ now: 30, waiting: 0, hours: 3 });
    expect(organizerSendOutlook({ road: "gmail", messages: 30, ahead: 0, batchSize: 20, minutesPerRun: 15, gmailRoom: 0, gmailPerPass: 4 })).toMatchObject({ now: 0, waiting: 30, hours: 0 });
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
  const PARTS = ["subject", "p1", "p2", "p3", "p4", "p5", "p6", "p7"] as const;
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

  it("says that «Vin» is optional and changes nothing, points a declaration or an offer at its own email, and never says silence costs the place", () => {
    expect(textOf(ro).p2).toContain("{eventTitle} e aproape:");
    expect(textOf(en).p2).toContain("{eventTitle} is coming up:");
    expect(textOf(ro).p4).toBe("Dacă nu mai poți ajunge, apasă „Nu mai pot ajunge”, ca să poată veni altcineva în locul tău.");
    expect(textOf(en).p4).toBe("If you can no longer make it, press “I can't make it any more”, so someone else can come in your place.");
    expect(textOf(ro).p5).toBe("„Vin” e opțional: dacă nu-l apeși, nu se schimbă nimic la înscrierea ta.");
    expect(textOf(en).p5).toBe("“I'm coming” is optional: if you don't press it, nothing about your registration changes.");
    // No deadline promised: an offer or a declaration may have none in its email.
    expect(textOf(ro).p6).toBe("Dacă mai ai de semnat declarația sau ai primit un loc oferit, urmează pașii din emailul primit.");
    expect(textOf(en).p6).toBe("If you still have to sign the declaration or were offered a place, follow the steps in the email you received.");
    for (const catalogue of [ro, en]) {
      const all = PARTS.map((part) => textOf(catalogue)[part]).join(" ");
      // The old sentences: a waiting person's «place» promised to the waiting list, and «exactly as it is» for somebody who still owes a signature.
      expect(all).not.toMatch(/lista de așteptare|waiting list|exact cum e|exactly as it is/i);
      expect(all).not.toMatch(/pierzi|se anulează automat|vei fi anulat|lose your place|cancelled automatically|will be cancelled/i);
    }
    // Seven paragraphs, as the composer joins them and the send reads them back.
    expect(organizerParagraphs(PARTS.slice(1).map((part) => textOf(ro)[part]).join("\n\n"))).toHaveLength(7);
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
    expect(ro.Registrations.reconfirm.yesOther).toBe("Da, vin la eveniment");
    expect(ro.Registrations.reconfirm.optional).toBe("Răspunsul e opțional: dacă nu apeși „{button}”, nu se schimbă nimic la înscrierea ta.");
    expect(en.Registrations.reconfirm.optional).toBe("Answering is optional: if you don't press “{button}”, nothing about your registration changes.");
  });
});
