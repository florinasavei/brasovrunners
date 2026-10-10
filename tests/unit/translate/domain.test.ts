import { describe, expect, it } from "vitest";
import { budgetAllows, DEFAULT_TRANSLATION_BUDGET, readTranslationBudgetValue, translationBudgetSchema } from "@/modules/translate/domain/budget";
import { isRichTextField, isTranslatableEnglishField, romanianTwinCandidates } from "@/modules/translate/domain/fields";
import { CLUB_GLOSSARY, glossaryContext } from "@/modules/translate/domain/glossary";
import { protectPlaceholders, restorePlaceholders } from "@/modules/translate/domain/placeholders";
import { canTranslateTexts, STAFF_ROLES } from "@/modules/staff-identity/domain/roles";

/**
 * §464 — «Tradu din română»: which boxes may be filled (the club's own words, never a legal text
 * or a participant's data), where each one's Romanian twin is, the glossary the provider reads,
 * the daily budget, and who may press.
 */

describe("§464 the boxes that may be translated", () => {
  it("allows the club's content and message boxes in English", () => {
    for (const name of [
      "translations.en.title",
      "translations.en.excerptBody",
      "translations.en.body",
      "translations.en.rules",
      "translations.en.schedule",
      "translations.en.routeDescription",
      "translations.en.checklist",
      "translations.en.seoTitle",
      "translations.en.seoDescription",
      "translations.en.discountNote",
      "translations.en.description",
      "event.locationNameEn",
      "event.coHosts[0].descriptionEn",
      "event.coHosts[2].links[3].labelEn",
      "event.links[11].labelEn",
      "event.schedule[4].en",
      "notice.noteEn",
      "cancel.reasonEn",
      "subjectEn",
      "bodyEn",
      // «Echipa» as an organisational chart (§691): a card's sub-role and responsibilities, a box's title and text.
      "subtitleEn",
      "responsibilitiesEn",
      "titleEn",
      "bodyEnBody",
    ]) {
      expect(isTranslatableEnglishField(name), name).toBe(true);
    }
  });

  it("refuses the Romanian side, an address, a legal text and any participant's box", () => {
    for (const name of [
      "translations.ro.title",
      "translations.en.slug",
      "event.locationName",
      "bodyJson",
      "body",
      "legal.bodyEn",
      "translations.en.title.extra",
      "firstName",
      "email",
      "emergencyContactName",
      "healthNote",
      "idDocument",
    ]) {
      expect(isTranslatableEnglishField(name), name).toBe(false);
    }
  });

  it("knows a rich text from a plain box", () => {
    expect(isRichTextField("translations.en.body")).toBe(true);
    expect(isRichTextField("translations.en.routeDescription")).toBe(true);
    expect(isRichTextField("translations.en.title")).toBe(false);
    expect(isRichTextField("bodyEn")).toBe(false);
    // A box under «Echipa»'s chart (§691): its text is a rich text, its title a plain box.
    expect(isRichTextField("bodyEnBody")).toBe(true);
    expect(isRichTextField("titleEn")).toBe(false);
    expect(isRichTextField("responsibilitiesEn")).toBe(false);
  });

  it("finds the Romanian twin by the pair's own spelling", () => {
    expect(romanianTwinCandidates("translations.en.body")).toEqual(["translations.ro.body"]);
    expect(romanianTwinCandidates("event.schedule[2].en")).toEqual(["event.schedule[2].ro"]);
    expect(romanianTwinCandidates("notice.noteEn")).toEqual(["notice.noteRo", "notice.note"]);
    // «Echipa»'s chart (§691): the responsibilities' textarea and a box's rich text.
    expect(romanianTwinCandidates("responsibilitiesEn")).toEqual(["responsibilitiesRo", "responsibilities"]);
    expect(romanianTwinCandidates("bodyEnBody")).toEqual(["bodyRoBody"]);
    // The meeting place's Romanian box has no suffix (§362).
    expect(romanianTwinCandidates("event.locationNameEn")).toContain("event.locationName");
  });
});

describe("§464 the glossary", () => {
  it("names the club's terms and the rule for names and numbers, in the context the provider reads", () => {
    const context = glossaryContext();
    for (const [ro, en] of CLUB_GLOSSARY) {
      expect(context).toContain(ro);
      expect(context).toContain(en);
    }
    expect(context).toContain("«Alergare de grup» = \"group run\"");
    expect(context).toContain("«Concurs» = \"race\"");
    expect(context).toContain("«Cros» = \"cross-country race\"");
    expect(context).toMatch(/names .* exactly as written/);
    expect(context).toMatch(/number, time, date and distance unchanged/);
  });
});

describe("§464 the daily budget", () => {
  it("is fifty thousand characters unless set, and reads anything unreadable as that", () => {
    expect(DEFAULT_TRANSLATION_BUDGET).toEqual({ dailyCharacters: 50_000 });
    expect(readTranslationBudgetValue(null)).toEqual({ dailyCharacters: 50_000 });
    expect(readTranslationBudgetValue({ dailyCharacters: -1 })).toEqual({ dailyCharacters: 50_000 });
    expect(readTranslationBudgetValue({ dailyCharacters: 0 })).toEqual({ dailyCharacters: 0 });
    expect(readTranslationBudgetValue({ dailyCharacters: 120_000 })).toEqual({ dailyCharacters: 120_000 });
  });

  it("takes a whole number from 0 to 500 000 as typed in the box", () => {
    expect(translationBudgetSchema.parse({ dailyCharacters: "20000" })).toEqual({ dailyCharacters: 20_000 });
    for (const bad of ["", "-5", "2.5", "500001", "mult"]) expect(translationBudgetSchema.safeParse({ dailyCharacters: bad }).success, bad).toBe(false);
  });

  it("lets a press through only while it fits what is left today", () => {
    const budget = { dailyCharacters: 1_000 };
    expect(budgetAllows(0, 1_000, budget)).toEqual({ allowed: true, remaining: 1_000 });
    expect(budgetAllows(400, 700, budget)).toEqual({ allowed: false, remaining: 600 });
    expect(budgetAllows(1_500, 1, budget)).toEqual({ allowed: false, remaining: 0 });
    expect(budgetAllows(0, 1, { dailyCharacters: 0 }).allowed).toBe(false);
  });
});

describe("§464 who may press (BR-REQ-060-01)", () => {
  it("is whoever writes the club's words: Redactor, Organizer, Administrator, Superadministrator", () => {
    expect(STAFF_ROLES.filter(canTranslateTexts)).toEqual(["COPYWRITER", "MODERATOR", "ADMIN", "SUPERADMIN"]);
  });
});

describe("§464 placeholders never reach the provider as words", () => {
  it("swaps each {name} for a numbered marker and puts the original back byte for byte", () => {
    const source = "Salut {participantName}, {eventTitle} e mâine; {participantName} ia frontala.";
    const guarded = protectPlaceholders(source);
    expect(guarded.text).toBe("Salut {0}, {1} e mâine; {2} ia frontala.");
    expect(guarded.tokens).toEqual(["{participantName}", "{eventTitle}", "{participantName}"]);
    expect(restorePlaceholders(guarded.text, guarded.tokens)).toBe(source);
  });

  it("finds a marker the provider spaced, and leaves text without placeholders untouched", () => {
    expect(restorePlaceholders("Hi { 0 }, see you at {1 }.", ["{participantName}", "{eventTitle}"])).toBe(
      "Hi {participantName}, see you at {eventTitle}.",
    );
    expect(protectPlaceholders("Tura de luni")).toEqual({ text: "Tura de luni", tokens: [] });
    expect(restorePlaceholders("Pace {0}", [])).toBe("Pace {0}");
  });
});
