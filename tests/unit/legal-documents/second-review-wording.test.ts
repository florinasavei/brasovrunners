import { describe, expect, it } from "vitest";
import { declarationRoadEn, declarationRoadRo, declarationTrailEn, declarationTrailRo } from "@/modules/legal-documents/templates/declaration";
import { groupRunAsphaltEn, groupRunAsphaltRo, groupRunTrailEn, groupRunTrailRo } from "@/modules/legal-documents/templates/group-run-declaration";
import { LEGAL_TEMPLATES } from "@/modules/legal-documents/templates/catalogue";
import type { LegalDocumentBody } from "@/modules/legal-documents/domain/content-hash";

/**
 * BR-REQ-053-01 (§556, the second review of 2026-09-29) — three sentences of the counsel-reviewed
 * templates, and nothing else: the trail shoes as grip, «de preferat încălțăminte pentru teren
 * accidentat» (in Romanian words since §564; «pantofi de trail» until then); the organiser's
 * general safety instructions in place of «indicațiile organizatorului și recomandările
 * autorităților»; and the retention sentence that keeps a copy for as long as a right needs it, and
 * a document under a complaint, a dispute or proceedings until they are finally settled.
 */
const text = (body: LegalDocumentBody) => body.sections.flatMap((section) => section.paragraphs).join(" ");

const TRAIL_TEXTS = { ro: [groupRunTrailRo, declarationTrailRo], en: [groupRunTrailEn, declarationTrailEn] };
const ALL_DECLARATIONS = {
  ro: [groupRunTrailRo, groupRunAsphaltRo, declarationTrailRo, declarationRoadRo],
  en: [groupRunTrailEn, groupRunAsphaltEn, declarationTrailEn, declarationRoadEn],
};

const DISPUTE = {
  ro: "Dacă există o reclamație, un litigiu sau o procedură în curs, documentul poate fi păstrat până la soluționarea definitivă a acesteia.",
  en: "If a complaint, a dispute or proceedings are under way, the document may be kept until they are finally settled.",
};
const AFTER = {
  ro: "O copie poate fi păstrată și după aceea, pe durata necesară constatării, exercitării sau apărării unor drepturi, inclusiv ținând seama de termenul general de prescripție de trei ani prevăzut de art. 2517 din Codul civil.",
  en: "A copy may be kept after that, for as long as needed to establish, exercise or defend rights, including with regard to the general three-year limitation period set by art. 2517 of the Romanian Civil Code.",
};

describe("the second review's three sentences (§556)", () => {
  it("asks for grip on a trail, trail shoes preferred — the outcome, not a shoe category", () => {
    for (const body of TRAIL_TEXTS.ro) {
      expect(text(body)).toContain("încălțăminte adecvată terenului, cu aderență corespunzătoare (de preferat încălțăminte pentru teren accidentat)");
      expect(text(body)).not.toContain("pantofi de trail");
    }
    for (const body of TRAIL_TEXTS.en) {
      expect(text(body)).toContain("footwear suited to the terrain, with adequate grip (preferably trail shoes)");
      expect(text(body)).not.toContain("terrain (trail shoes)");
    }
  });

  it("asks to follow the organiser's general safety instructions, never «the authorities' advice»", () => {
    for (const body of TRAIL_TEXTS.ro) expect(text(body)).toContain("să respect indicațiile generale de siguranță comunicate de organizator");
    for (const body of TRAIL_TEXTS.en) expect(text(body)).toContain("to follow the general safety instructions communicated by the organiser");
    for (const body of ALL_DECLARATIONS.ro) expect(text(body)).not.toContain("recomandările autorităților");
    for (const body of ALL_DECLARATIONS.en) expect(text(body)).not.toContain("the authorities' advice");
  });

  it("keeps a group-run copy as long as a right needs it, and a disputed one until it is settled — never «the copy is deleted»", () => {
    for (const body of [groupRunTrailRo, groupRunAsphaltRo]) {
      expect(text(body)).toContain(AFTER.ro);
      expect(text(body)).toContain(DISPUTE.ro);
      expect(text(body)).not.toContain("copia se șterge");
    }
    for (const body of [groupRunTrailEn, groupRunAsphaltEn]) {
      expect(text(body)).toContain(AFTER.en);
      expect(text(body)).toContain(DISPUTE.en);
      expect(text(body)).not.toContain("the copy is deleted");
    }
  });

  it("says the dispute sentence after the race declaration's three years, in both texts and both languages", () => {
    for (const body of [declarationTrailRo, declarationRoadRo]) expect(text(body)).toContain(`trei ani de la data evenimentului. ${DISPUTE.ro}`);
    for (const body of [declarationTrailEn, declarationRoadEn]) expect(text(body)).toContain(`three years from the date of the event. ${DISPUTE.en}`);
  });

  it("says the same in the privacy notice's retention section for the group-run declaration", () => {
    const ro = text(LEGAL_TEMPLATES.PRIVACY_NOTICE.ro.body);
    const en = text(LEGAL_TEMPLATES.PRIVACY_NOTICE.en.body);
    expect(ro).toContain(`după ce ne ceri să o retragem, nu mai este folosită pentru alergările următoare. ${AFTER.ro} ${DISPUTE.ro}`);
    expect(en).toContain(`once you ask us to withdraw it, it is no longer used for later runs. ${AFTER.en} ${DISPUTE.en}`);
    // The race's registrations keep the notice's incident sentence, which already holds them until settled.
    expect(ro).toContain("până la soluționarea definitivă (art. 17(3)(e)");
    expect(ro).not.toContain("o copie doar cât o cere un drept în instanță");
    expect(en).not.toContain("a copy only as long as a legal claim needs it");
  });
});
