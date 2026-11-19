import { describe, expect, it } from "vitest";
import { legalDocumentKey } from "@/db/schema/legal-documents";
import { NEVER_SEEDED_KEYS, SAMPLE_DOCUMENTS } from "@/db/seeds/sample-legal-documents";
import { DOCUMENT_CODES } from "@/modules/legal-documents/domain/confirmation";
import { LEGAL_DOCUMENT_KEYS, PLATFORM_APPROVAL_KEYS, TEAM_AGREEMENT_KEY } from "@/modules/legal-documents/domain/keys";
import { mergeFieldsIn } from "@/modules/legal-documents/domain/merge-fields";
import { LEGAL_KIND_GROUPS } from "@/modules/legal-documents/domain/overview";
import { LEGAL_TEMPLATES, templatePrefill } from "@/modules/legal-documents/templates/catalogue";
import { clubFactsFromEnv, remainingPlaceholders } from "@/modules/legal-documents/templates/club-facts";
import { teamAgreementEn, teamAgreementRo } from "@/modules/legal-documents/templates/team-agreement";
import { CLUB_LOCALITY } from "@/modules/events/domain/place";
import { lawyerReads } from "@/modules/notifications/templates";
import { CLUB_NAME } from "@/theme/brand";
import en from "../../../messages/en.json";
import ro from "../../../messages/ro.json";

/**
 * §NNN — «Angajament de confidențialitate și protecția datelor pentru echipă», a legal document of the platform (BR-REQ-053-01;
 * the owner, 2026-11-19: «Voluntarii trebuie să semneze acordul GDPR când intră în platformă»):
 *
 * - a key of its own, last, in a group of its own on `/admin/legal`, its code one word in both languages;
 * - never put in force by anything but the club: not in the one press «Aprobă acum textele care lipsesc…», never seeded — a
 *   sample approved on a test database would stop every colleague below the Administrator at sign-in;
 * - a template in Romanian and English saying what the brief asks — the club's authority (GDPR art. 29, 32(4)), the data used only
 *   for the role's tasks, confidential during and after the role, no copies beyond the task, the printed lists, the session, an
 *   incident told at once, access withdrawn, not a contract of employment or of volunteering — with the club's four facts as visible
 *   placeholders and no merge field, no club, place, date or amount written in.
 */

const text = (body: { sections: ReadonlyArray<{ heading?: string; paragraphs: readonly string[] }> }) =>
  body.sections.flatMap((section) => [section.heading ?? "", ...section.paragraphs]).join("\n");

describe("§NNN BR-REQ-053-01 the team's undertaking is a legal document of the platform", () => {
  it("is a key of its own, last in the enum and in the list, in a group of its own, with a one-word code and a name in both languages", () => {
    expect(TEAM_AGREEMENT_KEY).toBe("STAFF_DATA_AGREEMENT");
    expect(legalDocumentKey.enumValues.at(-1)).toBe("STAFF_DATA_AGREEMENT");
    expect(LEGAL_DOCUMENT_KEYS.at(-1)).toBe("STAFF_DATA_AGREEMENT");
    expect(LEGAL_KIND_GROUPS.at(-1)).toEqual({ id: "team", keys: ["STAFF_DATA_AGREEMENT"] });
    expect(DOCUMENT_CODES.STAFF_DATA_AGREEMENT).toBe("TEAM");
    expect(LEGAL_TEMPLATES.STAFF_DATA_AGREEMENT.ro).toEqual({ title: "Angajament de confidențialitate și protecția datelor pentru echipă", body: teamAgreementRo });
    expect(LEGAL_TEMPLATES.STAFF_DATA_AGREEMENT.en).toEqual({ title: "Team confidentiality and data protection undertaking", body: teamAgreementEn });
    expect(ro.Admin.legal.keys.STAFF_DATA_AGREEMENT).toBe("Angajament de confidențialitate și protecția datelor pentru echipă");
    expect(en.Admin.legal.keys.STAFF_DATA_AGREEMENT).toBe("Team confidentiality and data protection undertaking");
    expect(ro.Admin.legal.groups.team).toBe("Angajamentul echipei");
    expect(en.Admin.legal.groups.team).toBe("The team's undertaking");
    expect(ro.Admin.legal.whatIs.STAFF_DATA_AGREEMENT).toMatch(/nimeni nu e întrebat/);
    expect(en.Admin.legal.whatIs.STAFF_DATA_AGREEMENT).toMatch(/nobody is asked/);
  });

  it("is put in force by the club alone: not by the one press, never by the seed", () => {
    expect(PLATFORM_APPROVAL_KEYS).not.toContain("STAFF_DATA_AGREEMENT");
    expect(NEVER_SEEDED_KEYS.has("STAFF_DATA_AGREEMENT")).toBe(true);
    expect(SAMPLE_DOCUMENTS.map((document) => document.key)).not.toContain("STAFF_DATA_AGREEMENT");
    // Every other text of the catalogue keeps its sample, so the participant's journey can still be walked on a test database.
    expect(SAMPLE_DOCUMENTS.map((document) => document.key)).toEqual(LEGAL_DOCUMENT_KEYS.filter((key) => key !== "STAFF_DATA_AGREEMENT"));
  });

  it("says, in both languages and the same ten sections, what the brief asks", () => {
    expect(teamAgreementRo.sections.map((section) => section.paragraphs.length)).toEqual(teamAgreementEn.sections.map((section) => section.paragraphs.length));
    expect(teamAgreementRo.sections).toHaveLength(10);
    const roText = text(teamAgreementRo);
    const enText = text(teamAgreementEn);
    for (const [words, english] of [
      // Under the club's authority and on its instructions: GDPR art. 29 and 32(4), named as every template names the regulation.
      ["numai sub autoritatea clubului și numai la instrucțiunile lui", "only under the club's authority and only on its instructions"],
      ["art. 29 și al art. 32 alin. (4) din Regulamentul (UE) 2016/679 (GDPR)", "Article 29 and Article 32(4) of Regulation (EU) 2016/679 (GDPR)"],
      ["ale participanților la evenimente, ale voluntarilor și ale membrilor clubului", "of the events' participants, of the volunteers and of the club's members"],
      ["numai pentru sarcinile rolului său", "only for the tasks of their role"],
      ["cât timp are rolul și după ce rolul se încheie", "while they hold the role and after the role ends"],
      ["Nu le dezvăluie nimănui din afara echipei clubului", "They disclose it to nobody outside the club's team"],
      ["nu face copii, exporturi, fotografii, capturi de ecran", "makes no copies, exports, photographs, screenshots"],
      ["O listă tipărită", "A printed list"],
      ["o predă organizatorilor sau o distruge", "they hand it back to the organisers or destroy it"],
      ["Nu lasă sesiunea deschisă nesupravegheată", "They never leave the session open unattended"],
      ["anunță clubul imediat, la <EMAIL DE CONTACT>", "tells the club at once, at <CONTACT EMAIL>"],
      ["a trimis date unei persoane greșite", "they sent data to the wrong person"],
      ["Clubul retrage accesul când rolul se încheie", "The club withdraws access when the role ends"],
      ["dacă angajamentul este încălcat", "if the undertaking is broken"],
      ["nu este un contract de muncă și nici un contract de voluntariat", "is neither a contract of employment nor a volunteering contract"],
      ["nota de confidențialitate a clubului", "the club's privacy notice"],
      ["O versiune nouă a angajamentului se acceptă din nou", "A new version of the undertaking is accepted again"],
      ["instanțele competente din România", "the competent courts of Romania"],
    ]) {
      expect(roText, words).toContain(words);
      expect(enText, english).toContain(english);
    }
  });

  it("leaves the club's four facts as visible placeholders and fills nothing else — no merge field, club, place, date or amount", () => {
    for (const [locale, body] of [["ro", teamAgreementRo], ["en", teamAgreementEn]] as const) {
      const all = text(body);
      expect([...mergeFieldsIn(body)], locale).toEqual([]);
      expect(remainingPlaceholders(body).sort(), locale).toEqual(
        (locale === "ro"
          ? ["<DENUMIREA JURIDICĂ COMPLETĂ A CLUBULUI>", "<ADRESA SEDIULUI>", "<NUMĂR DE ÎNREGISTRARE / CUI>", "<EMAIL DE CONTACT>"]
          : ["<THE CLUB'S FULL LEGAL NAME>", "<REGISTERED ADDRESS>", "<REGISTRATION NUMBER>", "<CONTACT EMAIL>"]
        ).sort(),
      );
      expect(all, locale).not.toContain(CLUB_NAME);
      expect(all, locale).not.toContain(CLUB_LOCALITY);
      expect(all, locale).not.toMatch(/\b20[2-9]\d\b|\blei\b|\bRON\b|\b\d{1,2}:\d{2}\b/);
      // Nothing of the screens' words: a button renamed must not leave the approved text behind.
      expect(all, locale).not.toMatch(/Accept și intru|Accept and enter|admin\/acord/);
    }
  });

  it("is filled from the deployment's facts on «start from the platform's text», every one of them", () => {
    const prefill = templatePrefill("STAFF_DATA_AGREEMENT", clubFactsFromEnv({
      CLUB_LEGAL_NAME: "Asociația Exemplu",
      CLUB_REGISTRATION_NUMBER: "CIF 12345678",
      CLUB_REGISTERED_ADDRESS: "Strada Exemplu 1",
      EMAIL_REPLY_TO: "club@example.test",
    }));
    for (const locale of ["ro", "en"] as const) {
      expect(remainingPlaceholders(prefill[locale].body), locale).toEqual([]);
      expect(text(prefill[locale].body), locale).toContain("Asociația Exemplu");
    }
  });

  it("is named to the lawyer as itself in «Șabloanele textelor legale s-au schimbat», never as a declaration", () => {
    expect(lawyerReads("ro", ["STAFF_DATA_AGREEMENT"])).toBe("Înainte de aprobare, un jurist ar trebui să citească angajamentul echipei.");
    expect(lawyerReads("en", ["PRIVACY_NOTICE", "STAFF_DATA_AGREEMENT"])).toBe("Before approving, a lawyer should read the changed texts, above all the team's undertaking.");
  });
});
