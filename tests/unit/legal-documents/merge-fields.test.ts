import { describe, expect, it } from "vitest";
import {
  BLANK,
  MERGE_FIELDS,
  mergeFieldsIn,
  mergeLegalBody,
  mergeTextSegments,
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
        // a real document, not an outline, and not a treatise either. The privacy notice has
        // its own ceiling since the GDPR transparency pass (§323; the owner: "we need to inform
        // people properly on how their data is used"): every item now carries its purpose, its
        // basis, who sees it and how long it stays, which is what art. 13 asks, and that is
        // about half as long again as the text it replaced.
        const ceiling = key === "EVENT_DECLARATION" ? 4000 : key === "PRIVACY_NOTICE" ? 17000 : 11000;
        expect(text.length, `${key} ${locale}`).toBeGreaterThan(key === "EVENT_DECLARATION" ? 1500 : 2500);
        expect(text.length, `${key} ${locale}`).toBeLessThan(ceiling);
      }
    }
  });

  /**
   * §225 — the fill-ins are bold, so the merge has to say which span was one.
   *
   * The signer checks exactly the filled-in parts: their own name, their identity document,
   * the race and its date. Everything around them was approved once and reads the same for
   * everybody, which is why setting the two apart is worth a shape rather than a flat string.
   */
  it("says which spans came out of a field, and which are the approved words", () => {
    const segments = mergeTextSegments("Subsemnatul/a {{participant}} declar la {{event}}.", {
      participant: "Ana Popescu",
      event: "Crosul Tâmpei",
    });
    expect(segments).toEqual([
      { text: "Subsemnatul/a ", filled: false },
      { text: "Ana Popescu", filled: true },
      { text: " declar la ", filled: false },
      { text: "Crosul Tâmpei", filled: true },
      { text: ".", filled: false },
    ]);
  });

  it("marks an unfilled blank as filled too, because it is still the place somebody writes", () => {
    // On the blank form the desk prints, the emphasised parts are the gaps to write in.
    expect(mergeTextSegments("CI {{idDocument}}", {})).toEqual([
      { text: "CI ", filled: false },
      { text: BLANK, filled: true },
    ]);
  });

  it("leaves an unknown name written, and plain", () => {
    // Not a field, so not a blank anybody filled — it is the text's own words.
    expect(mergeTextSegments("see {{nonsense}} here", {})).toEqual([
      { text: "see {{nonsense}} here", filled: false },
    ]);
  });

  it("joins back to exactly what mergeText produces", () => {
    // The two cannot disagree about what a merge is: one is defined as the other, joined.
    const text = "{{participant}} at {{event}} on {{eventDate}}, {{nonsense}}.";
    const values = { participant: "Ana", event: "Cros" };
    expect(mergeTextSegments(text, values).map((s) => s.text).join("")).toBe(mergeText(text, values));
  });
});
