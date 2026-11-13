import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { registrationStatus } from "@/db/schema/registrations";
import { EMAIL_COPY_PLACEHOLDERS } from "@/modules/notifications/domain/email-copy";
import {
  AUDIENCE_STATUSES,
  checkOrganizerMessage,
  CHOSEN_AUDIENCE,
  CHOSEN_FIELD,
  chosenRegistrationIds,
  isMessageReach,
  isOrganizerQrStatus,
  isParticipantMessageAudience,
  ORGANIZER_BODY_MAX,
  ORGANIZER_MESSAGE_PLACEHOLDERS,
  ORGANIZER_SUBJECT_MAX,
  ORGANIZER_SUBJECT_PLACEHOLDERS,
  organizerMessageCost,
  organizerMessageDeferral,
  organizerParagraphs,
  organizerQrApplies,
  PARTICIPANT_MESSAGE_AUDIENCES,
  readOrganizerMessagePayload,
  readOrganizerSendQr,
  unknownOrganizerPlaceholders,
} from "@/modules/notifications/domain/organizer-message";
import { emailSampleData, emailSampleFor } from "@/modules/notifications/email-copy-fields";
import { EVENT_NOTICE_STATUSES } from "@/modules/notifications/event-notices";
import { buildOutgoingEmail, buildTemplateContent, HIGHLIGHT_TEXT_MARK, type TemplateData } from "@/modules/notifications/templates";
import { canMessageParticipants, STAFF_ROLES } from "@/modules/staff-identity/domain/roles";
import { CLUB_NAME } from "@/theme/brand";
import en from "../../../messages/en.json";
import ro from "../../../messages/ro.json";

/**
 * `DECISIONS.md` §364 — "Trimite un mesaj participanților": the organizer's own message to an
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

describe("§364 who a message can go to", () => {
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

  it("§NNN offers the people ticked beside the four groups: a fifth choice that is not a group and has no states of its own", () => {
    expect(CHOSEN_AUDIENCE).toBe("CHOSEN");
    // The four stay the partition they were: nothing is added to the groups, and no set of states is the ticked's own.
    expect(PARTICIPANT_MESSAGE_AUDIENCES).not.toContain(CHOSEN_AUDIENCE);
    expect(Object.keys(AUDIENCE_STATUSES)).toEqual([...PARTICIPANT_MESSAGE_AUDIENCES]);
    expect(isParticipantMessageAudience(CHOSEN_AUDIENCE)).toBe(false);
    for (const value of [...PARTICIPANT_MESSAGE_AUDIENCES, CHOSEN_AUDIENCE]) expect(isMessageReach(value)).toBe(true);
    for (const value of ["chosen", "CANCELLED", "", null, 3, undefined]) expect(isMessageReach(value)).toBe(false);
    // Both catalogues name it where «Mesaje trimise» names a send's group.
    for (const catalogue of [ro, en]) expect(Object.keys(catalogue.Admin.participantMessages.audiencesShort)).toEqual([...PARTICIPANT_MESSAGE_AUDIENCES, CHOSEN_AUDIENCE]);
  });

  it("§NNN reads the ticks as registration ids: each a uuid, once, whatever else was posted", () => {
    const a = "0b0d5c3e-4f5a-4c1e-9d2b-7a8e9f0a1b2c";
    const b = "1b0d5c3e-4f5a-4c1e-9d2b-7a8e9f0a1b2c";
    expect(chosenRegistrationIds([a, b, a, a.toUpperCase(), "", "ana", `${a} `, `${a}' OR 1=1`, 7, null, undefined, { id: b }, [b]])).toEqual([a, b]);
    expect(chosenRegistrationIds([])).toEqual([]);
    expect(CHOSEN_FIELD).toBe("registrationIds");
  });
});

describe("§364 BR-REQ-060-01 who may write to an event's participants", () => {
  it("is the Organizer and up — never the volunteer, the Redactor or the Tehnic role", () => {
    const allowed = STAFF_ROLES.filter((role) => canMessageParticipants(role));
    expect(allowed).toEqual(["MODERATOR", "ADMIN", "SUPERADMIN"]);
  });
});

describe("§364 the words: both languages, both texts, the closed placeholders", () => {
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

  it("offers a subset of §247's closed set: no link in the subject, the body's one more the form's link alone (§676)", () => {
    for (const name of ORGANIZER_MESSAGE_PLACEHOLDERS) expect(EMAIL_COPY_PLACEHOLDERS).toContain(name);
    expect(ORGANIZER_SUBJECT_PLACEHOLDERS.some((name) => /url|link/i.test(name))).toBe(false);
    expect(ORGANIZER_MESSAGE_PLACEHOLDERS.filter((name) => !(ORGANIZER_SUBJECT_PLACEHOLDERS as readonly string[]).includes(name))).toEqual(["feedbackLink"]);
  });

  it("refuses {feedbackLink} in the subject and fills it in the body (§676)", () => {
    const checked = checkOrganizerMessage({
      subject: { ro: "Cum a fost? {feedbackLink}", en: "How was {eventTitle}?" },
      body: { ro: "Spune-ne: {feedbackLink}", en: "Tell us: {feedbackLink}" },
    });
    expect(checked.message).toBeNull();
    expect(checked.issues).toEqual([{ box: "subjectRo", problem: "unknownPlaceholder", names: ["feedbackLink"] }]);
    expect(unknownOrganizerPlaceholders("{feedbackLink}", "subject")).toEqual(["feedbackLink"]);
    expect(unknownOrganizerPlaceholders("{feedbackLink}")).toEqual([]);
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

describe("§364 the words out of the outbox row", () => {
  it("reads both languages of both texts, and nothing less", () => {
    expect(readOrganizerMessagePayload(WORDS)).toEqual(WORDS);
    expect(readOrganizerMessagePayload({ subject: WORDS.subject, body: { ro: "Doar română", en: "" } })).toBeNull();
    expect(readOrganizerMessagePayload({ subject: "one string", body: WORDS.body })).toBeNull();
    for (const payload of [null, undefined, "x", 3, {}, { clubCopy: true }]) expect(readOrganizerMessagePayload(payload)).toBeNull();
  });
});

describe("§364 §100 §40 what a send costs, and what waits", () => {
  it("counts every recipient once and one club copy per address for the whole send (§419)", () => {
    expect(organizerMessageCost({ real: 10, test: 2 }, 0)).toBe(12);
    // Ten runners, two club addresses: two copies for the send, not twenty.
    expect(organizerMessageCost({ real: 10, test: 2 }, 2)).toBe(14);
    expect(organizerMessageCost({ real: 0, test: 0 }, 5)).toBe(0);
    // A send that reaches test rows alone is copied to nobody.
    expect(organizerMessageCost({ real: 0, test: 3 }, 2)).toBe(3);
  });

  it("sends what the allowance allows and defers the rest — never refuses", () => {
    expect(organizerMessageDeferral(30, null)).toEqual({ now: 30, deferred: 0 });
    expect(organizerMessageDeferral(30, 100)).toEqual({ now: 30, deferred: 0 });
    expect(organizerMessageDeferral(30, 12)).toEqual({ now: 12, deferred: 18 });
    expect(organizerMessageDeferral(30, 0)).toEqual({ now: 0, deferred: 30 });
  });
});

describe("§364 §96 §354 the message as it arrives", () => {
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
    expect(email.text).toContain("Cum folosim datele:");
    expect(email.text).toContain("How we use the data:");
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

  it("names no event rather than the club when the title is missing (§357)", () => {
    const email = render("ro", { participantName: "Ana Pop" });
    expect(email.subject).toBe("Un mesaj despre evenimentul la care te-ai înscris / A message about the event you registered for");
    expect(email.text).toContain("Un mesaj de la organizatorii evenimentului la care te-ai înscris:");
    expect(email.text).toContain("A message from the organizers of the event you registered for:");
    // The sign-off names the club, as every message's does; the sentences about the event do not.
    expect(email.subject).not.toContain(CLUB_NAME);
    expect(email.text).not.toContain(`evenimentului ${CLUB_NAME}`);
    expect(email.text).not.toContain(`organizers of ${CLUB_NAME}`);
    // An empty title is no title either.
    const empty = buildTemplateContent("ORGANIZER_MESSAGE", "en", { participantName: "Ana", eventTitle: "" }, undefined);
    expect(empty.subject).toBe("A message about the event you registered for");
    expect(empty.paragraphs).toEqual(["A message from the organizers of the event you registered for:"]);
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

/**
 * §943 — «Trimite și numărul de concurs și codul QR» (the owner, 2026-11-12: «în acel mail de comunicare, trebuie să le
 * și reamintesc oamenilor care e numărul lor de concurs și să le retrimit QR»; BR-REQ-080-01, BR-REQ-037-08). The pure
 * half: the row's flag, who it draws for, and the block itself — the confirmation's own number line, code line and QR
 * figure, under the organizers' words. The send, the renderer and the screens are
 * `tests/integration/notifications/participant-message-qr.test.ts`.
 */
describe("§943 «Trimite și numărul de concurs și codul QR»: the row's flag, and who it draws for", () => {
  it("reads the flag from the row's payload, and nothing else as a yes", () => {
    expect(readOrganizerSendQr({ subject: {}, body: {}, sendQr: true })).toBe(true);
    for (const payload of [null, undefined, {}, { sendQr: "true" }, { sendQr: 1 }, { askReconfirm: true }, "sendQr"]) expect(readOrganizerSendQr(payload)).toBe(false);
  });

  it("is for a confirmed registration alone — a number and a desk code exist only from the confirmation", () => {
    for (const status of registrationStatus.enumValues) expect(isOrganizerQrStatus(status), status).toBe(status === "CONFIRMED");
  });

  const applies = (overrides: Partial<Parameters<typeof organizerQrApplies>[0]> = {}) =>
    organizerQrApplies({ sendQr: true, clubCopy: false, recipientParticipantId: "p1", registration: { participantId: "p1", status: "CONFIRMED" }, ...overrides });

  it("draws with the flag, at the registration's own address, for a registration confirmed as it renders", () => {
    expect(applies()).toBe(true);
    // Whatever it was when the send queued the row: cancelled, lapsed or anything else by now, the words alone.
    for (const status of registrationStatus.enumValues.filter((one) => one !== "CONFIRMED")) {
      expect(applies({ registration: { participantId: "p1", status } }), status).toBe(false);
    }
  });

  it("never without the flag, on a club copy (§320), at another address, or with no registration behind the row", () => {
    expect(applies({ sendQr: false })).toBe(false);
    expect(applies({ clubCopy: true })).toBe(false);
    expect(applies({ recipientParticipantId: "p2" })).toBe(false);
    expect(applies({ recipientParticipantId: null })).toBe(false);
    expect(applies({ registration: null })).toBe(false);
    expect(applies({ registration: undefined })).toBe(false);
  });
});

describe("§943 the block in the message: the confirmation's own, under the organizers' words", () => {
  const CODE = "K7Q2XRABCD";
  const QR = `https://example.test/api/registrations/qr/${CODE}.png`;
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
  // What the renderer hands the template for a flagged row of a confirmed registration: the block's own field.
  const WITH_QR: TemplateData = { ...DATA, organizerQr: { checkinCode: CODE, qrUrl: QR } };
  const render = (locale: "ro" | "en", data: TemplateData) =>
    buildOutgoingEmail({ to: "ana@example.ro", locale, idempotencyKey: `test:organizer-qr:${locale}`, messageType: "ORGANIZER_MESSAGE", data, actionUrl: DATA.eventUrl });
  const bands = (html: string) => [...html.matchAll(/<div data-email-part="highlight"[^>]*>([^]*?)<\/div>/g)].map((match) => match[1]);
  const pictures = (html: string) => html.split(`<img src="${QR}"`).length - 1;
  const marked = (text: string) => text.split("\n").filter((line) => line.startsWith(HIGHLIGHT_TEXT_MARK));

  it("draws the number and the desk code on the band, then the QR with whose it is — after the organizers' words, before the button", () => {
    const email = render("ro", WITH_QR);
    const found = bands(email.html);
    // One band per half: the number, bold, and the code, bold — the confirmation's two sentences.
    expect(found).toHaveLength(2);
    expect(found[0]).toContain("Numărul tău de concurs: <strong>42</strong>. Îl primești la masă, în ziua cursei.");
    expect(found[0]).toContain(`La ridicarea numărului de concurs arată codul QR de mai jos sau spune codul <strong>${CODE}</strong>.`);
    expect(found[1]).toContain("Your race number: <strong>42</strong>. You collect it at the desk on race day.");
    expect(found[1]).toContain(`When you pick up your race number, show the QR code below or say the code <strong>${CODE}</strong>.`);
    // The picture once — the second half repeats the words, not the picture — hosted, never inlined, with whose it is.
    expect(pictures(email.html)).toBe(1);
    expect(email.html).toContain(`alt="Cod QR ${CODE} — Ana Pop"`);
    expect(email.html).toContain(`Ana Pop · Număr de concurs: 42 · Codul tău: ${CODE}`);
    expect(email.html).not.toContain("data:image");
    // Under the organizers' own words, above the event's button.
    const words = email.html.indexOf("Numărul tău: 42.");
    const band = email.html.indexOf('data-email-part="highlight"');
    const picture = email.html.indexOf(`<img src="${QR}"`);
    const button = email.html.indexOf(">Vezi pagina evenimentului</a>");
    expect(words).toBeGreaterThan(-1);
    expect(band).toBeGreaterThan(words);
    expect(picture).toBeGreaterThan(band);
    expect(button).toBeGreaterThan(picture);

    // The plain-text half says the same: both sentences marked, in each language, and the picture's address once.
    const [romanian, english] = email.text.split("\n— — —\n");
    expect(marked(romanian)).toEqual([
      `${HIGHLIGHT_TEXT_MARK}Numărul tău de concurs: 42. Îl primești la masă, în ziua cursei.`,
      `${HIGHLIGHT_TEXT_MARK}La ridicarea numărului de concurs arată codul QR de mai jos sau spune codul ${CODE}.`,
    ]);
    expect(marked(english)).toEqual([
      `${HIGHLIGHT_TEXT_MARK}Your race number: 42. You collect it at the desk on race day.`,
      `${HIGHLIGHT_TEXT_MARK}When you pick up your race number, show the QR code below or say the code ${CODE}.`,
    ]);
    expect(romanian).toContain(`Ana Pop · Număr de concurs: 42 · Codul tău: ${CODE}: ${QR}`);
    expect(english).not.toContain(QR);
    // Under the words in the text half too.
    expect(romanian.indexOf("Numărul tău de concurs: 42.")).toBeGreaterThan(romanian.indexOf("Numărul tău: 42."));
  });

  it("reads English first for an English registration, the picture still once, with its English caption", () => {
    const email = render("en", {
      ...WITH_QR,
      eventTitle: "The autumn cross",
      eventTitleOther: "Crosul de toamnă",
      organizerSubject: WORDS.subject.en,
      organizerSubjectOther: WORDS.subject.ro,
      organizerBody: WORDS.body.en,
      organizerBodyOther: WORDS.body.ro,
    });
    const found = bands(email.html);
    expect(found).toHaveLength(2);
    expect(found[0]).toContain("Your race number: <strong>42</strong>.");
    expect(found[1]).toContain("Numărul tău de concurs: <strong>42</strong>.");
    expect(pictures(email.html)).toBe(1);
    expect(email.html).toContain(`alt="QR code ${CODE} — Ana Pop"`);
    expect(email.html).toContain(`Ana Pop · Race number: 42 · Your code: ${CODE}`);
  });

  it("says «—» for a confirmed runner with no number yet: no number sentence, the code and the QR all the same", () => {
    const email = render("ro", { ...WITH_QR, bibNumber: undefined });
    expect(email.text).not.toContain("Numărul tău de concurs:");
    expect(email.text).toContain(`spune codul ${CODE}.`);
    expect(pictures(email.html)).toBe(1);
    expect(email.html).toContain(`Ana Pop · Număr de concurs: — · Codul tău: ${CODE}`);
    expect(bands(email.html)).toHaveLength(2);
  });

  it("draws nothing without the block's own field: the message exactly as it always was", () => {
    const plain = render("ro", DATA);
    expect(bands(plain.html)).toHaveLength(0);
    expect(plain.text).not.toContain(HIGHLIGHT_TEXT_MARK);
    expect(plain.html).not.toContain("/api/registrations/qr/");
    expect(plain.text).not.toContain("Numărul tău de concurs:");
    expect(buildTemplateContent("ORGANIZER_MESSAGE", "ro", DATA, DATA.eventUrl).image).toBeUndefined();
    // The confirmation's fields are not this message's: handed the desk code and its picture's address — as a sample
    // holding every field is — the organizers' message draws nothing and builds the very same message (§373).
    for (const fields of [{ checkinQrUrl: QR }, { checkinCode: CODE }, { checkinCode: CODE, checkinQrUrl: QR }]) {
      const email = render("ro", { ...DATA, ...fields });
      expect(email.html).toBe(plain.html);
      expect(email.text).toBe(plain.text);
    }
    // No sample sets the block: the previews on «Setări» → «Emailuri» show the message without it, in both languages.
    for (const locale of ["ro", "en"] as const) {
      for (const data of [emailSampleFor("ORGANIZER_MESSAGE", locale), emailSampleData(locale)]) {
        expect(data.organizerQr).toBeUndefined();
        const sample = buildOutgoingEmail({ to: "a@example.ro", locale, idempotencyKey: "test:sample", messageType: "ORGANIZER_MESSAGE", data, actionUrl: DATA.eventUrl });
        expect(sample.html).not.toContain("/api/registrations/qr/");
        expect(bands(sample.html)).toHaveLength(0);
      }
    }
  });

  it("keeps the code out of the organizers' own words even where the block is drawn: {checkinCode} is no field of this message", () => {
    // The send refuses the field; a hand-made row that carried it would still print nothing for it — the code is in the block alone.
    const email = render("ro", { ...WITH_QR, organizerBody: "Codul din text: {checkinCode}.", organizerBodyOther: "The code in the words: {checkinCode}." });
    expect(email.text).toContain("Codul din text:.");
    expect(email.text).toContain("The code in the words:.");
    expect(email.text).toContain(`spune codul ${CODE}.`);
    expect(unknownOrganizerPlaceholders("Codul: {checkinCode}")).toEqual(["checkinCode"]);
    expect(ORGANIZER_MESSAGE_PLACEHOLDERS as readonly string[]).not.toContain("checkinCode");
  });

  it("never in the club's copy, whatever it is handed (§320): the copy of one message or the send's one copy", () => {
    for (const copy of [{ clubCopy: true }, { clubCopy: true, clubCopyRecipients: 12, participantName: "" }]) {
      const email = render("ro", { ...WITH_QR, ...copy });
      for (const body of [email.html, email.text]) {
        expect(body).not.toContain(CODE);
        expect(body).not.toContain("/api/registrations/qr/");
        expect(body).not.toContain("Numărul tău de concurs:");
        expect(body).not.toContain("Your race number:");
        // Nor the line a confirmation's copy carries in the QR's place: this message's copy names nobody.
        expect(body).not.toContain("Număr de concurs:");
        expect(body).not.toContain("Race number:");
      }
      expect(bands(email.html)).toHaveLength(0);
    }
  });

  it("is drawn by no other message, whatever it is handed: the block's field is the organizers' message's alone", () => {
    for (const messageType of ["EVENT_UPDATE_NOTICE", "WAITLIST_SPOT_OFFER", "REGISTRATION_CANCELLED", "EVENT_THANKS", "WAITLIST_JOINED"] as const) {
      const email = buildOutgoingEmail({ to: "ana@example.ro", locale: "ro", idempotencyKey: `test:other:${messageType}`, messageType, data: WITH_QR, actionUrl: DATA.eventUrl });
      expect(email.html, messageType).not.toContain("/api/registrations/qr/");
      expect(email.text, messageType).not.toContain(CODE);
    }
  });
});

describe("§943 the tick's words, in both catalogues", () => {
  const wordsOf = (catalogue: typeof ro) => catalogue.Admin.participantMessages;

  it("names the tick, says who gets them and who does not, and how «Mesaje trimise» says it", () => {
    expect(wordsOf(ro).sendQr).toBe("Trimite și numărul de concurs și codul QR");
    expect(wordsOf(en).sendQr).toBe("Also send the race number and the QR code");
    expect(wordsOf(ro).sendQrHelp).toBe("Le primesc doar cei confirmați, fiecare pe ale lui, sub mesajul tău. Ceilalți primesc mesajul fără ele.");
    expect(wordsOf(en).sendQrHelp).toBe("Only the confirmed get them, each their own, under your message. Everyone else gets the message without them.");
    expect(wordsOf(ro).historyQr).toBe("Cu numărul de concurs și codul QR pentru cei confirmați: {count}");
    expect(wordsOf(en).historyQr).toBe("With the race number and the QR code for the confirmed: {count}");
    // One plain sentence of help (§511).
    for (const catalogue of [ro, en]) expect(wordsOf(catalogue).sendQrHelp.length).toBeLessThanOrEqual(200);
  });

  it("is a step of the guide's task, by the tick's own label", () => {
    for (const catalogue of [ro, en]) {
      const steps = catalogue.Admin.guide.sections.flatMap((section) => section.tasks.flatMap((task) => task.steps));
      expect(steps.filter((step) => step.includes(`«${wordsOf(catalogue).sendQr}»`))).toHaveLength(1);
    }
  });
});

/**
 * The structural half of «nothing reads the flag but the send and the renderer» (§943), in the style of
 * `reconfirmation-never-leaves.test.ts`: the files that name the flag or its two rules are a reviewed list — none of the
 * allocator's, the capacity formula's, a state's or a deadline's is on it.
 */
describe("§943 the flag decides a block of an email, and nothing else", () => {
  const ROOT = process.cwd();
  const NAMES_THE_FLAG = /\bsendQr\b|readOrganizerSendQr|organizerQrApplies|isOrganizerQrStatus/;
  const READERS = [
    // The tick on the form, the action that reads it, and the page that hands the composer its words and draws «Mesaje trimise».
    "src/app/[locale]/admin/events/[id]/mesaje/actions.ts",
    "src/app/[locale]/admin/events/[id]/mesaje/page.tsx",
    "src/modules/notifications/ui/ParticipantMessageComposer.tsx",
    // The rule, the send that sets the flag row by row, and the renderer that asks the state again.
    "src/modules/notifications/domain/organizer-message.ts",
    "src/modules/notifications/participant-messages.ts",
    "src/modules/notifications/render.ts",
  ];

  function sourceFiles(dir: string, acc: string[] = []): string[] {
    for (const entry of readdirSync(dir)) {
      const full = path.join(dir, entry);
      if (statSync(full).isDirectory()) sourceFiles(full, acc);
      else if (/\.tsx?$/.test(entry)) acc.push(full);
    }
    return acc;
  }

  it("is named by no file but the reviewed ones — never the allocator, the capacity formula, a state or a deadline", () => {
    const naming = sourceFiles(path.join(ROOT, "src"))
      .filter((file) => NAMES_THE_FLAG.test(readFileSync(file, "utf8")))
      .map((file) => path.relative(ROOT, file).replaceAll("\\", "/"))
      .sort();
    expect(naming, "a new reader of the flag must be a reviewed edit of this list").toEqual([...READERS].sort());
    for (const file of naming) {
      expect(file.startsWith("src/modules/registrations/"), file).toBe(false);
      expect(file.startsWith("src/modules/deadlines/"), file).toBe(false);
      expect(file.startsWith("src/db/"), file).toBe(false);
    }
  });
});
