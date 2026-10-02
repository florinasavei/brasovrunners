import { describe, expect, it } from "vitest";
import en from "../../../messages/en.json";
import ro from "../../../messages/ro.json";
import type { LegalDocumentBody } from "@/modules/legal-documents/domain/content-hash";
import { describesListStates, describesRefusal, isMergeField, mergeLegalBody, mergeText, REFUSAL_GROUNDS_MERGE_FIELD } from "@/modules/legal-documents/domain/merge-fields";
import { privacyNoticeEn, privacyNoticeRo } from "@/modules/legal-documents/templates/privacy-notice";
import { termsEn, termsRo } from "@/modules/legal-documents/templates/terms";
import { DECLARATION_TOKENS } from "@/modules/legal-documents/templates/tokens";
import { refusalGrounds, refusalGroundsClause, refusalMergeValues } from "@/modules/registrations/refusal-grounds-words";

/**
 * §NNN (on §618) — the terms' grounds for the club refusing or cancelling a registration as the merge
 * field `{{refusalGrounds}}`: the words module, the template rendering byte for byte as §618 wrote the
 * paragraph, and the detector that switches the form's express box and the fold's step on.
 */
type Locale = "ro" | "en";
const BODY: Record<Locale, LegalDocumentBody> = { ro: termsRo, en: termsEn };

/** §3's last paragraph exactly as the template spelled it before the field existed (BR-V2.56, §618). */
const PARAGRAPH_BEFORE: Record<Locale, string> = {
  ro: "Clubul poate refuza o înscriere sau o poate anula după ce a fost făcută doar pe un motiv obiectiv: nu sunt îndeplinite condițiile de participare ale evenimentului (vârsta minimă, declarațiile cerute, declarația că ești apt medical, unde evenimentul o cere); datele sunt false, incomplete sau ale altei persoane; o impun capacitatea sau siguranța evenimentului (vremea, traseul, numărul de voluntari); conduita ta contravine regulamentului evenimentului ori îi pune pe alții în pericol; înscrierea a fost făcută cu încălcarea acestor termeni. Îți spunem motivul pe e-mail — sau pe ecran, când chiar formularul refuză înscrierea —, iar locul eliberat, când este cazul, trece la lista de așteptare, după regulile obișnuite. La un eveniment gratuit nu este nimic de restituit; dacă ai plătit clubului o taxă de participare, se aplică regulile de restituire de mai sus. Clubul nu refuză și nu anulează o înscriere pe niciun criteriu interzis de lege.",
  en: "The club may refuse a registration, or cancel one already made, only on an objective ground: the event's conditions for taking part are not met (the minimum age, the declarations it asks for, the statement that you are medically fit, where the event asks for it); the details are false, incomplete or somebody else's; the event's capacity or safety requires it (the weather, the course, the number of volunteers); your conduct breaches the event's rules or endangers others; the registration was made in breach of these terms. We tell you the ground by email — or on screen, where the form itself refuses the registration — and a place released goes, where that applies, to the waiting list by the ordinary rules. At a free event there is nothing to refund; if you paid the club a participation fee, the refund rules above apply. The club refuses or cancels no registration on any ground the law forbids.",
};

const text = (...paragraphs: string[]): LegalDocumentBody => ({ sections: [{ heading: "3. Anularea", paragraphs }] });

describe("§NNN the refusal grounds' words", () => {
  it.each(["ro", "en"] as const)("%s: five grounds, joined by semicolons, from the conditions to the terms, no full stop", (locale) => {
    expect(refusalGrounds(locale)).toHaveLength(5);
    const clause = refusalGroundsClause(locale);
    expect(clause.startsWith(locale === "ro" ? "nu sunt îndeplinite condițiile de participare" : "the event's conditions for taking part are not met")).toBe(true);
    expect(clause.endsWith(locale === "ro" ? "înscrierea a fost făcută cu încălcarea acestor termeni" : "the registration was made in breach of these terms")).toBe(true);
    expect(clause.split("; ")).toEqual(refusalGrounds(locale));
    expect(refusalMergeValues(locale)).toEqual({ refusalGrounds: clause });
  });
});

describe("§NNN the terms' template renders §618's paragraph byte for byte", () => {
  it.each(["ro", "en"] as const)("%s: the paragraph names the field and, merged, is today's text exactly", (locale) => {
    const paragraphs = BODY[locale].sections[2].paragraphs;
    const raw = paragraphs.filter((paragraph) => paragraph.includes(`{{${REFUSAL_GROUNDS_MERGE_FIELD}}}`));
    expect(raw).toHaveLength(1);
    expect(paragraphs.at(-1)).toBe(raw[0]);
    expect(mergeText(raw[0], refusalMergeValues(locale))).toBe(PARAGRAPH_BEFORE[locale]);
    // The whole body, merged: the paragraph in place, nothing else in the terms names the field.
    const merged = mergeLegalBody(BODY[locale], refusalMergeValues(locale));
    expect(merged.sections[2].paragraphs.at(-1)).toBe(PARAGRAPH_BEFORE[locale]);
    expect(JSON.stringify(merged)).not.toContain(`{{${REFUSAL_GROUNDS_MERGE_FIELD}}}`);
  });

  it("is a merge field the legend lists with the grounds as its example, and its help is under 200 characters (§511)", () => {
    expect(isMergeField("refusalGrounds")).toBe(true);
    const legend = DECLARATION_TOKENS.find((entry) => entry.token === "{{refusalGrounds}}");
    expect(legend?.messageKey).toBe("refusalGrounds");
    expect(legend?.example).toEqual({ ro: refusalGroundsClause("ro"), en: refusalGroundsClause("en") });
    for (const catalogue of [ro, en]) {
      expect(catalogue.Admin.legal.tokens.refusalGrounds).toBeTruthy();
      expect(catalogue.Admin.legal.tokens.refusalGrounds.length).toBeLessThan(200);
    }
  });
});

describe("§NNN describesRefusal — whether the terms carry the club's right to refuse", () => {
  it("is on for the platform's terms in both languages, and off for the privacy notice", () => {
    expect(describesRefusal(termsRo)).toBe(true);
    expect(describesRefusal(termsEn)).toBe(true);
    expect(describesRefusal(privacyNoticeRo)).toBe(false);
    expect(describesRefusal(privacyNoticeEn)).toBe(false);
  });

  it("is on for terms approved from §618's template word for word, before the field existed, in either language", () => {
    expect(describesRefusal(text(PARAGRAPH_BEFORE.ro))).toBe(true);
    expect(describesRefusal(text(PARAGRAPH_BEFORE.en))).toBe(true);
  });

  it("is off for terms that do not carry it, for a near miss, and for anything that is not a body", () => {
    // The terms in force on production before §618: narrow refusals (the age, misuse) and no grounds.
    expect(describesRefusal(text("Clubul poate anula o astfel de înscriere, refuza înscrierile viitoare ale persoanei și limita temporar accesul la platformă."))).toBe(false);
    // One ground reworded is not the clause the box names.
    expect(describesRefusal(text(PARAGRAPH_BEFORE.ro.replace("datele sunt false", "datele sunt greșite")))).toBe(false);
    expect(describesRefusal(text("{{refusalGround}}"))).toBe(false);
    expect(describesRefusal(text("{{participantListStates}}"))).toBe(false);
    expect(describesRefusal("not a body")).toBe(false);
    expect(describesRefusal({ sections: [] })).toBe(false);
    expect(describesRefusal(text("Motivele: {{ refusalGrounds }}."))).toBe(true);
    // Its own switch: the list's marker does not turn it on, nor it the list's.
    expect(describesListStates(text("{{refusalGrounds}}"))).toBe(false);
  });
});

describe("§NNN the express box's second wording", () => {
  it("names the refusal between the event's cancelling and the course, and is otherwise §421's words exactly", () => {
    expect(ro.Registration.terms.acceptWithRefusal).toBe(
      ro.Registration.terms.accept.replace("de către club, oprirea", "de către club, refuzarea sau anularea unei înscrieri de către club, oprirea"),
    );
    expect(en.Registration.terms.acceptWithRefusal).toBe(
      en.Registration.terms.accept.replace("changing an event, being stopped", "changing an event, the club refusing or cancelling a registration, being stopped"),
    );
    // §421's words are untouched.
    expect(ro.Registration.terms.accept).toBe(
      "Am citit și accept <terms>Termenii și condițiile</terms> (versiunea {version}), inclusiv, în mod expres, clauzele despre anularea sau modificarea evenimentului de către club, oprirea sau excluderea de pe traseu, limitele răspunderii clubului, legea aplicabilă și instanța competentă.",
    );
    expect(ro.Registration.terms.accept).not.toContain("refuz");
    expect(en.Registration.terms.accept).not.toContain("refus");
  });
});
