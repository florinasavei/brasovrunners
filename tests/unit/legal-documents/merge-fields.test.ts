import { describe, expect, it } from "vitest";
import {
  asksForIdDocument,
  BLANK,
  isMergeField,
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
    /*
      Since §NNN the platform's text opens with the participant and their own document, and names
      the parent or guardian with theirs in a sentence of its own — a minor's declaration is signed
      by both. `{{declarant}}` and `{{idDocument}}` (§108, §95) stay fields every approved text may
      use; this template no longer needs them.
    */
    for (const field of ["participant", "participantIdDocument", "guardian", "guardianIdDocument", "event", "eventDate", "eventLocation"]) {
      expect(ro.has(field as (typeof MERGE_FIELDS)[number]), field).toBe(true);
    }
    expect(asksForIdDocument(declarationRo)).toBe(true);
  });

  /** §NNN — each signer's document is a field of its own, and naming any document asks for them. */
  it("knows the two newer document fields, and asks for documents when a text names any of the three", () => {
    for (const field of ["idDocument", "participantIdDocument", "guardianIdDocument"]) {
      expect(isMergeField(field), field).toBe(true);
      expect(asksForIdDocument({ sections: [{ paragraphs: [`CI {{${field}}}`] }] }), field).toBe(true);
    }
    expect(asksForIdDocument({ sections: [{ paragraphs: ["{{participant}} at {{event}}"] }] })).toBe(false);
    expect(asksForIdDocument("not a body")).toBe(false);
    // A value fills each; none is a blank, as every other field.
    expect(mergeText("{{participantIdDocument}} / {{guardianIdDocument}}", { participantIdDocument: "MP 654321", guardianIdDocument: "—" })).toBe("MP 654321 / —");
    expect(mergeText("{{guardianIdDocument}}", {})).toBe(BLANK);
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
