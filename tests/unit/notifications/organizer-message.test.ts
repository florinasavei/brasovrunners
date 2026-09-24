import { describe, expect, it } from "vitest";
import { EMAIL_COPY_PLACEHOLDERS } from "@/modules/notifications/domain/email-copy";
import {
  AUDIENCE_STATUSES,
  checkOrganizerMessage,
  isParticipantMessageAudience,
  ORGANIZER_BODY_MAX,
  ORGANIZER_MESSAGE_PLACEHOLDERS,
  ORGANIZER_SUBJECT_MAX,
  organizerMessageCost,
  organizerMessageDeferral,
  organizerParagraphs,
  PARTICIPANT_MESSAGE_AUDIENCES,
  readOrganizerMessagePayload,
  unknownOrganizerPlaceholders,
} from "@/modules/notifications/domain/organizer-message";
import { EVENT_NOTICE_STATUSES } from "@/modules/notifications/event-notices";
import { buildOutgoingEmail, buildTemplateContent, type TemplateData } from "@/modules/notifications/templates";
import { canMessageParticipants, STAFF_ROLES } from "@/modules/staff-identity/domain/roles";

/**
 * `DECISIONS.md` §NNN — "Trimite un mesaj participanților": the organizer's own message to an
 * event's registrants, in Română and English. The pure half: who can be chosen, what the words
 * may be, how they are read out of the outbox, what a send costs, and how the template renders
 * the two halves — each in its own language, from the organizer's own two texts.
 */

const WORDS = {
  subject: { ro: "Vreme rea la {eventTitle}", en: "Bad weather at {eventTitle}" },
  body: {
    ro: "Salut, {participantName}!\n\nStartul se mută la 10:00.\nMasa se deschide la 9:15.\n\nNumărul tău: {bibNumber}.",
    en: "Hi, {participantName}!\n\nThe start moves to 10:00.\nThe desk opens at 9:15.\n\nYour number: {bibNumber}.",
  },
};

describe("§NNN who a message can go to", () => {
  it("offers everybody active and its three parts, and 'everybody' is exactly the §331 notices' set", () => {
    expect(PARTICIPANT_MESSAGE_AUDIENCES).toEqual(["ALL_ACTIVE", "CONFIRMED", "WAITLIST", "PENDING_DECLARATION"]);
    expect([...AUDIENCE_STATUSES.ALL_ACTIVE].sort()).toEqual([...EVENT_NOTICE_STATUSES].sort());
  });

  it("splits 'everybody' into three parts that do not overlap: confirmed, waiting (offers included), owing the declaration", () => {
    const parts = [AUDIENCE_STATUSES.CONFIRMED, AUDIENCE_STATUSES.WAITLIST, AUDIENCE_STATUSES.PENDING_DECLARATION];
    const joined = parts.flat();
    expect(new Set(joined).size).toBe(joined.length);
    expect([...joined].sort()).toEqual([...AUDIENCE_STATUSES.ALL_ACTIVE].sort());
    expect(AUDIENCE_STATUSES.WAITLIST).toEqual(expect.arrayContaining(["WAITLISTED", "WAITLIST_OFFERED"]));
  });

  it("never reaches a cancelled or lapsed registration, or an address nobody has confirmed", () => {
    for (const audience of PARTICIPANT_MESSAGE_AUDIENCES) {
      for (const status of ["CANCELLED", "EXPIRED", "PENDING_EMAIL_CONFIRMATION"] as const) {
        expect(AUDIENCE_STATUSES[audience]).not.toContain(status);
      }
    }
  });

  it("reads a posted choice only when it is one of the four", () => {
    expect(isParticipantMessageAudience("CONFIRMED")).toBe(true);
    for (const value of ["confirmed", "CANCELLED", "", null, 3, undefined]) expect(isParticipantMessageAudience(value)).toBe(false);
  });
});

describe("§NNN BR-REQ-060-01 who may write to an event's participants", () => {
  it("is the Organizer and up — never the volunteer, the Redactor or the Tehnic role", () => {
    const allowed = STAFF_ROLES.filter((role) => canMessageParticipants(role));
    expect(allowed).toEqual(["MODERATOR", "ADMIN", "SUPERADMIN"]);
  });
});

describe("§NNN the words: both languages, both texts, the closed placeholders", () => {
  it("accepts a message written in both languages, and keeps it as typed with one line ending", () => {
    const checked = checkOrganizerMessage({
      subject: { ro: "  Vreme rea\r\nazi ", en: "Bad weather\ntoday" },
      body: { ro: "Rând unu.\r\n\r\nRând doi.", en: "Line one.\n\nLine two." },
    });
    expect(checked.issues).toEqual([]);
    // A subject is one line: a line break typed into it is a space.
    expect(checked.message?.subject).toEqual({ ro: "Vreme rea azi", en: "Bad weather today" });
    expect(checked.message?.body).toEqual({ ro: "Rând unu.\n\nRând doi.", en: "Line one.\n\nLine two." });
  });

  it("refuses a message in one language, naming every empty box", () => {
    const checked = checkOrganizerMessage({ subject: { ro: "Vreme rea", en: "" }, body: { ro: "Startul se mută.", en: "   " } });
    expect(checked.message).toBeNull();
    expect(checked.issues).toEqual([
      { box: "subjectEn", problem: "empty" },
      { box: "bodyEn", problem: "empty" },
    ]);
    // And nothing at all names all four.
    expect(checkOrganizerMessage({ subject: {}, body: {} }).issues.map((issue) => issue.box)).toEqual(["subjectRo", "subjectEn", "bodyRo", "bodyEn"]);
  });

  it("refuses an unknown placeholder by name, and the §247 ones this message never fills", () => {
    const checked = checkOrganizerMessage({
      subject: { ro: "Salut {nume}", en: "Hi {participantName}" },
      body: { ro: "Rolul: {staffRole}; codul: {checkinCode}; {eventTitle}", en: "{nume} and {nume}" },
    });
    expect(checked.message).toBeNull();
    expect(checked.issues).toEqual([
      { box: "subjectRo", problem: "unknownPlaceholder", names: ["nume"] },
      { box: "bodyRo", problem: "unknownPlaceholder", names: ["staffRole", "checkinCode"] },
      { box: "bodyEn", problem: "unknownPlaceholder", names: ["nume"] },
    ]);
    expect(unknownOrganizerPlaceholders("{eventTitle} {participantName} {x}")).toEqual(["x"]);
  });

  it("offers a subset of §247's closed set, with no link among them", () => {
    for (const name of ORGANIZER_MESSAGE_PLACEHOLDERS) expect(EMAIL_COPY_PLACEHOLDERS).toContain(name);
    expect(ORGANIZER_MESSAGE_PLACEHOLDERS.some((name) => /url/i.test(name))).toBe(false);
  });

  it("refuses a text over its ceiling", () => {
    const checked = checkOrganizerMessage({
      subject: { ro: "a".repeat(ORGANIZER_SUBJECT_MAX + 1), en: "ok" },
      body: { ro: "ok", en: "b".repeat(ORGANIZER_BODY_MAX + 1) },
    });
    expect(checked.issues).toEqual([
      { box: "subjectRo", problem: "tooLong" },
      { box: "bodyEn", problem: "tooLong" },
    ]);
  });

  it("reads a blank line as a new paragraph and a single break as a line inside it", () => {
    expect(organizerParagraphs("Unu\ndoi\r\n\r\n\r\nTrei  \n   \n\nPatru")).toEqual([["Unu", "doi"], ["Trei"], ["Patru"]]);
    expect(organizerParagraphs("   ")).toEqual([]);
  });
});

describe("§NNN the words out of the outbox row", () => {
  it("reads both languages of both texts, and nothing less", () => {
    expect(readOrganizerMessagePayload(WORDS)).toEqual(WORDS);
    expect(readOrganizerMessagePayload({ subject: WORDS.subject, body: { ro: "Doar română", en: "" } })).toBeNull();
    expect(readOrganizerMessagePayload({ subject: "one string", body: WORDS.body })).toBeNull();
    for (const payload of [null, undefined, "x", 3, {}, { clubCopy: true }]) expect(readOrganizerMessagePayload(payload)).toBeNull();
  });
});

describe("§NNN §100 §40 what a send costs, and what waits", () => {
  it("counts every real recipient with the club's copies, and every test one alone", () => {
    expect(organizerMessageCost({ real: 10, test: 2 }, 0)).toBe(12);
    expect(organizerMessageCost({ real: 10, test: 2 }, 2)).toBe(32);
    expect(organizerMessageCost({ real: 0, test: 0 }, 5)).toBe(0);
  });

  it("sends what the allowance allows and defers the rest — never refuses", () => {
    expect(organizerMessageDeferral(30, null)).toEqual({ now: 30, deferred: 0 });
    expect(organizerMessageDeferral(30, 100)).toEqual({ now: 30, deferred: 0 });
    expect(organizerMessageDeferral(30, 12)).toEqual({ now: 12, deferred: 18 });
    expect(organizerMessageDeferral(30, 0)).toEqual({ now: 0, deferred: 30 });
  });
});

describe("§NNN §96 §354 the message as it arrives", () => {
  const DATA: TemplateData = {
    participantName: "Ana Pop",
    eventTitle: "Crosul de toamnă",
    eventTitleOther: "The autumn cross",
    eventLocationName: "Parcul Tractorul",
    eventStartsAtFormatted: "duminică, 11 oct. 2026, 09:00",
    eventStartsAtFormattedOther: "Sunday, 11 Oct 2026, 09:00",
    eventUrl: "https://example.test/ro/evenimente/crosul-de-toamna",
    eventsUrl: "https://example.test/ro/evenimente",
    contactUrl: "https://example.test/ro/contact",
    myRegistrationsUrl: "https://example.test/ro/inscrieri/ale-mele",
    bibNumber: 42,
    organizerSubject: WORDS.subject.ro,
    organizerSubjectOther: WORDS.subject.en,
    organizerBody: WORDS.body.ro,
    organizerBodyOther: WORDS.body.en,
  };
  const render = (locale: "ro" | "en", data: TemplateData = DATA) =>
    buildOutgoingEmail({ to: "ana@example.ro", locale, idempotencyKey: `test:organizer:${locale}`, messageType: "ORGANIZER_MESSAGE", data, actionUrl: DATA.eventUrl });

  it("reads the registrant's language first, and each half's own words and facts — never the same text twice", () => {
    const email = render("ro");
    expect(email.subject).toBe("Vreme rea la Crosul de toamnă / Bad weather at The autumn cross");
    const [romanian, english] = email.text.split("— — —");
    expect(romanian).toContain("Salut, Ana Pop!");
    expect(romanian).toContain("Startul se mută la 10:00.\nMasa se deschide la 9:15.");
    expect(romanian).toContain("Numărul tău: 42.");
    expect(romanian).not.toContain("The start moves");
    expect(english).toContain("Hi, Ana Pop!");
    expect(english).toContain("The start moves to 10:00.\nThe desk opens at 9:15.");
    expect(english).toContain("A message from the organizers of The autumn cross");
    expect(english).not.toContain("Startul se mută");
    // The event's page is the button, and "my registrations" by address is among the links.
    expect(email.html).toContain(`href="${DATA.eventUrl}"`);
    expect(email.text).toContain("Înscrierile mele (îți trimitem linkul pe email): https://example.test/ro/inscrieri/ale-mele");
    // A participant message: the privacy line, in both halves.
    expect(email.text).toContain("Cum folosim datele tale:");
    expect(email.text).toContain("How we use your data:");
    expect(email.attachments).toBeUndefined();
  });

  it("puts English first for an English registration", () => {
    const email = render("en", {
      ...DATA,
      eventTitle: "The autumn cross",
      eventTitleOther: "Crosul de toamnă",
      eventStartsAtFormatted: "Sunday, 11 Oct 2026, 09:00",
      eventStartsAtFormattedOther: "duminică, 11 oct. 2026, 09:00",
      organizerSubject: WORDS.subject.en,
      organizerSubjectOther: WORDS.subject.ro,
      organizerBody: WORDS.body.en,
      organizerBodyOther: WORDS.body.ro,
    });
    expect(email.subject).toBe("Bad weather at The autumn cross / Vreme rea la Crosul de toamnă");
    expect(email.text.indexOf("Hi, Ana Pop!")).toBeLessThan(email.text.indexOf("Salut, Ana Pop!"));
  });

  it("escapes what the organizer typed and reads no emphasis in it", () => {
    const email = render("ro", { ...DATA, organizerBody: "Aduceți <b>**frontala**</b> & apă.", organizerBodyOther: "Bring a __head torch__." });
    expect(email.html).toContain("Aduceți &lt;b&gt;**frontala**&lt;/b&gt; &amp; apă.");
    expect(email.html).not.toContain("<strong>frontala</strong>");
    expect(email.html).toContain("Bring a __head torch__.");
  });

  it("leaves an empty placeholder out and closes the gap, for whoever has no number yet", () => {
    const email = render("ro", { ...DATA, bibNumber: undefined });
    expect(email.text).toContain("Numărul tău:.");
  });

  it("falls back to the platform's subject and sentence when the row carried no readable words", () => {
    const content = buildTemplateContent("ORGANIZER_MESSAGE", "ro", { participantName: "Ana", eventTitle: "Crosul" }, undefined);
    expect(content.subject).toBe("Un mesaj despre Crosul");
    expect(content.paragraphs).toEqual(["Un mesaj de la organizatorii evenimentului Crosul, la care te-ai înscris:"]);
  });

  it("is never rewritten by the club's stored wording: it is written per send (§247)", () => {
    const overrides = { "ORGANIZER_MESSAGE:ro": { subject: "Altceva", paragraphs: ["Alt text."] } };
    const content = buildTemplateContent("ORGANIZER_MESSAGE", "ro", DATA, DATA.eventUrl, overrides);
    expect(content.subject).toBe("Vreme rea la Crosul de toamnă");
    expect(JSON.stringify(content.paragraphs)).not.toContain("Alt text.");
  });

  it("as the club's copy (§320): marked in both languages, no button, the words kept", () => {
    const email = render("ro", { ...DATA, clubCopy: true });
    expect(email.subject.startsWith("[Copie club] Vreme rea")).toBe(true);
    expect(email.subject).toContain(" / [Club copy] Bad weather");
    expect(email.text).toContain("Copie pentru club a mesajului trimis participantului.");
    expect(email.text).toContain("Startul se mută la 10:00.");
    expect(email.html).not.toContain("display:inline-block;background");
  });
});
