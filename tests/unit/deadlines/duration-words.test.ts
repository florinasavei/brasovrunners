import { describe, expect, it } from "vitest";
import { DEFAULT_DEADLINES } from "@/modules/deadlines/domain/deadlines";
import { daysPhrase, deadlineWords, durationPhrase, hoursPhrase, leadPhrase, minutesPhrase } from "@/modules/deadlines/domain/duration-words";
import { deadlineMergeValues, isMergeField, mergeText } from "@/modules/legal-documents/domain/merge-fields";

/**
 * §NNN — a deadline as words that agree with its number, in both languages: the one copy the
 * pages, the emails, the PDF and the legal merge fields share. Romanian takes `countForm`'s three
 * forms (§341): "o oră", "2 ore", "20 de ore".
 */
describe("§NNN durations as words", () => {
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

describe("§NNN the deadlines as legal merge fields", () => {
  it("are merge fields, and fill a text in either language from the setting", () => {
    for (const field of ["confirmationHours", "holdMinutes", "offerHours", "reminderHours"]) expect(isMergeField(field)).toBe(true);
    const text = "Confirmi în {{confirmationHours}}; locul e ținut {{holdMinutes}}; oferta, {{offerHours}}; reminderul, cu {{reminderHours}} înainte.";
    expect(mergeText(text, deadlineMergeValues("ro", { confirmationHours: 12, holdMinutes: 60, offerHours: 6, reminderHours: 72 }))).toBe(
      "Confirmi în 12 ore; locul e ținut o oră; oferta, 6 ore; reminderul, cu 3 zile înainte.",
    );
    expect(mergeText("within {{confirmationHours}}", deadlineMergeValues("en", DEFAULT_DEADLINES))).toBe("within 48 hours");
  });
});
