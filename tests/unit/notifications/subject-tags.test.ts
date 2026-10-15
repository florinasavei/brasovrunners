import { describe, expect, it } from "vitest";
import type { EmailMessageType } from "@/db/schema/email-outbox";
import { readFileSync } from "node:fs";
import { markSubjectForEnvironment } from "@/infrastructure/email/delivery";
import { renderContactMessage } from "@/modules/contact/message";
import { composeFeedbackEmail, FEEDBACK_BRANCHES, feedbackFields, type FeedbackInput, SAFETY_SUBJECT } from "@/modules/feedback/domain/branches";
import { EMAIL_AUDIENCE, messageTypesFor } from "@/modules/notifications/domain/email-audience";
import { RELAY_MESSAGE_TYPES } from "@/modules/notifications/domain/relay";
import {
  FEEDBACK_FORM_TAGS,
  feedbackTags,
  markAfterTags,
  MEMBER_FACING,
  startsWithTag,
  SUBJECT_TAGS,
  SUBJECT_TAGS_OF,
  tagPrefix,
  tagsOfMessageType,
  tagSubject,
} from "@/modules/notifications/domain/subject-tags";
import { relayNoticeContent } from "@/modules/notifications/relay-notice-words";
import { buildOutgoingEmail, type TemplateData } from "@/modules/notifications/templates";

/**
 * BR-REQ-080-03, BR-REQ-070-04, `DECISIONS.md` §NNN (amending §307, §676, §778) — the tags at the start of every email the
 * club or a colleague receives: fixed ASCII, one map, the human words after, QA's mark in front, and every participant's
 * or volunteer's subject exactly what it was.
 */
// The audience map files a member's shop receipts and invitation under «staff»; they go to the member and are not tagged.
const STAFF_BOUND: EmailMessageType[] = [...messageTypesFor("club"), ...messageTypesFor("staff")].filter((type) => !(MEMBER_FACING as readonly string[]).includes(type));
const ALL_TYPES = Object.keys(EMAIL_AUDIENCE) as EmailMessageType[];

const DATA: TemplateData = {
  participantName: "Ana Pop",
  eventTitle: "Crosul aniversar",
  eventStartsAtFormatted: "duminică, 11 oct. 2026, 09:00",
};

function render(messageType: EmailMessageType, locale: "ro" | "en" = "ro") {
  return buildOutgoingEmail({ to: "someone@example.org", locale, idempotencyKey: `test:${messageType}`, messageType, data: DATA, actionUrl: "https://example.test/ro/x/secret" });
}

describe("the tag vocabulary", () => {
  it("is fixed ASCII, lowercase, with no spaces or diacritics, and each tag once", () => {
    expect(new Set(SUBJECT_TAGS).size).toBe(SUBJECT_TAGS.length);
    for (const tag of SUBJECT_TAGS) expect(tag).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
  });

  it("names the four forms' tags as the owner asked, and one tag for each branch", () => {
    expect(FEEDBACK_FORM_TAGS).toEqual({ howItWent: "cum-a-fost", suggestion: "sugestie", complaint: "reclamatie", safety: "girl-zone" });
    expect(Object.keys(FEEDBACK_FORM_TAGS).sort()).toEqual([...FEEDBACK_BRANCHES].sort());
    expect(tagsOfMessageType("CONTACT_MESSAGE")).toEqual(["contact"]);
  });

  it("is in no translation file: the tags are never translated", () => {
    for (const file of ["messages/ro.json", "messages/en.json"]) {
      const text = readFileSync(file, "utf8");
      for (const tag of SUBJECT_TAGS) expect(text, `${file} carries [${tag}]`).not.toContain(`[${tag}]`);
    }
  });

  it("is used: every tag of the map is in the vocabulary, and every tag of the vocabulary is somebody's", () => {
    const used = new Set<string>([...Object.values(SUBJECT_TAGS_OF).flat(), ...Object.values(FEEDBACK_FORM_TAGS)]);
    for (const tag of used) expect(SUBJECT_TAGS).toContain(tag);
    for (const tag of SUBJECT_TAGS) expect(used.has(tag)).toBe(true);
  });
});

describe("the walk over every message type that reaches the club or a colleague", () => {
  it("covers a non-empty set, including the three the relay carries", () => {
    expect(STAFF_BOUND.length).toBeGreaterThan(10);
    for (const type of RELAY_MESSAGE_TYPES) expect(STAFF_BOUND).toContain(type);
  });

  it.each(STAFF_BOUND)("%s has at least one tag, all in the vocabulary", (type) => {
    const tags = tagsOfMessageType(type);
    expect(tags.length).toBeGreaterThan(0);
    for (const tag of tags) expect(SUBJECT_TAGS).toContain(tag);
  });

  // The relay's three are built elsewhere (the forms' composers, the notice's words); the rest go through the template.
  const TEMPLATED = STAFF_BOUND.filter((type) => !(RELAY_MESSAGE_TYPES as readonly string[]).includes(type));

  it.each(TEMPLATED)("%s is rendered with its tags in front, in both languages' halves after them", (type) => {
    for (const locale of ["ro", "en"] as const) {
      const { subject } = render(type, locale);
      const prefix = tagPrefix(tagsOfMessageType(type));
      expect(subject.startsWith(`${prefix} `)).toBe(true);
      // Once: the second language's half carries the words, not the tags again.
      expect(subject.slice(prefix.length + 1)).not.toMatch(/^\[[a-z-]+\]/);
      expect(subject.split(prefix).length - 1).toBe(1);
      expect(subject.slice(prefix.length + 1)).toContain(" / ");
    }
  });

  it("gives each staff family the tag the table says", () => {
    const expected: Partial<Record<EmailMessageType, string>> = {
      CLUB_CONFIRMATION_NOTICE: "inscrieri",
      DECLARATION_ARCHIVE: "declaratii",
      GROUP_RUN_DECLARATION_ARCHIVE: "declaratii",
      VOLUNTEER_CLUB_NOTICE: "voluntari",
      LEGAL_TEMPLATES_CHANGED: "legal",
      RELAY_NOTICE: "livrare",
      UNREACHABLE_WINDOW_OPENED: "sistem",
      UNREACHABLE_WINDOW_CLOSED: "sistem",
      SHOP_ORDER_CLUB_NOTICE: "magazin",
      STAFF_INVITATION: "echipa",
    };
    for (const [type, tag] of Object.entries(expected)) expect(tagsOfMessageType(type as EmailMessageType)).toEqual([tag]);
    expect(render("VOLUNTEER_CLUB_NOTICE").subject).toBe("[voluntari] Voluntar nou la Crosul aniversar / New volunteer for Crosul aniversar");
    expect(render("LEGAL_TEMPLATES_CHANGED").subject.startsWith("[legal] ")).toBe(true);
    expect(render("CLUB_CONFIRMATION_NOTICE").subject.startsWith("[inscrieri] ")).toBe(true);
  });
});

describe("participant-, volunteer- and public-facing subjects are unchanged", () => {
  const OTHERS = ALL_TYPES.filter((type) => !STAFF_BOUND.includes(type));

  it("has no tag in the map for any of them", () => {
    expect(OTHERS.length).toBeGreaterThan(20);
    for (const type of OTHERS) expect(tagsOfMessageType(type)).toEqual([]);
  });

  it.each(OTHERS.filter((type) => !(RELAY_MESSAGE_TYPES as readonly string[]).includes(type)))("%s keeps its subject: two halves, no tag", (type) => {
    const { subject } = render(type);
    expect(startsWithTag(subject)).toBe(false);
    expect(subject).toContain(" / ");
  });

  it("leaves a member's receipts and invitation out of the tagged set, though the audience map says «staff»", () => {
    expect([...MEMBER_FACING].sort()).toEqual(["MEMBER_INVITATION", "SHOP_ORDER_PAID", "SHOP_ORDER_PLACED"]);
    for (const type of MEMBER_FACING) {
      expect(EMAIL_AUDIENCE[type]).toBe("staff");
      expect(OTHERS).toContain(type);
      expect(tagsOfMessageType(type)).toEqual([]);
    }
    // The club's own notice of an order and a colleague's invitation keep theirs.
    expect(tagsOfMessageType("SHOP_ORDER_CLUB_NOTICE")).toEqual(["magazin"]);
    expect(tagsOfMessageType("STAFF_INVITATION")).toEqual(["echipa"]);
  });

  it("pins a few as literals", () => {
    for (const type of MEMBER_FACING) expect(startsWithTag(render(type).subject), type).toBe(false);
    expect(render("REGISTRATION_CONFIRMED").subject).toBe("Înscrierea este confirmată / Your registration is confirmed");
    expect(render("VOLUNTEER_RECEIVED").subject).toBe("Ți-am primit oferta de voluntar pentru Crosul aniversar / We received your offer to volunteer for Crosul aniversar");
    expect(render("EVENT_CANCELLED").subject).toBe("Evenimentul „Crosul aniversar” a fost anulat / “Crosul aniversar” has been cancelled");
  });

  it("leaves the club's copy of a participant's message with its own mark and no tag", () => {
    const copy = buildOutgoingEmail({
      to: "club@example.org",
      locale: "ro",
      idempotencyKey: "test:copy",
      messageType: "REGISTRATION_CONFIRMED",
      data: { ...DATA, clubCopy: true },
    });
    expect(copy.subject.startsWith("[Copie club] ")).toBe(true);
    expect(startsWithTag(copy.subject)).toBe(false);
  });
});

describe("«Scrie-ne» and «Spune-ne ceva»", () => {
  const ROUTE = { from: { name: "Club", address: "club@example.org" }, to: ["club@example.org"], appEnv: "production" as const };
  const CONTACT = { name: "Ana Popescu", email: "ana@example.org", message: "Bună", locale: "ro" as const, pageUrl: "https://example.test/ro/contact" };

  function form(fields: Record<string, unknown>): FeedbackInput {
    return feedbackFields.parse({ locale: "ro", ...fields });
  }
  const SUBJECTS: ReadonlyArray<[string, Record<string, unknown>, string]> = [
    ["howItWent", { branch: "howItWent", event: "", date: "", rating: "4", message: "Frumos", reasons: [], reasonOther: "", email: "" }, "[feedback][cum-a-fost] Cum a fost: altceva / în general"],
    ["suggestion", { branch: "suggestion", message: "Seara", email: "" }, "[feedback][sugestie] O sugestie de pe site"],
    ["complaint", { branch: "complaint", event: "", date: "", message: "Prost", email: "" }, "[feedback][reclamatie] O reclamație de pe site"],
    ["safety", { branch: "safety", message: "Cineva", whereWhen: "", contact: "" }, `[feedback][girl-zone] ${SAFETY_SUBJECT}`],
  ];

  it("tags the contact form's message [contact]", () => {
    expect(renderContactMessage(CONTACT, ROUTE).subject).toBe("[contact] Mesaj de pe site: Ana Popescu");
  });

  it.each(SUBJECTS)("tags the %s form's message", (_branch, fields, subject) => {
    expect(composeFeedbackEmail(form(fields), { eventTitle: null }, "production").subject).toBe(subject);
  });

  it("names the event after «Cum a fost» and the tags", () => {
    const input = form({ branch: "howItWent", event: "running-up", date: "", rating: "4", message: "Frumos", reasons: [], reasonOther: "", email: "" });
    const email = composeFeedbackEmail(input, { eventTitle: "Running Up That Hilly Tâmpa cu Brașov Runners" }, "production");
    expect(email.subject).toBe("[feedback][cum-a-fost] Cum a fost: Running Up That Hilly Tâmpa cu Brașov Runners");
  });

  it("puts QA's mark in front of the tags, joined, on every form", () => {
    expect(renderContactMessage(CONTACT, { ...ROUTE, appEnv: "qa" }).subject).toBe("[QA][contact] Mesaj de pe site: Ana Popescu");
    for (const [, fields, subject] of SUBJECTS) {
      expect(composeFeedbackEmail(form(fields), { eventTitle: null }, "qa").subject).toBe(`[QA]${subject}`);
    }
  });

  it("tags a message that goes to Girl Zone's person [girl-zone], whichever form wrote it, with the neutral words", () => {
    for (const [branch, fields] of SUBJECTS) {
      const email = composeFeedbackEmail(form({ ...fields, ...(branch === "safety" ? {} : { identity: "named", name: "Ana", audience: "person", email: "a@example.org" }) }), { eventTitle: null, toPerson: true }, "production");
      expect(email.subject).toBe(`[feedback][girl-zone] ${SAFETY_SUBJECT}`);
    }
    expect(feedbackTags("complaint", true)).toEqual(["feedback", "girl-zone"]);
    expect(feedbackTags("complaint")).toEqual(["feedback", "reclamatie"]);
  });

  it("tags the platform's two notices [livrare], in both languages, before any other word", () => {
    const facts = { road: "mailgun" as const, carriedBy: "gmail" as const, pageUrl: "https://example.test/admin" };
    for (const locale of ["ro", "en"] as const) {
      for (const kind of ["roadDown", "lost"] as const) {
        const { subject } = relayNoticeContent(kind, locale, { ...facts, form: "contact" });
        expect(subject.startsWith("[livrare] ")).toBe(true);
        expect(subject.length).toBeGreaterThan("[livrare] ".length + 10);
      }
    }
  });
});

describe("the mark helpers", () => {
  it("joins QA's mark to the tags and gives any other subject the mark and a space", () => {
    expect(markSubjectForEnvironment("[contact] x", "qa")).toBe("[QA][contact] x");
    expect(markSubjectForEnvironment("Confirmă-ți înscrierea", "qa")).toBe("[QA] Confirmă-ți înscrierea");
    expect(markSubjectForEnvironment("[Copie club] Confirmat", "qa")).toBe("[QA] [Copie club] Confirmat");
    // A word the club typed in brackets is not a tag: «[QA] » keeps its space.
    expect(markSubjectForEnvironment("[nou] Detalii", "qa")).toBe("[QA] [nou] Detalii");
    expect(startsWithTag("[nou] x")).toBe(false);
    expect(markSubjectForEnvironment("[contact] x", "production")).toBe("[contact] x");
    expect(markSubjectForEnvironment("[contact] x", "local")).toBe("[contact] x");
  });

  it("marks a templated staff subject on QA right after QA's mark, the tags joined to it", () => {
    const { subject } = render("VOLUNTEER_CLUB_NOTICE");
    expect(markSubjectForEnvironment(subject, "qa").startsWith("[QA][voluntari] ")).toBe(true);
    expect(markSubjectForEnvironment(markSubjectForEnvironment(subject, "qa"), "qa")).toBe(markSubjectForEnvironment(subject, "qa"));
  });

  it("is idempotent on a message marked once already", () => {
    const once = markSubjectForEnvironment("[feedback][sugestie] x", "qa");
    expect(markSubjectForEnvironment(once, "qa")).toBe(once);
    const plain = markSubjectForEnvironment("Salut", "qa");
    expect(markSubjectForEnvironment(plain, "qa")).toBe(plain);
  });

  it("puts a mark after QA's and the tags, before the words", () => {
    expect(markAfterTags("[contact] Mesaj", "[posibil spam]")).toBe("[contact][posibil spam] Mesaj");
    expect(markAfterTags("[QA][feedback][sugestie] Mesaj", "[posibil spam]")).toBe("[QA][feedback][sugestie][posibil spam] Mesaj");
    expect(tagSubject([], "Salut")).toBe("Salut");
    // No tag at all: the mark keeps a space before the words.
    expect(markAfterTags("Foo", "[posibil spam]")).toBe("[posibil spam] Foo");
    expect(markAfterTags("[QA] Foo", "[posibil spam]")).toBe("[QA][posibil spam] Foo");
  });
});
