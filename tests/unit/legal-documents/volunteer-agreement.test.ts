import { describe, expect, it } from "vitest";
import { legalDocumentKey } from "@/db/schema/legal-documents";
import { DOCUMENT_CODES } from "@/modules/legal-documents/domain/confirmation";
import type { LegalDocumentBody } from "@/modules/legal-documents/domain/content-hash";
import { LEGAL_DOCUMENT_KEYS, PLATFORM_APPROVAL_KEYS, VOLUNTEER_AGREEMENT_KEY } from "@/modules/legal-documents/domain/keys";
import { BLANK, isMergeField, mergeFieldsIn, mergeLegalBody, PARAGRAPH_MERGE_FIELDS, VOLUNTEER_MERGE_FIELDS } from "@/modules/legal-documents/domain/merge-fields";
import { LEGAL_KIND_GROUPS } from "@/modules/legal-documents/domain/overview";
import { LEGAL_TEMPLATES, templatePrefill } from "@/modules/legal-documents/templates/catalogue";
import { clubFactsFromEnv, remainingPlaceholders } from "@/modules/legal-documents/templates/club-facts";
import { DECLARATION_TOKENS } from "@/modules/legal-documents/templates/tokens";
import { volunteerAgreementEn, volunteerAgreementRo } from "@/modules/legal-documents/templates/volunteer-agreement";
import { AGREEMENT_FACT_FIELDS, tasksWords } from "@/modules/volunteers/agreement";
import { acceptedHowWords, volunteerAgreementLabels } from "@/modules/volunteers/agreement-pdf";
import en from "../../../messages/en.json";
import ro from "../../../messages/ro.json";

/**
 * §758 (amending §754) — the volunteer agreement's template, as the owner asked for it on 2026-10-13: «un
 * document gen „contract de voluntariat” simplu, unde zicem că nu sunt plătiți, că trebuie să respecte
 * atribuțiunile». What it must say, in both languages; that its blanks are the four club facts and the merge
 * fields an acceptance fills (never a value of its own, §357); that the facts kept on a volunteer's row are
 * exactly the fields the text names, so the fingerprint and the PDF are filled from one set; and that a role
 * with no description leaves its sentence out.
 */
const text = (body: LegalDocumentBody) => body.sections.flatMap((section) => [section.heading ?? "", ...section.paragraphs]).join("\n");

const FACTS = clubFactsFromEnv({
  CLUB_LEGAL_NAME: "Asociația Exemplu",
  CLUB_REGISTRATION_NUMBER: "CIF 12345678",
  CLUB_REGISTERED_ADDRESS: "Str. Exemplu nr. 1",
  EMAIL_REPLY_TO: "contact@example.test",
});

describe("§758 the volunteer agreement is a legal document of the platform", () => {
  it("is a key of its own, last in the enum and in the backoffice's list, in a group of its own, approved by the one press too", () => {
    expect(VOLUNTEER_AGREEMENT_KEY).toBe("VOLUNTEER_AGREEMENT");
    expect(legalDocumentKey.enumValues.at(-1)).toBe("VOLUNTEER_AGREEMENT");
    expect(LEGAL_DOCUMENT_KEYS.at(-1)).toBe("VOLUNTEER_AGREEMENT");
    expect(PLATFORM_APPROVAL_KEYS).toContain("VOLUNTEER_AGREEMENT");
    expect(LEGAL_KIND_GROUPS.find((group) => group.id === "volunteers")?.keys).toEqual(["VOLUNTEER_AGREEMENT"]);
    expect(DOCUMENT_CODES.VOLUNTEER_AGREEMENT).toBe("VOLUNTEER");
  });

  it("is named in both languages, on the list and in its template", () => {
    expect(LEGAL_TEMPLATES.VOLUNTEER_AGREEMENT.ro.title).toBe("Contract de voluntariat");
    expect(LEGAL_TEMPLATES.VOLUNTEER_AGREEMENT.en.title).toBe("Volunteer agreement");
    expect(ro.Admin.legal.keys.VOLUNTEER_AGREEMENT).toBe("Contract de voluntariat");
    expect(en.Admin.legal.keys.VOLUNTEER_AGREEMENT).toBe("Volunteer agreement");
    expect(LEGAL_TEMPLATES.VOLUNTEER_AGREEMENT.ro.body).toBe(volunteerAgreementRo);
    expect(LEGAL_TEMPLATES.VOLUNTEER_AGREEMENT.en.body).toBe(volunteerAgreementEn);
  });
});

describe("§758 what the agreement says, in the owner's terms", () => {
  const roText = text(volunteerAgreementRo);
  const enText = text(volunteerAgreementEn);

  it("says the help is unpaid and no employment, and costs announced beforehand are not pay", () => {
    expect(roText).toContain("fără plată");
    expect(roText).toContain("nu primește salariu, onorariu sau altă plată");
    expect(roText).toContain("nu este un contract de muncă");
    expect(enText).toContain("without pay");
    expect(enText).toContain("not an employment contract");
  });

  it("names the volunteer's duties: the role's tasks, the organizers' instructions, safety and the rules, the participants' data, telling when they cannot come", () => {
    for (const words of [
      "sarcinile rolului său",
      "indicațiile organizatorilor",
      "regulile de siguranță, regulamentul evenimentului",
      "confidențialitatea datelor personale ale participanților",
      "dacă nu poate veni",
    ]) {
      expect(roText, words).toContain(words);
    }
    for (const words of ["tasks of their role", "organisers' instructions", "safety rules, the event's rules", "keep confidential the participants' personal data", "cannot come"]) {
      expect(enText, words).toContain(words);
    }
  });

  it("names the club's duties: the role and its risks, the means, a contact on the day, a volunteer certificate on request", () => {
    for (const words of ["riscurile lui", "mijloacele de care rolul are nevoie", "persoană de contact", "certificat de voluntariat"]) expect(roText, words).toContain(words);
    for (const words of ["its risks", "the means the role needs", "contact person", "volunteer certificate"]) expect(enText, words).toContain(words);
  });

  it("says how long it lasts and that either side may end it at any time, points to the privacy notice and names the volunteering law", () => {
    expect(roText).toContain("Oricare parte poate pune capăt contractului oricând");
    expect(enText).toContain("Either party may end the agreement at any time");
    expect(roText).toContain("ziua evenimentului");
    expect(roText).toContain("notei de confidențialitate a clubului");
    expect(enText).toContain("the club's privacy notice");
    expect(roText).toContain("Legii nr. 78/2014");
    expect(enText).toContain("Law no. 78/2014");
  });

  it("promises only the copies the platform makes: the volunteer's by email, the proof kept as the notice says", () => {
    expect(roText).toContain("Voluntarul primește pe email o copie a contractului acceptat, ca PDF.");
    expect(roText).toContain("Clubul păstrează dovada acceptării cât timp spune nota de confidențialitate.");
    expect(enText).toContain("The volunteer receives a copy of the accepted agreement by email, as a PDF.");
    expect(enText).toContain("The club keeps the proof of acceptance for as long as the privacy notice says.");
    // Never a copy «that stays with the club» the platform deletes thirty days after the event.
    expect(roText).not.toContain("una rămâne la club");
    expect(enText).not.toContain("one stays with the club");
  });
});

describe("§758 the agreement's blanks", () => {
  it("names only fields the merge knows: the volunteer's three, the event's three, the age and the moment — the facts a row keeps", () => {
    for (const body of [volunteerAgreementRo, volunteerAgreementEn]) {
      for (const match of text(body).matchAll(/\{\{\s*([a-zA-Z]+)\s*\}\}/g)) expect(isMergeField(match[1]), match[1]).toBe(true);
      expect([...mergeFieldsIn(body)].sort()).toEqual([...AGREEMENT_FACT_FIELDS].sort());
    }
    expect([...VOLUNTEER_MERGE_FIELDS]).toEqual(["volunteer", "volunteerRole", "volunteerTasks", "volunteerRoleChoices", "volunteerChoiceTasks"]);
    // Each has a line in the editor's legend, in both languages.
    for (const field of VOLUNTEER_MERGE_FIELDS) {
      expect(DECLARATION_TOKENS.some((token) => token.token === `{{${field}}}`), field).toBe(true);
      expect((ro.Admin.legal.tokens as Record<string, string>)[field], field).toBeTruthy();
      expect((en.Admin.legal.tokens as Record<string, string>)[field], field).toBeTruthy();
    }
  });

  it("carries the club's four facts as placeholders, and «start from the platform's text» fills every one of them", () => {
    for (const locale of ["ro", "en"] as const) {
      expect(remainingPlaceholders(LEGAL_TEMPLATES.VOLUNTEER_AGREEMENT[locale].body).length, locale).toBe(4);
      const filled = templatePrefill("VOLUNTEER_AGREEMENT", FACTS)[locale].body;
      expect(remainingPlaceholders(filled), locale).toEqual([]);
      expect(text(filled)).toContain("Asociația Exemplu");
      expect(text(filled)).toContain("Str. Exemplu nr. 1");
      expect(text(filled)).toContain("contact@example.test");
      // The merge fields survive the prefill: they are filled for one person at acceptance, never here.
      expect([...mergeFieldsIn(filled)].sort()).toEqual([...AGREEMENT_FACT_FIELDS].sort());
    }
  });

  it("fills the person, the role and the event, and leaves out «what the role involves» for a role with no description", () => {
    const values = {
      volunteer: "Ana Popescu",
      volunteerRole: "Punct de apă",
      volunteerTasks: "Împarte apă",
      volunteerRoleChoices: "",
      volunteerChoiceTasks: "",
      event: "Crosul",
      eventDate: "sâmbătă, 21 nov. 2026",
      eventLocation: "Parcul central",
      minimumAge: "18 ani",
      signedAt: "marți, 13 oct. 2026, la 13:00",
    };
    const merged = text(mergeLegalBody(volunteerAgreementRo, values));
    expect(merged).toContain("Voluntarul este Ana Popescu.");
    expect(merged).toContain("Voluntarul declară că are cel puțin 18 ani împliniți.");
    expect(merged).toContain("la evenimentul Crosul, care are loc sâmbătă, 21 nov. 2026, în Parcul central.");
    expect(merged).toContain("Voluntarul are rolul Punct de apă.");
    // A role given: the choices' sentences are left out.
    expect(merged).not.toContain("Rolul îl stabilesc organizatorii");
    expect(merged).not.toContain("Ce presupune fiecare rol");
    expect(merged).toContain("Ce presupune rolul: Împarte apă.");
    expect(merged).not.toContain(BLANK);
    expect(PARAGRAPH_MERGE_FIELDS.has("volunteerTasks")).toBe(true);
    const noTasks = text(mergeLegalBody(volunteerAgreementRo, { ...values, volunteerTasks: "" }));
    expect(noTasks).not.toContain("Ce presupune rolul");
    expect(noTasks).toContain("Voluntarul are rolul Punct de apă.");
    // A description typed as a sentence keeps one full stop, never two (`tasksWords`, applied before the facts freeze).
    const typed = text(mergeLegalBody(volunteerAgreementRo, { ...values, volunteerTasks: tasksWords("Împarte apă la kilometrul 5. ") }));
    expect(typed).toContain("Ce presupune rolul: Împarte apă la kilometrul 5.");
    expect(typed).not.toContain("5..");
    expect(tasksWords("Hands out water!")).toBe("Hands out water");
    expect(tasksWords("Ține steagul…")).toBe("Ține steagul");
    expect(tasksWords("No mark")).toBe("No mark");
    // Only the one closing mark: the club's own words inside stay as typed.
    expect(tasksWords("Ora 8. Apoi la km 5.")).toBe("Ora 8. Apoi la km 5");
    // Punctuation alone is no description: the sentence is left out.
    expect(tasksWords(" . ")).toBe("");
    // Unfilled, as the public page shows it: dotted blanks, never a sentence lost.
    expect(text(mergeLegalBody(volunteerAgreementRo, { minimumAge: "18 ani" }))).toContain(`Voluntarul este ${BLANK}.`);
  });
});

describe("§758 the PDF's own words", () => {
  it("signs as the volunteer and, on paper, the organizer — never with an identity document", () => {
    const labels = volunteerAgreementLabels("ro", new Date("2026-10-13T10:00:00Z"));
    expect(labels.signature).toBe("Semnătura voluntarului");
    expect(labels.minorSignature).toBe("Semnătura voluntarului");
    expect(labels.guardianSignature).toBe("Pentru organizator (nume și semnătură)");
    expect(labels.whereuponTogether).toBe("DREPT PENTRU CARE SEMNĂM,");
    expect(volunteerAgreementLabels("en", new Date("2026-10-13T10:00:00Z")).guardianSignature).toBe("For the organiser (name and signature)");
  });

  it("says how it was accepted: on the page, from the link, or on paper and who recorded it", () => {
    expect(acceptedHowWords("ro", "FORM", "marți, 13 oct.", null)).toContain("pe pagina evenimentului");
    expect(acceptedHowWords("ro", "LINK", "marți, 13 oct.", null)).toContain("din linkul unic trimis");
    expect(acceptedHowWords("ro", "PAPER", "marți, 13 oct. 2026, la 13:00", "Ana Admin")).toBe(
      "Semnat pe hârtie, la organizatori; înregistrat de Ana Admin, marți, 13 oct. 2026, la 13:00. Originalul semnat este păstrat de club.",
    );
    // A recording account removed since: said, never a blank.
    expect(acceptedHowWords("en", "PAPER", "Tuesday", null)).toContain("a team member (account removed)");
  });
});

describe("§761 the agreement before a role is given", () => {
  const base = {
    volunteer: "Ana Popescu",
    event: "Crosul",
    eventDate: "sâmbătă, 21 nov. 2026",
    eventLocation: "Parcul central",
    minimumAge: "18 ani",
    signedAt: "marți, 13 oct. 2026, la 13:00",
  };

  it("names the roles offered for in the template's own sentence, and leaves out the role's, in both languages", () => {
    const ro = text(
      mergeLegalBody(volunteerAgreementRo, {
        ...base,
        volunteerRole: "",
        volunteerTasks: "",
        volunteerRoleChoices: "Masă, Traseu",
        volunteerChoiceTasks: "Masă — dă numerele; Traseu — arată drumul",
      }),
    );
    expect(ro).toContain("Rolul îl stabilesc organizatorii dintre cele pentru care voluntarul s-a oferit — Masă, Traseu — și i-l comunică pe email.");
    expect(ro).toContain("Ce presupune fiecare rol: Masă — dă numerele; Traseu — arată drumul.");
    expect(ro).not.toContain("Voluntarul are rolul");
    expect(ro).not.toContain("Ce presupune rolul:");
    // The event's sentence stays whole: it names no role field.
    expect(ro).toContain("la evenimentul Crosul, care are loc sâmbătă, 21 nov. 2026, în Parcul central.");
    expect(ro).not.toContain(BLANK);
    const en = text(
      mergeLegalBody(volunteerAgreementEn, { ...base, volunteerRole: "", volunteerTasks: "", volunteerRoleChoices: "Desk, Course", volunteerChoiceTasks: "" }),
    );
    expect(en).toContain("The organisers choose the role from those the volunteer offered to do — Desk, Course — and tell the volunteer by email.");
    expect(en).not.toContain("What each role involves");
    expect(en).not.toContain("The volunteer's role is");
  });

  it("keeps every role sentence out of the code: the template carries the words, the fields only names and descriptions", () => {
    for (const field of ["volunteerRole", "volunteerTasks", "volunteerRoleChoices", "volunteerChoiceTasks"]) expect(PARAGRAPH_MERGE_FIELDS.has(field), field).toBe(true);
    for (const body of [volunteerAgreementRo, volunteerAgreementEn]) {
      const paragraphs = body.sections.flatMap((section) => section.paragraphs);
      // Each role field in a paragraph of its own, so dropping one never takes the event's sentence with it.
      for (const field of ["volunteerRole", "volunteerTasks", "volunteerRoleChoices", "volunteerChoiceTasks"]) {
        const naming = paragraphs.filter((paragraph) => paragraph.includes(`{{${field}}}`));
        expect(naming, field).toHaveLength(1);
        expect(naming[0], field).not.toContain("{{event}}");
      }
    }
  });
});
