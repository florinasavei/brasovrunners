import { describe, expect, it } from "vitest";
import {
  BLANK,
  MERGE_FIELDS,
  mergeFieldsIn,
  mergeLegalBody,
  mergeText,
} from "@/modules/legal-documents/domain/merge-fields";
import { declarationEn, declarationRo } from "@/modules/legal-documents/templates/declaration";
import { LEGAL_TEMPLATES } from "@/modules/legal-documents/templates/catalogue";

/** `DECISIONS.md` §95 — the blanks of the club's declaration are named fields in one fixed text. */
describe("the declaration's merge fields", () => {
  it("fills every named field, and leaves a dotted blank where there is no value yet", () => {
    const text = "Subsemnatul/a {{participant}}, posesor al {{ idDocument }}, la {{event}} din {{eventDate}}.";
    expect(mergeText(text, { participant: "Ana Popescu", event: "Crosul", eventDate: "11 octombrie 2026" })).toBe(
      `Subsemnatul/a Ana Popescu, posesor al ${BLANK}, la Crosul din 11 octombrie 2026.`,
    );
    // An empty or whitespace value is no value.
    expect(mergeText("{{idDocument}}", { idDocument: "  " })).toBe(BLANK);
  });

  it("leaves an unknown name as written, so a typo shows rather than vanishes", () => {
    expect(mergeText("{{organizer}} and {{participant}}", { participant: "Ana" })).toBe("{{organizer}} and Ana");
  });

  it("merges a whole body, headings included, without touching the template", () => {
    const body = { sections: [{ heading: "For {{event}}", paragraphs: ["I, {{participant}}.", "No fields here."] }] };
    const merged = mergeLegalBody(body, { event: "Crosul", participant: "Ana" });
    expect(merged).toEqual({ sections: [{ heading: "For Crosul", paragraphs: ["I, Ana.", "No fields here."] }] });
    expect(body.sections[0].paragraphs[0]).toBe("I, {{participant}}.");
    // An unreadable body merges to nothing, as the renderer shows nothing.
    expect(mergeLegalBody("not a body", {})).toEqual({ sections: [] });
  });

  it("says which fields a text asks for — the form asks for an identity document only then", () => {
    expect([...mergeFieldsIn({ sections: [{ paragraphs: ["{{participant}} {{idDocument}}"] }] })]).toEqual(["participant", "idDocument"]);
    expect(mergeFieldsIn({ sections: [{ paragraphs: ["nothing"] }] }).size).toBe(0);
  });

  it("is used by the club's declaration in both languages, with the same fields", () => {
    const ro = mergeFieldsIn(declarationRo);
    const en = mergeFieldsIn(declarationEn);
    expect([...ro].sort()).toEqual([...en].sort());
    // `declarant` (§108) opens the text: the runner, or the parent of a minor with the relation spelled out.
    for (const field of ["declarant", "idDocument", "event", "eventDate", "eventLocation"]) {
      expect(ro.has(field as (typeof MERGE_FIELDS)[number]), field).toBe(true);
    }
  });

  it("keeps only the club's four facts as placeholders in every template", () => {
    const allowed = new Set([
      "<DENUMIREA JURIDICĂ COMPLETĂ A CLUBULUI>",
      "<ADRESA SEDIULUI>",
      "<NUMĂR DE ÎNREGISTRARE / CUI>",
      "<EMAIL DE CONTACT>",
      "<THE CLUB'S FULL LEGAL NAME>",
      "<REGISTERED ADDRESS>",
      "<REGISTRATION NUMBER>",
      "<CONTACT EMAIL>",
    ]);
    for (const [key, locales] of Object.entries(LEGAL_TEMPLATES)) {
      for (const [locale, translation] of Object.entries(locales)) {
        const text = translation.body.sections.flatMap((section) => [section.heading ?? "", ...section.paragraphs]).join(" ");
        for (const placeholder of text.match(/<[A-ZĂÂÎȘȚ'][^>]*>/g) ?? []) {
          expect(allowed.has(placeholder), `${key} ${locale}: ${placeholder}`).toBe(true);
        }
        // Complete, and short (the owner: "the terms and the GDPR notice should be short"):
        // a real document, not an outline, and not a treatise either.
        expect(text.length, `${key} ${locale}`).toBeGreaterThan(key === "EVENT_DECLARATION" ? 1500 : 2500);
        expect(text.length, `${key} ${locale}`).toBeLessThan(key === "EVENT_DECLARATION" ? 4000 : 11000);
      }
    }
  });
});
