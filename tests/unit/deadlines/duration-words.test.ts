import { describe, expect, it } from "vitest";
import { DEFAULT_DEADLINES } from "@/modules/deadlines/domain/deadlines";
import { daysPhrase, deadlineWords, durationPhrase, hoursPhrase, leadPhrase, minutesPhrase } from "@/modules/deadlines/domain/duration-words";
import { deadlineMergeValues, isMergeField, mergeText, mergeTextSegments } from "@/modules/legal-documents/domain/merge-fields";
import { privacyNoticeEn, privacyNoticeRo } from "@/modules/legal-documents/templates/privacy-notice";
// The notice also names the public list's states since §396, filled from the catalogue as the page fills it.
import { listStatesMergeValues } from "@/modules/registrations/list-state-words";

/**
 * §377 — a deadline as words that agree with its number, in both languages: the one copy the
 * pages, the emails, the PDF and the legal merge fields share. Romanian takes `countForm`'s three
 * forms (§341): "o oră", "2 ore", "20 de ore".
 */
describe("§377 durations as words", () => {
  it("says every unit in Romanian's three forms, and English's two", () => {
    expect([1, 2, 19, 20, 48, 101].map((n) => durationPhrase("ro", n, "hours"))).toEqual(["o oră", "2 ore", "19 ore", "20 de ore", "48 de ore", "101 ore"]);
    expect([1, 5, 30].map((n) => durationPhrase("ro", n, "minutes"))).toEqual(["un minut", "5 minute", "30 de minute"]);
    expect([1, 2, 21].map((n) => durationPhrase("ro", n, "days"))).toEqual(["o zi", "2 zile", "21 de zile"]);
    expect([1, 8, 26].map((n) => durationPhrase("ro", n, "weeks"))).toEqual(["o săptămână", "8 săptămâni", "26 de săptămâni"]);
    expect([1, 2, 48].map((n) => durationPhrase("en", n, "hours"))).toEqual(["one hour", "2 hours", "48 hours"]);
    expect(durationPhrase("en", 1, "days")).toBe("one day");
  });

  it("says a hold in hours once it is a whole number of them", () => {
    expect(minutesPhrase("ro", 30)).toBe("30 de minute");
    expect(minutesPhrase("ro", 90)).toBe("90 de minute");
    expect(minutesPhrase("ro", 60)).toBe("o oră");
    expect(minutesPhrase("ro", 120)).toBe("2 ore");
    expect(minutesPhrase("en", 30)).toBe("30 minutes");
  });

  it("keeps a countdown in hours, always — '2 zile' would leave a runner guessing", () => {
    expect(hoursPhrase("ro", 48)).toBe("48 de ore");
    expect(hoursPhrase("ro", 24)).toBe("24 de ore");
    expect(hoursPhrase("en", 72)).toBe("72 hours");
  });

  it("says a lead in days, and in weeks, once it is a whole number of them", () => {
    expect(leadPhrase("ro", 48)).toBe("2 zile");
    expect(leadPhrase("ro", 24)).toBe("o zi");
    expect(leadPhrase("ro", 36)).toBe("36 de ore");
    expect(leadPhrase("ro", 168)).toBe("o săptămână");
    expect(leadPhrase("en", 72)).toBe("3 days");
    expect(daysPhrase("ro", 56)).toBe("8 săptămâni");
    expect(daysPhrase("ro", 10)).toBe("10 zile");
    expect(daysPhrase("en", 14)).toBe("2 weeks");
  });

  it("words the club's deadlines for a page, with no reminder phrase when it sends none", () => {
    expect(deadlineWords("ro", DEFAULT_DEADLINES)).toEqual({
      confirmation: "48 de ore",
      hold: "30 de minute",
      offer: "24 de ore",
      reminder: "2 zile",
      checkin: "o zi",
      horizon: "8 săptămâni",
    });
    expect(deadlineWords("en", { ...DEFAULT_DEADLINES, reminderHours: 0 }).reminder).toBeNull();
  });
});

describe("§377 the deadlines as legal merge fields", () => {
  it("are merge fields, and fill a text in either language from the setting", () => {
    for (const field of ["confirmationHours", "holdMinutes", "offerHours", "reminderClause", "publicListPeriod"]) expect(isMergeField(field)).toBe(true);
    expect(isMergeField("reminderHours")).toBe(false);
    const text = "Confirmi în {{confirmationHours}}; locul e ținut {{holdMinutes}}; oferta, {{offerHours}}; mesaje: legături{{reminderClause}} și o mulțumire.";
    expect(mergeText(text, deadlineMergeValues("ro", { confirmationHours: 12, holdMinutes: 60, offerHours: 6, reminderHours: 72, publicListDays: 30 }))).toBe(
      "Confirmi în 12 ore; locul e ținut o oră; oferta, 6 ore; mesaje: legături, un memento cu 3 zile înainte (sau cât alege evenimentul) și o mulțumire.",
    );
    // §NNN — how long the public list stays up after the event, the unit included, from the setting.
    expect(mergeText("cel mult {{publicListPeriod}} după eveniment", deadlineMergeValues("ro", DEFAULT_DEADLINES))).toBe("cel mult 30 de zile după eveniment");
    expect(mergeText("for at most {{publicListPeriod}} after the event", deadlineMergeValues("en", { ...DEFAULT_DEADLINES, publicListDays: 14 }))).toBe(
      "for at most 2 weeks after the event",
    );
    expect(mergeText("within {{confirmationHours}}", deadlineMergeValues("en", DEFAULT_DEADLINES))).toBe("within 48 hours");
  });

  it("with a default of none (0) the reminder clause stays, numberless and conditional on the event, in both languages — never '0 ore'", () => {
    const off = { ...DEFAULT_DEADLINES, reminderHours: 0 };
    // An event may still pick 24/48/72 h, so the notice must not list the messages without one.
    expect(deadlineMergeValues("ro", off).reminderClause).toBe(", un memento înainte de start, dacă evenimentul trimite unul");
    expect(deadlineMergeValues("en", off).reminderClause).toBe(", a reminder before the start where the event sends one");
    expect(mergeText("lista de așteptare{{reminderClause}} și o mulțumire", deadlineMergeValues("ro", off))).toBe(
      "lista de așteptare, un memento înainte de start, dacă evenimentul trimite unul și o mulțumire",
    );
    expect(mergeText("the waiting list{{reminderClause}} and a thank-you", deadlineMergeValues("en", off))).toBe(
      "the waiting list, a reminder before the start where the event sends one and a thank-you",
    );
    for (const locale of ["ro", "en"]) {
      const clause = deadlineMergeValues(locale, off).reminderClause;
      expect(clause).not.toMatch(/\d/);
      expect(mergeText(`x{{reminderClause}}y`, deadlineMergeValues(locale, off))).not.toContain("…");
    }
  });

  it("with a default above zero the reminder clause keeps the lead, hedged for the event's own choice, in both languages", () => {
    // An event may pick 24/48/72 h or none, so the club's lead is never a promise for every event.
    expect(mergeText("the waiting list{{reminderClause}} and a thank-you", deadlineMergeValues("en", DEFAULT_DEADLINES))).toBe(
      "the waiting list, a reminder 2 days before (or as the event chooses) and a thank-you",
    );
    expect(mergeText("lista de așteptare{{reminderClause}} și o mulțumire", deadlineMergeValues("ro", DEFAULT_DEADLINES))).toBe(
      "lista de așteptare, un memento cu 2 zile înainte (sau cât alege evenimentul) și o mulțumire",
    );
    expect(deadlineMergeValues("ro", { ...DEFAULT_DEADLINES, reminderHours: 24 }).reminderClause).toBe(
      ", un memento cu o zi înainte (sau cât alege evenimentul)",
    );
    expect(deadlineMergeValues("en", { ...DEFAULT_DEADLINES, reminderHours: 72 }).reminderClause).toBe(", a reminder 3 days before (or as the event chooses)");
  });

  it("an omittable field given nothing leaves nothing behind", () => {
    // Nothing left behind: no dotted blank, no emphasised empty segment.
    expect(mergeTextSegments("a{{reminderClause}}b", { reminderClause: "" })).toEqual([
      { text: "a", filled: false },
      { text: "b", filled: false },
    ]);
    // With no value at all it is still a gap to fill, like every field.
    expect(mergeText("a{{reminderClause}}b", {})).toContain("…");
  });

  it("the platform's privacy notice, merged with a default of no reminder, names a reminder only where the event sends one, in either language", () => {
    const off = { ...DEFAULT_DEADLINES, reminderHours: 0 };
    for (const [locale, body] of [["ro", privacyNoticeRo], ["en", privacyNoticeEn]] as const) {
      const all = body.sections.flatMap((section) => section.paragraphs).map((paragraph) => mergeText(paragraph, { ...deadlineMergeValues(locale, off), ...listStatesMergeValues(locale) })).join(" ");
      expect(all).toContain(locale === "en" ? "a reminder before the start where the event sends one" : "un memento înainte de start, dacă evenimentul trimite unul");
      expect(all).not.toMatch(/\b0 (de )?ore\b|\b0 hours\b/);
      expect(all).not.toContain("…………");
    }
  });

  it("the platform's privacy notice, merged with the club's default lead, names it hedged for the event's own choice, in either language", () => {
    for (const [locale, body] of [["ro", privacyNoticeRo], ["en", privacyNoticeEn]] as const) {
      const all = body.sections.flatMap((section) => section.paragraphs).map((paragraph) => mergeText(paragraph, { ...deadlineMergeValues(locale, DEFAULT_DEADLINES), ...listStatesMergeValues(locale) })).join(" ");
      expect(all).toContain(locale === "en" ? "a reminder 2 days before (or as the event chooses)" : "un memento cu 2 zile înainte (sau cât alege evenimentul)");
      expect(all).not.toContain("…………");
    }
  });
});

/**
 * §NNN — the counsel review of 2026-09-25: a public list left on must not keep names public until
 * the three-year deletion, so the privacy notice promises it closes by itself at most
 * `{{publicListPeriod}}` after the event (§4, §7). A period, never a number in the approved text
 * (§357), with its unit, in words that agree with any value, like the deadlines above.
 */
describe("§NNN the public list's ceiling as a legal merge field", () => {
  it("is a merge field, filled with a period of days in each language", () => {
    expect(isMergeField("publicListPeriod")).toBe(true);
    // One registration, fed from "Termene" (`publicListDays`), never a constant of its own.
    const period = (locale: string, publicListDays: number) => deadlineMergeValues(locale, { ...DEFAULT_DEADLINES, publicListDays }).publicListPeriod;
    expect(deadlineMergeValues("ro", DEFAULT_DEADLINES).publicListPeriod).toBe(daysPhrase("ro", DEFAULT_DEADLINES.publicListDays));
    expect(period("ro", 30)).toBe("30 de zile");
    expect(period("en", 30)).toBe("30 days");
    expect(period("ro", 1)).toBe("o zi");
    expect(period("ro", 14)).toBe("2 săptămâni");
    expect(period("en", 365)).toBe(daysPhrase("en", 365));
  });

  it("is named twice in the platform's notice, §4 and §7, and merges without a blank or a written number", () => {
    for (const [locale, body] of [["ro", privacyNoticeRo], ["en", privacyNoticeEn]] as const) {
      const paragraphs = body.sections.flatMap((section) => section.paragraphs);
      expect(paragraphs.filter((paragraph) => paragraph.includes("{{publicListPeriod}}")).length, locale).toBe(2);
      const all = paragraphs
        .map((paragraph) => mergeText(paragraph, { ...deadlineMergeValues(locale, { ...DEFAULT_DEADLINES, publicListDays: 45 }), ...listStatesMergeValues(locale) }))
        .join(" ");
      expect(all).toContain(locale === "en" ? "at most 45 days after the event" : "cel mult 45 de zile după eveniment");
      expect(all).not.toContain("…………");
      expect(all).not.toContain("{{publicListPeriod}}");
    }
  });
});
