import PDFDocument from "pdfkit";
import { afterEach, describe, expect, it, vi } from "vitest";
import en from "../../../messages/en.json";
import ro from "../../../messages/ro.json";
import { GROUP_RUN_TOO_YOUNG, parseGroupRunInvalid, refusedTooYoung } from "@/modules/group-run-declarations/form";
import { birthDateRefusal, groupRunMinimumAge } from "@/modules/group-run-declarations/domain";
import type { LegalDocumentBody } from "@/modules/legal-documents/domain/content-hash";
import { BLANK, dropsParagraph, mergeLegalBody, mergeTextSegments, minimumAgeMergeValue } from "@/modules/legal-documents/domain/merge-fields";
import { groupRunAsphaltEn, groupRunAsphaltRo, groupRunTrailEn, groupRunTrailRo } from "@/modules/legal-documents/templates/group-run-declaration";
import { DECLARATION_TOKENS } from "@/modules/legal-documents/templates/tokens";
import { isUnderMinimumAge } from "@/modules/registrations/domain/age";
import { renderDeclarationPdf } from "@/modules/registrations/declaration-pdf";
import { declarationWords } from "@/modules/registrations/declaration-labels";

/**
 * §440 (amending §393) — the owner, 2026-09-26: "la declarațiile pentru alergările de grup trebuie
 * să configurez vârsta minimă, și să apară în declarație". The run's minimum is the event's own
 * (§329), stated through `{{minimumAge}}` in both surfaces and both languages, the sentence left out
 * whole at zero, and the signing page refuses a birth date under it by the race's one rule.
 */

const TEXTS = [
  { name: "asphalt ro", body: groupRunAsphaltRo, locale: "ro" },
  { name: "asphalt en", body: groupRunAsphaltEn, locale: "en" },
  { name: "trail ro", body: groupRunTrailRo, locale: "ro" },
  { name: "trail en", body: groupRunTrailEn, locale: "en" },
] as const;

const SENTENCE = { ro: "Declar că am cel puțin {{minimumAge}}.", en: "I declare that I am at least {{minimumAge}} old." } as const;
const paragraphs = (body: LegalDocumentBody) => body.sections.flatMap((section) => [...section.paragraphs]);

describe("§440 {{minimumAge}} in the group-run templates", () => {
  it("is a sentence of its own, right after the opening, in both surfaces and both languages", () => {
    for (const { name, body, locale } of TEXTS) {
      expect(paragraphs(body)[1], name).toBe(SENTENCE[locale]);
    }
  });

  it("fills sixteen with its unit, and twenty with Romanian's 'de'", () => {
    for (const { name, body, locale } of TEXTS) {
      const merged = paragraphs(mergeLegalBody(body, { minimumAge: minimumAgeMergeValue(16, locale) }));
      expect(merged[1], name).toBe(locale === "ro" ? "Declar că am cel puțin 16 ani." : "I declare that I am at least 16 years old.");
      expect(merged.join(" "), name).not.toContain("{{minimumAge}}");
    }
    expect(minimumAgeMergeValue(20, "ro")).toBe("20 de ani");
    expect(minimumAgeMergeValue(1, "en")).toBe("1 year");
  });

  it("leaves the whole sentence out at zero, and nothing else", () => {
    for (const { name, body, locale } of TEXTS) {
      const value = minimumAgeMergeValue(0, locale);
      expect(value).toBe("");
      const merged = paragraphs(mergeLegalBody(body, { minimumAge: value }));
      expect(merged, name).toHaveLength(paragraphs(body).length - 1);
      expect(merged.join(" "), name).not.toMatch(/cel puțin|at least .* old|0 ani|0 years/);
      expect(dropsParagraph(SENTENCE[locale], { minimumAge: value })).toBe(true);
    }
  });

  it("keeps the sentence with its dotted blank when no event gave a value (a preview, the blank form)", () => {
    expect(dropsParagraph(SENTENCE.ro, {})).toBe(false);
    expect(mergeTextSegments(SENTENCE.ro, {}).map((segment) => segment.text).join("")).toBe(`Declar că am cel puțin ${BLANK}.`);
  });

  it("is registered in the token legend, with an example and words in both catalogues", () => {
    const entry = DECLARATION_TOKENS.find((token) => token.token === "{{minimumAge}}");
    expect(entry?.example).toEqual({ ro: "16 ani", en: "16 years" });
    expect(ro.Admin.legal.tokens.minimumAge).toBeTruthy();
    expect(en.Admin.legal.tokens.minimumAge).toBeTruthy();
  });
});

describe("§440 the signed PDF with and without the sentence", () => {
  afterEach(() => vi.restoreAllMocks());

  it("draws the sentence at sixteen and leaves it out at zero, in both surfaces", async () => {
    const now = new Date("2026-10-01T08:00:00Z");
    for (const { name, body, locale } of TEXTS) {
      for (const minAge of [16, 0]) {
        // What the PDF actually draws, not only what it is handed (`drawEntry`'s `dropsParagraph`).
        const drawn: string[] = [];
        const text = PDFDocument.prototype.text;
        vi.spyOn(PDFDocument.prototype, "text").mockImplementation(function (this: PDFKit.PDFDocument, ...args: unknown[]) {
          if (typeof args[0] === "string") drawn.push(args[0]);
          return (text as (...a: unknown[]) => PDFKit.PDFDocument).apply(this, args);
        });
        const pdf = await renderDeclarationPdf({
          entries: [
            {
              title: "Declarație",
              body,
              values: { participant: "Ana Popescu", event: "Tura", minimumAge: minimumAgeMergeValue(minAge, locale) },
              eventTitle: "Tura",
              version: 1,
              contentSha256: "0".repeat(64),
              signature: { typedName: "Ana Popescu", idDocument: null, minor: null, signedAt: "1 octombrie 2026", method: "—" },
            },
          ],
          locale,
          generatedAt: now,
          labels: declarationWords(locale, now),
        });
        vi.restoreAllMocks();
        expect(pdf.subarray(0, 5).toString(), `${name} ${minAge}`).toBe("%PDF-");
        const all = drawn.join(" ");
        if (minAge === 16) expect(all, name).toContain(locale === "ro" ? "16 ani" : "16 years");
        else expect(all, name).not.toMatch(/cel puțin|at least/);
      }
    }
  });
});

describe("§440 the age gate: one rule, the race's", () => {
  // The run starts at 19:00 in Brașov on 7 October 2026. Twenty-one: only a minimum above the
  // adults-only text's eighteen binds anyone (`groupRunMinimumAge`).
  const run = { minAge: 21, startsAt: new Date("2026-10-07T16:00:00Z"), timezone: "Europe/Bucharest" };

  it("refuses the day before the twenty-first birthday and takes the day of it", () => {
    expect(birthDateRefusal(run, "2005-10-08")).toEqual(["birthDate", GROUP_RUN_TOO_YOUNG]);
    expect(birthDateRefusal(run, "2005-10-07")).toEqual([]);
    expect(isUnderMinimumAge("2010-10-08", "2026-10-07", 16)).toBe(true);
    expect(isUnderMinimumAge("2010-10-07", "2026-10-07", 16)).toBe(false);
  });

  it("counts the day in the run's zone, not UTC's", () => {
    // 22:30 UTC on the 6th is 01:30 on the 7th in Brașov: the birthday has come.
    const late = { ...run, startsAt: new Date("2026-10-06T22:30:00Z") };
    expect(birthDateRefusal(late, "2005-10-07")).toEqual([]);
    expect(birthDateRefusal({ ...late, timezone: "UTC" }, "2005-10-07")).toEqual(["birthDate", GROUP_RUN_TOO_YOUNG]);
  });

  it("treats a minimum of eighteen or less as none: the adults-only text already says eighteen", () => {
    expect([0, 14, 16, 18, 19, 21].map(groupRunMinimumAge)).toEqual([0, 0, 0, 0, 19, 21]);
    for (const minAge of [14, 16, 18]) {
      expect(birthDateRefusal({ ...run, minAge }, undefined), String(minAge)).toEqual([]);
      expect(birthDateRefusal({ ...run, minAge }, "2012-01-01"), String(minAge)).toEqual([]);
    }
  });

  it("names a missing or unreadable date, and asks nothing of a run with no minimum", () => {
    expect(birthDateRefusal(run, undefined)).toEqual(["birthDate"]);
    expect(birthDateRefusal(run, "07.10.2010")).toEqual(["birthDate"]);
    expect(birthDateRefusal({ ...run, minAge: 0 }, undefined)).toEqual([]);
    expect(birthDateRefusal({ ...run, minAge: 0 }, "2025-01-01")).toEqual([]);
  });

  it("carries the refusal through the address: the box, and the marker the page reads", () => {
    expect(parseGroupRunInvalid("birthDate,tooYoung,email")).toEqual(["birthDate", "email"]);
    expect(refusedTooYoung("birthDate,tooYoung")).toBe(true);
    expect(refusedTooYoung("birthDate")).toBe(false);
  });

  it("says the number in the refusal and the help, in both languages, with no number of its own", () => {
    for (const catalogue of [ro, en]) {
      const page = catalogue.Event.groupRunDeclaration.page;
      for (const sentence of [page.tooYoung, page.birthDateHelp]) {
        expect(sentence).toContain("{age}");
        expect(sentence).not.toMatch(/\d/);
      }
      expect(page.fields.birthDate).toBeTruthy();
      expect(catalogue.Admin.editor.groupRunDeclaration.minAgeHelp).toBeTruthy();
    }
  });
});
