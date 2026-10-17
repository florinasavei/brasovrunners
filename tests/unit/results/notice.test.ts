import { describe, expect, it } from "vitest";
import en from "../../../messages/en.json";
import ro from "../../../messages/ro.json";
import { describesResults, MERGE_FIELDS, mergeFieldsIn, mergeText, RESULTS_MERGE_FIELD } from "@/modules/legal-documents/domain/merge-fields";
import { privacyNoticeEn, privacyNoticeRo } from "@/modules/legal-documents/templates/privacy-notice";
import { termsEn, termsRo } from "@/modules/legal-documents/templates/terms";
import { DECLARATION_TOKENS } from "@/modules/legal-documents/templates/tokens";
import { resultsClause, resultsMergeValues } from "@/modules/results/notice-words";
import { ownerTasks } from "@/modules/diagnostics/owner-tasks";

/**
 * §NNN, BR-REQ-053-01 — the notice's gate for a race's published results: `{{results}}` replaces «Rezultate cu nume nu publicăm încă»
 * in section 4 of the platform's template, in both languages; it is a known merge field with a legend entry, filled with the public
 * section's own name; a notice that does not name it does not describe the results.
 */
const text = (body: { sections: { paragraphs: string[] }[] }) => body.sections.flatMap((section) => section.paragraphs).join("\n");

describe("§NNN the platform's notice describes the results", () => {
  it("names {{results}} in both languages, so the gate opens the day it is approved", () => {
    expect(describesResults(privacyNoticeRo)).toBe(true);
    expect(describesResults(privacyNoticeEn)).toBe(true);
    expect(mergeFieldsIn(privacyNoticeRo).has(RESULTS_MERGE_FIELD)).toBe(true);
  });

  it("no longer says that results with names are not published, in either text", () => {
    expect(text(privacyNoticeRo)).not.toContain("Rezultate cu nume nu publicăm încă");
    expect(text(privacyNoticeEn)).not.toContain("We do not publish results with names yet");
    expect(text(termsRo)).not.toContain("Rezultate cu nume nu publicăm încă");
    expect(text(termsEn)).not.toContain("We do not publish results with names yet");
  });

  it("says what is published: the place, the number, the time, the state, the category; the name only of those who ticked; the rest «Participant #»", () => {
    const ro1 = text(privacyNoticeRo);
    for (const word of ["locul", "numărul de concurs", "timpul", "categoria", "vreau să apar pe lista de participanți & rezultate", "„Participant #numărul de concurs”"]) expect(ro1, word).toContain(word);
    const en1 = text(privacyNoticeEn);
    for (const word of ["the place", "the race number", "the time", "the category", "I want to appear on the participants & results list", "“Participant #race number”"]) expect(en1, word).toContain(word);
  });

  it("closes with the public list, in its period: the notice names the period once for the list and once for the retention, never a third number", () => {
    for (const body of [privacyNoticeRo, privacyNoticeEn]) {
      expect(text(body).split("{{publicListPeriod}}").length - 1).toBe(2);
    }
    expect(text(privacyNoticeRo)).toContain("odată cu lista publică, în același termen");
    expect(text(privacyNoticeEn)).toContain("with the public list, within the same period");
  });

  it("merges with no gap left: the field becomes the section's own name, quoted", () => {
    expect(mergeText("Clasament ({{results}})", resultsMergeValues("ro"))).toBe("Clasament („Clasament”)");
    expect(mergeText("Ranking ({{results}})", resultsMergeValues("en"))).toBe("Ranking (“Results”)");
    expect(resultsClause("ro")).toBe(`„${ro.Event.results.title}”`);
    expect(resultsClause("en")).toBe(`“${en.Event.results.title}”`);
  });
});

describe("§NNN a notice that does not name it", () => {
  it("does not describe the results: an older notice, a text with the marker taken out, anything that is not a body", () => {
    expect(describesResults({ sections: [{ heading: "4. Lista publică", paragraphs: ["Rezultate cu nume nu publicăm încă."] }] })).toBe(false);
    expect(describesResults(JSON.parse(JSON.stringify(privacyNoticeRo).replace("{{results}}", "")))).toBe(false);
    expect(describesResults("not a body")).toBe(false);
    expect(describesResults(null)).toBe(false);
  });
});

describe("§NNN the field is known and explained", () => {
  it("is in the merge fields and in the legal editor's legend, with a sentence in both languages", () => {
    expect(MERGE_FIELDS).toContain(RESULTS_MERGE_FIELD);
    const entry = DECLARATION_TOKENS.find((token) => token.token === "{{results}}");
    expect(entry?.messageKey).toBe("results");
    expect(entry?.example.ro).toBe(resultsClause("ro"));
    expect(entry?.example.en).toBe(resultsClause("en"));
    expect(ro.Admin.legal.tokens.results.length).toBeGreaterThan(20);
    expect(en.Admin.legal.tokens.results.length).toBeGreaterThan(20);
  });

  it("is a row on /admin/tasks with steps in both languages", () => {
    expect(ownerTasks).toBeTypeOf("function");
    for (const catalogue of [ro, en]) {
      const item = catalogue.Admin.tasks.items.resultsNotice;
      expect(item.title && item.todo && item.done).toBeTruthy();
      expect(item.how.join("\n")).toContain("/admin/legal");
    }
  });
});
