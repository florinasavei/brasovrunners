import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { newsletterTopic } from "@/db/schema/newsletter";
import { describesNewsletter, isMergeField, mergeText } from "@/modules/legal-documents/domain/merge-fields";
import { privacyNoticeEn, privacyNoticeRo } from "@/modules/legal-documents/templates/privacy-notice";
import { DECLARATION_TOKENS } from "@/modules/legal-documents/templates/tokens";
import { EVENT_ALERT_WINDOW_DAYS, eventAlertTopics, eventAlertWanted } from "@/modules/newsletter/domain/alerts";
import { checkNewsletterWords, NEWSLETTER_BODY_MAX, readNewsletterWords } from "@/modules/newsletter/domain/message";
import { isSendableTopic, NEWSLETTER_TOPICS, normalizeTopics, receives, SENDABLE_TOPICS } from "@/modules/newsletter/domain/topics";
import { newsletterMergeValues, topicsPhrase } from "@/modules/newsletter/topic-words";
import { newsletterDialogOpen, parseNewsletterFields, parseNewsletterOutcome } from "@/modules/newsletter/ui/newsletter-box";
import { BULK_MESSAGE_TYPES, bulkBudget, isBulkMessage } from "@/modules/notifications/domain/bulk";
import { isCopiedPerMessage, isParticipantMessage } from "@/modules/notifications/domain/club-notices";
import { emailSampleActionUrl, emailSampleFor } from "@/modules/notifications/email-copy-fields";
import { renderBilingual } from "@/modules/notifications/templates";
import { canSendNewsletter } from "@/modules/staff-identity/domain/roles";
import en from "../../../messages/en.json";
import ro from "../../../messages/ro.json";

const NOW = new Date("2026-10-01T10:00:00.000Z");
const DAY = 24 * 60 * 60_000;

/** §NNN — the newsletter's pure rules: topics, alerts, words, the reserve, the notice's switch, the messages. */
describe("§NNN the newsletter's topics", () => {
  it("offers the owner's list and more, 'everything' first, every name and hint in both languages", () => {
    expect(NEWSLETTER_TOPICS[0]).toBe("ALL");
    for (const topic of ["BIG_EVENTS", "DISCOUNTS", "GEAR_TESTING", "SPECIAL_EVENTS", "NEW_EVENTS"] as const) expect(NEWSLETTER_TOPICS).toContain(topic);
    for (const catalogue of [ro, en]) {
      for (const topic of newsletterTopic.enumValues) {
        expect(catalogue.Newsletter.topics[topic], topic).toBeTruthy();
        expect(catalogue.Newsletter.topicHints[topic], topic).toBeTruthy();
      }
    }
    expect(SENDABLE_TOPICS).not.toContain("ALL");
    expect(isSendableTopic("ALL")).toBe(false);
    expect(isSendableTopic("DISCOUNTS")).toBe(true);
    expect(isSendableTopic("SPAM")).toBe(false);
  });

  it("reads the ticks in the catalogue's order, once each, 'everything' alone, nothing that is not a topic", () => {
    expect(normalizeTopics(["DISCOUNTS", "NEW_EVENTS", "DISCOUNTS", "x", 3])).toEqual(["NEW_EVENTS", "DISCOUNTS"]);
    expect(normalizeTopics(["VOLUNTEERING", "ALL"])).toEqual(["ALL"]);
    expect(normalizeTopics([])).toEqual([]);
  });

  it("delivers a send to a subscriber of any of its topics, and to everything's", () => {
    expect(receives(["ALL"], ["DISCOUNTS"])).toBe(true);
    expect(receives(["DISCOUNTS"], ["DISCOUNTS"])).toBe(true);
    expect(receives(["VOLUNTEERING"], ["NEW_EVENTS", "BIG_EVENTS"])).toBe(false);
    expect(receives(["BIG_EVENTS"], ["NEW_EVENTS", "BIG_EVENTS"])).toBe(true);
  });

  it("names the topics as one quoted phrase in each language", () => {
    expect(topicsPhrase("ro", ["NEW_EVENTS", "DISCOUNTS"])).toBe("„Evenimente noi în calendar” și „Coduri de reducere”");
    expect(topicsPhrase("en", ["NEW_EVENTS"])).toBe("“New events on the calendar”");
    expect(newsletterMergeValues("en").newsletterTopics).toContain("“Everything the club sends”");
  });
});

describe("§NNN the new-event alert", () => {
  const race = {
    type: "RACE",
    isSpecial: false,
    editorialStatus: "PUBLISHED",
    eventStatus: "SCHEDULED",
    startsAt: new Date(NOW.getTime() + 30 * DAY),
    publishedAt: new Date(NOW.getTime() - 60 * 60_000),
    repeatOf: null,
    repeats: false,
    partnered: false,
  };

  it("announces a published, scheduled event ahead, first published within the window", () => {
    expect(eventAlertWanted(race, NOW)).toBe(true);
    expect(eventAlertWanted({ ...race, publishedAt: new Date(NOW.getTime() - (EVENT_ALERT_WINDOW_DAYS + 1) * DAY) }, NOW)).toBe(false);
    expect(eventAlertWanted({ ...race, editorialStatus: "DRAFT" }, NOW)).toBe(false);
    expect(eventAlertWanted({ ...race, eventStatus: "CANCELLED" }, NOW)).toBe(false);
    expect(eventAlertWanted({ ...race, startsAt: new Date(NOW.getTime() - DAY) }, NOW)).toBe(false);
    expect(eventAlertWanted({ ...race, repeatOf: "source" }, NOW)).toBe(false);
  });

  it("never announces a repeated group run, source or date; announces one held once, and any special edition", () => {
    expect(eventAlertWanted({ ...race, type: "GROUP_RUN", repeats: true }, NOW)).toBe(false);
    expect(eventAlertWanted({ ...race, type: "GROUP_RUN", repeatOf: "source" }, NOW)).toBe(false);
    expect(eventAlertWanted({ ...race, type: "GROUP_RUN" }, NOW)).toBe(true);
    expect(eventAlertWanted({ ...race, type: "GROUP_RUN", repeats: true, isSpecial: true }, NOW)).toBe(true);
    expect(eventAlertWanted({ ...race, type: "HIKE", repeatOf: "source", isSpecial: true }, NOW)).toBe(true);
    // A special edition still waits for publication and a start ahead.
    expect(eventAlertWanted({ ...race, type: "GROUP_RUN", isSpecial: true, eventStatus: "CANCELLED" }, NOW)).toBe(false);
  });

  it("goes to new events always, and to the event's own topics", () => {
    expect(eventAlertTopics({ type: "HIKE", isSpecial: false, partnered: false })).toEqual(["NEW_EVENTS"]);
    expect(eventAlertTopics({ type: "RACE", isSpecial: true, partnered: false })).toEqual(["NEW_EVENTS", "BIG_EVENTS", "SPECIAL_EVENTS"]);
    expect(eventAlertTopics({ type: "GEAR_TEST", isSpecial: false, partnered: false })).toEqual(["NEW_EVENTS", "GEAR_TESTING"]);
    // "Events held with other organizers", as the topic's hint says: another organizer's, or with partners.
    expect(eventAlertTopics({ type: "EXTERNAL", isSpecial: false, partnered: false })).toEqual(["NEW_EVENTS", "SPECIAL_EVENTS"]);
    expect(eventAlertTopics({ type: "HIKE", isSpecial: false, partnered: true })).toEqual(["NEW_EVENTS", "SPECIAL_EVENTS"]);
    expect(eventAlertTopics({ type: "GROUP_RUN", isSpecial: true, partnered: false })).toEqual(["NEW_EVENTS", "SPECIAL_EVENTS"]);
  });
});

describe("§NNN a newsletter's words", () => {
  it("wants both languages of both texts, within their ceilings, with no field in braces", () => {
    const ok = checkNewsletterWords({ subject: { ro: " Știri\n", en: "News" }, body: { ro: "Salut\r\n\r\nText", en: "Hi" } });
    expect(ok.words).toEqual({ subject: { ro: "Știri", en: "News" }, body: { ro: "Salut\n\nText", en: "Hi" } });
    const bad = checkNewsletterWords({ subject: { ro: "", en: "{eventTitle}" }, body: { ro: "x".repeat(NEWSLETTER_BODY_MAX + 1), en: "ok" } });
    expect(bad.words).toBeNull();
    expect(bad.issues).toEqual([
      { box: "subjectRo", problem: "empty" },
      { box: "subjectEn", problem: "placeholder", names: ["eventTitle"] },
      { box: "bodyRo", problem: "tooLong" },
    ]);
  });

  it("reads a stored send only when both languages are there", () => {
    expect(readNewsletterWords({ ro: "a", en: "b" }, { ro: "c", en: "d" })).toEqual({ subject: { ro: "a", en: "b" }, body: { ro: "c", en: "d" } });
    expect(readNewsletterWords({ ro: "a" }, { ro: "c", en: "d" })).toBeNull();
    expect(readNewsletterWords(null, null)).toBeNull();
  });
});

describe("§NNN the reserve the outbox keeps for everything else", () => {
  it("lets a newsletter use only what exceeds half a daily allowance, or a fifth of a monthly one", () => {
    expect(bulkBudget({ period: "day", allowance: 100, remaining: 100 })).toBe(50);
    expect(bulkBudget({ period: "day", allowance: 100, remaining: 30 })).toBe(0);
    expect(bulkBudget({ period: "month", allowance: 10_000, remaining: 9_000 })).toBe(7_000);
    expect(bulkBudget({ period: "none", allowance: null, remaining: null })).toBeNull();
  });

  it("treats the newsletter and the alert as bulk, and nothing a participant is waiting for", () => {
    expect([...BULK_MESSAGE_TYPES].sort()).toEqual(["NEWSLETTER", "NEW_EVENT_ALERT"]);
    expect(isBulkMessage("NEWSLETTER_CONFIRM")).toBe(false);
    expect(isBulkMessage("VERIFY_REGISTRATION_EMAIL")).toBe(false);
  });

  it("gives none of the three a club copy: they are a subscriber's, not a participant's", () => {
    for (const type of ["NEWSLETTER_CONFIRM", "NEWSLETTER", "NEW_EVENT_ALERT"] as const) {
      expect(isParticipantMessage(type), type).toBe(false);
      expect(isCopiedPerMessage(type), type).toBe(false);
    }
  });

  it("is sent by the organizer and above", () => {
    expect(canSendNewsletter("MODERATOR")).toBe(true);
    expect(canSendNewsletter("ADMIN")).toBe(true);
    expect(canSendNewsletter("COPYWRITER")).toBe(false);
    expect(canSendNewsletter("CONTRIBUTOR")).toBe(false);
    expect(canSendNewsletter("DEV")).toBe(false);
  });
});

describe("§NNN the privacy notice is the switch", () => {
  it("is a merge field, filled in both languages, and the platform's notice names it in §5", () => {
    expect(isMergeField("newsletterTopics")).toBe(true);
    for (const [locale, notice] of [
      ["ro", privacyNoticeRo],
      ["en", privacyNoticeEn],
    ] as const) {
      expect(describesNewsletter(notice), locale).toBe(true);
      const section = notice.sections.find((candidate) => candidate.heading?.startsWith("5."));
      const paragraph = section?.paragraphs.find((text) => text.includes("{{newsletterTopics}}")) ?? "";
      const merged = mergeText(paragraph, newsletterMergeValues(locale));
      expect(merged).not.toContain("{{");
      expect(merged).not.toContain("…………");
      expect(merged).toContain(locale === "ro" ? "6(1)(a)" : "6(1)(a)");
      // The retention in §7, never a setting.
      expect(notice.sections.find((candidate) => candidate.heading?.startsWith("7."))?.paragraphs.join(" ")).toContain(locale === "ro" ? "newsletter" : "newsletter");
    }
    expect(describesNewsletter({ sections: [{ paragraphs: ["nothing"] }] })).toBe(false);
    expect(DECLARATION_TOKENS.some((entry) => entry.token === "{{newsletterTopics}}")).toBe(true);
    for (const catalogue of [ro, en]) expect(catalogue.Admin.legal.tokens.newsletterTopics).toBeTruthy();
  });
});

describe("§NNN the three messages", () => {
  const action = emailSampleActionUrl("ro");

  it("confirms with the topics and the link's life, and never offers an unsubscribe link before there is a subscription", () => {
    const message = renderBilingual("NEWSLETTER_CONFIRM", "ro", emailSampleFor("NEWSLETTER_CONFIRM", "ro"), action);
    expect(message.subject).toContain("Confirmă abonarea");
    expect(message.text).toContain("Primești noutățile clubului despre: „Evenimente noi în calendar” și „Coduri de reducere”.");
    expect(message.text).toContain("You receive the club's news about: “New events on the calendar” and “Discount codes”.");
    expect(message.text).toContain("Linkul este valabil");
    expect(message.text).not.toContain("dezabonează-te");
    const already = renderBilingual("NEWSLETTER_CONFIRM", "ro", { ...emailSampleFor("NEWSLETTER_CONFIRM", "ro"), newsletterAlready: true }, action);
    expect(already.subject).toContain("Abonamentul tău");
    expect(already.text).toContain("Vezi abonamentul");
    expect(already.text).not.toContain("Linkul este valabil");
  });

  it("sends the club's words in the subscriber's language first, the way out under them, and the notice's line", () => {
    const message = renderBilingual("NEWSLETTER", "en", emailSampleFor("NEWSLETTER", "en"), undefined);
    expect(message.subject).toBe("A discount code for running shoes / Cod de reducere la încălțăminte de alergare");
    const [english, romanian] = message.text.split("— — —");
    expect(english).toContain("Our partner offers subscribers 15% off");
    expect(english).toContain("Choose what you receive, or unsubscribe");
    expect(english).toContain("because you asked for the club's news");
    expect(romanian).toContain("Alege ce primești sau dezabonează-te");
    // Plain text: a pair of asterisks typed in it is not bold.
    const starred = renderBilingual("NEWSLETTER", "ro", { ...emailSampleFor("NEWSLETTER", "ro"), newsletterBody: "**nu**" }, undefined);
    expect(starred.html).toContain("**nu**");
  });

  it("announces a new event with its facts, its page as the button and the way out", () => {
    const message = renderBilingual("NEW_EVENT_ALERT", "ro", emailSampleFor("NEW_EVENT_ALERT", "ro"), action);
    expect(message.subject).toContain("Eveniment nou în calendar: Crosul de toamnă");
    expect(message.text).toContain("Vezi evenimentul");
    expect(message.text).toContain("Alege ce primești sau dezabonează-te");
  });
});

describe("§NNN the contact page's pop-up", () => {
  it("reads its outcome and its boxes from the address, and opens itself only to be fixed or asked for", () => {
    expect(parseNewsletterOutcome("sent")).toBe("sent");
    expect(parseNewsletterOutcome("<script>")).toBeNull();
    expect(newsletterDialogOpen("invalid")).toBe(true);
    expect(newsletterDialogOpen("open")).toBe(true);
    expect(newsletterDialogOpen("sent")).toBe(false);
    expect(parseNewsletterFields("email,topics,name")).toEqual(["email", "topics"]);
  });

  it("has one island, the button, and draws the form, the ticks and the notice's link on the server", () => {
    const dir = path.join(process.cwd(), "src/modules/newsletter/ui");
    const islands = readdirSync(dir).filter((file) => readFileSync(path.join(dir, file), "utf8").startsWith('"use client"'));
    expect(islands).toEqual(["NewsletterDialogButton.tsx"]);
    const signup = readFileSync(path.join(dir, "NewsletterSignup.tsx"), "utf8");
    expect(signup).toContain('component="dialog"');
    expect(signup).toContain('<form method="dialog">');
    expect(signup).toContain('name="honeypot"');
    expect(signup).toContain('href="/legal/privacy"');
    expect(signup).toContain("minHeight: TAP_TARGET.minHeight");
  });
});
