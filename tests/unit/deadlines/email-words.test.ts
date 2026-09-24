import { describe, expect, it } from "vitest";
import { EMAIL_COPY_PLACEHOLDERS, emailCopySchema } from "@/modules/notifications/domain/email-copy";
import { buildTemplateContent, renderBilingual, type TemplateData } from "@/modules/notifications/templates";

/**
 * §NNN — the emails say the club's numbers. Each half of a bilingual message words the deadlines
 * it is handed in its own language; the club's own copy (§247) may name them through four
 * placeholders that fill in number and noun together; and a message rendered without the numbers
 * — a fixture — reads today's constants rather than a blank.
 */
const base: TemplateData = { participantName: "Ana Popescu", eventTitle: "Crosul de toamnă" };
const timings = { confirmationHours: 12, holdMinutes: 60, offerHours: 6, reminderHours: 72, confirmationOpensDays: 10, linkDays: 14 };

const text = (content: ReturnType<typeof buildTemplateContent>) =>
  content.paragraphs.map((part) => (typeof part === "string" ? part : part.text.join("\n"))).join("\n");

describe("§NNN the emails word the club's deadlines", () => {
  it("says the event is coming rather than a lead, in each half's language (§357)", () => {
    const both = renderBilingual("EVENT_REMINDER", "ro", { ...base, timings }, "https://example.test/x");
    expect(both.text).toContain("Crosul de toamnă se apropie.");
    expect(both.text).toContain("Crosul de toamnă is coming up.");
    expect(both.text).not.toContain("3 zile");
  });

  it("says the event is coming, with no lead, when it sends no reminder (a reminder resent by hand)", () => {
    const content = buildTemplateContent("EVENT_REMINDER", "ro", { ...base, timings: { ...timings, reminderHours: 0 } }, undefined);
    expect(text(content)).toContain("Crosul de toamnă se apropie.");
  });

  it("says when the participation window opens, from the event's own days", () => {
    const content = buildTemplateContent("COMPLETE_DECLARATION", "ro", { ...base, confirmLater: true, holdExpiresAtFormatted: "vineri, 9 oct.", timings }, "https://example.test/x");
    expect(text(content)).toContain("când îți reamintim, cu 10 zile înainte de start.");
    const week = buildTemplateContent("COMPLETE_DECLARATION", "en", { ...base, confirmLater: true, timings: { ...timings, confirmationOpensDays: 7 } }, "https://example.test/x");
    expect(text(week)).toContain("or when we remind you one week before the start.");
  });

  it("the first send promises the reminder; the send when the window opens is the reminder and promises none, in both languages", () => {
    const first = { ...base, confirmLater: true, holdExpiresAtFormatted: "vineri, 9 oct.", timings };
    const firstBoth = renderBilingual("COMPLETE_DECLARATION", "ro", first, "https://example.test/x");
    expect(firstBoth.text).toContain("sau când îți reamintim, cu 10 zile înainte de start.");
    expect(firstBoth.text).toContain("or when we remind you 10 days before the start.");

    const opened = renderBilingual("COMPLETE_DECLARATION", "ro", { ...first, windowOpen: true }, "https://example.test/x");
    expect(opened.text).not.toContain("îți reamintim");
    expect(opened.text).not.toContain("when we remind you");
    expect(opened.text).toContain("Semnează acum, din linkul de mai jos.");
    expect(opened.text).toContain("Sign now, from the link below.");
  });

  it("says how long the 'my registrations' link lives, from the constant it is minted with", () => {
    expect(text(buildTemplateContent("PROFILE_MANAGE_LINK", "ro", { ...base, timings }, "https://example.test/x"))).toContain("Linkul este valabil 14 zile");
    expect(text(buildTemplateContent("PROFILE_MANAGE_LINK", "en", base, "https://example.test/x"))).toContain("The link is valid for 14 days");
  });

  it("reads today's constants when a caller hands no numbers — never a blank where a duration belongs", () => {
    expect(text(buildTemplateContent("PROFILE_MANAGE_LINK", "ro", base, "https://example.test/x"))).toContain("Linkul este valabil 14 zile");
    expect(text(buildTemplateContent("VERIFY_REGISTRATION_EMAIL", "ro", base, "https://example.test/x"))).not.toMatch(/ {2}|valabil +și/);
  });

  it("fills the four deadline placeholders in the club's own words, number and noun together, per half", () => {
    expect(EMAIL_COPY_PLACEHOLDERS).toEqual(expect.arrayContaining(["confirmationHours", "holdMinutes", "offerHours", "reminderHours"]));
    const copy = emailCopySchema.parse({
      "VERIFY_REGISTRATION_EMAIL:ro": {
        subject: "Confirmă în {confirmationHours}",
        paragraphs: ["Locul e ținut {holdMinutes}; o ofertă stă {offerHours}; reminderul pleacă cu {reminderHours} înainte."],
      },
      "VERIFY_REGISTRATION_EMAIL:en": {
        subject: "Confirm within {confirmationHours}",
        paragraphs: ["A place is held {holdMinutes}; an offer stands {offerHours}; the reminder goes {reminderHours} before."],
      },
    });
    const ro = buildTemplateContent("VERIFY_REGISTRATION_EMAIL", "ro", { ...base, timings }, "https://example.test/x", copy);
    expect(ro.subject).toBe("Confirmă în 12 ore");
    expect(text(ro)).toContain("Locul e ținut o oră; o ofertă stă 6 ore; reminderul pleacă cu 3 zile înainte.");
    const en = buildTemplateContent("VERIFY_REGISTRATION_EMAIL", "en", { ...base, timings }, "https://example.test/x", copy);
    expect(en.subject).toBe("Confirm within 12 hours");
    expect(text(en)).toContain("A place is held one hour; an offer stands 6 hours; the reminder goes 3 days before.");
  });
});
