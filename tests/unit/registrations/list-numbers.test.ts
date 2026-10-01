import { describe, expect, it } from "vitest";
import en from "../../../messages/en.json";
import ro from "../../../messages/ro.json";
import {
  describesListNumbers,
  describesListSocials,
  describesListStates,
  isMergeField,
  LIST_NUMBERS_MERGE_FIELD,
  mergeLegalBody,
  mergeText,
} from "@/modules/legal-documents/domain/merge-fields";
import { privacyNoticeEn, privacyNoticeRo } from "@/modules/legal-documents/templates/privacy-notice";
import { termsEn, termsRo } from "@/modules/legal-documents/templates/terms";
import { DECLARATION_TOKENS } from "@/modules/legal-documents/templates/tokens";
import { listNumbersClause, listNumbersMergeValues } from "@/modules/registrations/list-number-words";

/**
 * §613 (amending §396) — the race number beside a confirmed name on the public list: the privacy
 * notice's marker that switches the «BIB» column on, and the words it is filled with.
 */
describe("§613 the privacy notice's marker for the race number", () => {
  const text = (paragraph: string) => ({ sections: [{ paragraphs: [paragraph] }] });

  it("is a merge field the platform's notice and terms carry, in both languages, and the legend lists", () => {
    expect(LIST_NUMBERS_MERGE_FIELD).toBe("participantListNumbers");
    expect(isMergeField("participantListNumbers")).toBe(true);
    expect(describesListNumbers(privacyNoticeRo)).toBe(true);
    expect(describesListNumbers(privacyNoticeEn)).toBe(true);
    // The terms say it too, so the two texts the club approves together agree about the list.
    expect(describesListNumbers(termsRo)).toBe(true);
    expect(describesListNumbers(termsEn)).toBe(true);
    const legend = DECLARATION_TOKENS.find((entry) => entry.token === "{{participantListNumbers}}");
    expect(legend?.example).toEqual({ ro: listNumbersClause("ro"), en: listNumbersClause("en") });
    // The legend's explanation exists in both catalogues.
    expect(ro.Admin.legal.tokens.participantListNumbers).toBeTruthy();
    expect(en.Admin.legal.tokens.participantListNumbers).toBeTruthy();
  });

  it("is in section 4 of the notice, in both languages, in its own sentence about the confirmed", () => {
    for (const body of [privacyNoticeRo, privacyNoticeEn]) {
      const section = body.sections.find((candidate) => candidate.heading?.startsWith("4."));
      const paragraph = section?.paragraphs.find((candidate) => candidate.includes("{{participantListNumbers}}"));
      expect(paragraph).toBeDefined();
      // The sentence that names it is not the states' or the socials' — each switch has its own words.
      expect(describesListStates(text(paragraph as string))).toBe(false);
      expect(describesListSocials(text(paragraph as string))).toBe(false);
    }
  });

  it("is off for a text that does not name it, and a near miss is not the marker", () => {
    expect(describesListNumbers(text("Lista publică arată doar numele participanților confirmați."))).toBe(false);
    expect(describesListNumbers(text("{{participantListStates}} {{participantListSocials}}"))).toBe(false);
    expect(describesListNumbers(text("{{participantListNumber}}"))).toBe(false);
    expect(describesListNumbers("not a body")).toBe(false);
    expect(describesListNumbers({ sections: [] })).toBe(false);
    expect(describesListNumbers(text("Numărul: {{ participantListNumbers }}."))).toBe(true);
    expect(describesListNumbers({ sections: [{ heading: "{{participantListNumbers}}", paragraphs: [] }] })).toBe(true);
  });

  it("is filled with the column's own words, quoted, from the catalogue the heading reads", () => {
    expect(listNumbersClause("ro")).toBe(`„${ro.Event.startList.columnNumberFull}”`);
    expect(listNumbersClause("en")).toBe(`“${en.Event.startList.columnNumberFull}”`);
    expect(listNumbersClause("ro")).toBe("„numărul de concurs”");
    expect(listNumbersClause("en")).toBe("“race number”");
    expect(mergeText("apare și {{participantListNumbers}}.", listNumbersMergeValues("ro"))).toBe("apare și „numărul de concurs”.");
    // The platform's notice and terms, merged, carry the words and no marker or dotted blank where it stood.
    for (const [locale, bodies] of [
      ["ro", [privacyNoticeRo, termsRo]],
      ["en", [privacyNoticeEn, termsEn]],
    ] as const) {
      for (const body of bodies) {
        const merged = JSON.stringify(mergeLegalBody(body, listNumbersMergeValues(locale)));
        expect(merged).toContain(listNumbersClause(locale));
        expect(merged).not.toContain("{{participantListNumbers}}");
      }
    }
  });

  it("names the column's short heading in both languages, never as an ICU plural", () => {
    expect(ro.Event.startList.columnNumber).toBe("BIB");
    expect(en.Event.startList.columnNumber).toBe("BIB");
    for (const catalogue of [ro, en]) {
      for (const key of ["captionNumbers", "captionStatesNumbers"] as const) {
        expect(catalogue.Event.startList[key]).toBeTruthy();
        expect(catalogue.Event.startList[key]).not.toMatch(/\{[^}]*plural/);
      }
    }
  });
});
