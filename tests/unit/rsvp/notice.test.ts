import { describe, expect, it } from "vitest";
import en from "../../../messages/en.json";
import ro from "../../../messages/ro.json";
import { describesRsvp, MERGE_FIELDS, mergeFieldsIn, mergeText, RSVP_MERGE_FIELD } from "@/modules/legal-documents/domain/merge-fields";
import { privacyNoticeEn, privacyNoticeRo } from "@/modules/legal-documents/templates/privacy-notice";
import { termsEn, termsRo } from "@/modules/legal-documents/templates/terms";
import { DECLARATION_TOKENS } from "@/modules/legal-documents/templates/tokens";
import { TASK_TARGETS } from "@/modules/diagnostics/domain/task-targets";
import { rsvpClause, rsvpMergeValues } from "@/modules/rsvp/notice-words";

/**
 * §NNN («Vin!» part 1) — the privacy notice's `{{rsvp}}`: the switch the page, the service and the tasks list read, filled with the
 * button's own name; the template's paragraphs in both languages; the tasks row; the terms left alone (nothing is bought, booked or
 * signed by an answer).
 */
const sentences = (body: { sections: readonly { paragraphs: readonly string[] }[] }) => body.sections.flatMap((section) => section.paragraphs);

describe("§NNN {{rsvp}} is a merge field, the notice's switch, and the button's name", () => {
  it("is known to the editor and filled with the button's own name in each language", () => {
    expect(MERGE_FIELDS).toContain(RSVP_MERGE_FIELD);
    expect(rsvpClause("ro")).toBe(`„${ro.Event.rsvp.submit}”`);
    expect(rsvpClause("en")).toBe(`“${en.Event.rsvp.submit}”`);
    expect(mergeText("Răspunsul {{rsvp}} apare", rsvpMergeValues("ro"))).toBe("Răspunsul „Vin!” apare");
    expect(mergeText("The {{rsvp}} answer", rsvpMergeValues("en"))).toBe("The “I'm coming!” answer");
  });

  it("is explained in the legal editor's legend, in both languages", () => {
    const entry = DECLARATION_TOKENS.find((token) => token.token === "{{rsvp}}");
    expect(entry?.messageKey).toBe("rsvp");
    expect(entry?.example.ro).toBe(rsvpClause("ro"));
    expect(entry?.example.en).toBe(rsvpClause("en"));
    expect(ro.Admin.legal.tokens.rsvp.length).toBeGreaterThan(20);
    expect(en.Admin.legal.tokens.rsvp.length).toBeGreaterThan(20);
  });

  it("is what makes a notice describe «Vin!» — a text with the marker does, one without it, or any non-body, does not", () => {
    expect(describesRsvp(privacyNoticeRo)).toBe(true);
    expect(describesRsvp(privacyNoticeEn)).toBe(true);
    expect(describesRsvp(JSON.parse(JSON.stringify(privacyNoticeRo).replaceAll("{{rsvp}}", "")))).toBe(false);
    expect(describesRsvp({ sections: [{ heading: "4. Lista publică", paragraphs: ["Nimic despre răspunsuri."] }] })).toBe(false);
    expect(describesRsvp("not a body")).toBe(false);
    expect(describesRsvp(null)).toBe(false);
  });
});

describe("§NNN the template says what «Vin!» publishes, keeps, mails and remembers — in both languages", () => {
  it("names the marker in the notice's four paragraphs of each language", () => {
    for (const body of [privacyNoticeRo, privacyNoticeEn]) {
      expect(mergeFieldsIn(body).has(RSVP_MERGE_FIELD)).toBe(true);
      expect(sentences(body).filter((paragraph) => paragraph.includes("{{rsvp}}"))).toHaveLength(2);
    }
  });

  it("publishes the count and the name only of those who ticked, and says an answer is not a registration (section 4)", () => {
    const ro4 = privacyNoticeRo.sections[3].paragraphs.find((paragraph) => paragraph.includes("{{rsvp}}")) ?? "";
    expect(ro4).toContain("Vreau să apar cu numele");
    expect(ro4).toContain("doar al celor care au bifat");
    expect(ro4).toContain("nu ține un loc");
    const en4 = privacyNoticeEn.sections[3].paragraphs.find((paragraph) => paragraph.includes("{{rsvp}}")) ?? "";
    expect(en4).toContain("I want my name to show");
    expect(en4).toContain("holds no place");
  });

  it("states the retention (section 7) and the cookie (section 10) with the numbers the sweep enforces", () => {
    const text = (body: typeof privacyNoticeRo, section: number) => body.sections[section - 1].paragraphs.join("\n");
    expect(text(privacyNoticeRo, 7)).toContain("30 de zile de la sfârșitul evenimentului");
    expect(text(privacyNoticeRo, 7)).toContain("după 7 zile");
    expect(text(privacyNoticeEn, 7)).toContain("30 days from the event's end");
    expect(text(privacyNoticeEn, 7)).toContain("after 7 days");
    expect(text(privacyNoticeRo, 10)).toContain("Legea nr. 506/2004, art. 4(6)");
    expect(text(privacyNoticeRo, 10)).toContain("Nu sunt eu");
    expect(text(privacyNoticeEn, 10)).toContain("art. 4(6)");
    expect(text(privacyNoticeEn, 10)).toContain("Not me");
  });

  it("leaves the terms alone: no marker, nothing about an answer", () => {
    for (const body of [termsRo, termsEn]) expect(mergeFieldsIn(body).has(RSVP_MERGE_FIELD)).toBe(false);
  });
});

describe("§NNN the row on /admin/tasks", () => {
  it("has its words and its steps in both languages, pointing at /admin/legal", () => {
    for (const catalogue of [ro, en]) {
      const item = catalogue.Admin.tasks.items.rsvpNotice;
      expect(item.title && item.todo && item.done).toBeTruthy();
      expect(item.how.join("\n")).toContain("/admin/legal");
    }
    expect(TASK_TARGETS.rsvpNotice).toEqual({ kind: "section", section: "legal" });
  });
});
