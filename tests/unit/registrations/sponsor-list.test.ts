import { describe, expect, it } from "vitest";
import en from "../../../messages/en.json";
import ro from "../../../messages/ro.json";
import { describesPromotionalMaterials, describesPromotionalMaterialsShared, isMergeField, mergeText } from "@/modules/legal-documents/domain/merge-fields";
import { privacyNoticeEn, privacyNoticeRo } from "@/modules/legal-documents/templates/privacy-notice";
import { DECLARATION_TOKENS } from "@/modules/legal-documents/templates/tokens";
import { noticeVersionInForceAt, sharedWithSponsors, sponsorShareGate } from "@/modules/registrations/domain/sponsor-share";
import { promotionalMaterialsMergeValues, promotionalMaterialsSharedClause } from "@/modules/registrations/promo-consent-words";
import { buildSponsorListCsv, sponsorListFileName } from "@/modules/registrations/sponsor-list";

/**
 * §570 — the list for sponsors (amending §562) and the public-list tick's words (amending §143):
 * the new merge field and its gate, the template's sections 4–7, the words in both languages, the
 * CSV's shape and its file name.
 */
const text = (...paragraphs: string[]) => ({ sections: [{ paragraphs }] });
const all = (body: typeof privacyNoticeRo) => body.sections.flatMap((section) => section.paragraphs);
const section = (body: typeof privacyNoticeRo, number: string) => body.sections.find((entry) => entry.heading?.startsWith(number))!.paragraphs.join(" ");

describe("§570 the privacy notice's marker for the sponsor list", () => {
  it("is a merge field of its own, beside the box's — the box keeps {{promotionalMaterials}} exactly", () => {
    expect(isMergeField("promotionalMaterialsShared")).toBe(true);
    expect(describesPromotionalMaterialsShared(text("Bifa {{promotionalMaterials}}."))).toBe(false);
    expect(describesPromotionalMaterials(text("Le dăm {{promotionalMaterialsShared}}."))).toBe(false);
    expect(describesPromotionalMaterialsShared(text("Le dăm {{ promotionalMaterialsShared }}."))).toBe(true);
    expect(describesPromotionalMaterialsShared("not a body")).toBe(false);
  });

  it("is named by the platform's notice in both languages, in sections 5 and 6, and the legend lists it", () => {
    for (const body of [privacyNoticeRo, privacyNoticeEn]) {
      expect(describesPromotionalMaterials(body)).toBe(true);
      expect(describesPromotionalMaterialsShared(body)).toBe(true);
      expect(section(body, "5.")).toContain("{{promotionalMaterialsShared}}");
      expect(section(body, "6.")).toContain("{{promotionalMaterialsShared}}");
    }
    const legend = DECLARATION_TOKENS.find((entry) => entry.token === "{{promotionalMaterialsShared}}");
    expect(legend?.example).toEqual({ ro: "prenumele, numele și adresa ta de e-mail", en: "your first name, last name and email address" });
    expect(ro.Admin.legal.tokens.promotionalMaterialsShared).toContain("partenerii clubului");
    expect(en.Admin.legal.tokens.promotionalMaterialsShared).toContain("club's partners");
  });

  it("is filled with the three data a partner receives, so the approved sentence names what the file carries", () => {
    expect(promotionalMaterialsSharedClause("ro")).toBe("prenumele, numele și adresa ta de e-mail");
    expect(promotionalMaterialsSharedClause("en")).toBe("your first name, last name and email address");
    for (const [locale, body] of [["ro", privacyNoticeRo], ["en", privacyNoticeEn]] as const) {
      const merged = all(body).map((paragraph) => mergeText(paragraph, promotionalMaterialsMergeValues(locale))).join(" ");
      expect(merged).toContain(promotionalMaterialsSharedClause(locale));
      expect(merged).not.toContain("{{promotionalMaterialsShared}}");
    }
  });

  it("says in section 5 who the partners are, never sold, consent to both, withdrawal stops the sharing and the partners are told, the complaint", () => {
    const [ro5] = all(privacyNoticeRo).filter((paragraph) => paragraph.startsWith("Lista pentru parteneri:"));
    const [en5] = all(privacyNoticeEn).filter((paragraph) => paragraph.startsWith("The list for partners:"));
    for (const words of ["sponsorilor clubului și partenerilor evenimentelor", "Nu vindem lista", "și mesajele clubului, și pe ale partenerilor", "nu îți mai dăm datele niciunui partener", "le cerem să nu îți mai scrie", "6(1)(a)", "ANSPDCP", "sub o versiune a acestei note care spune asta"]) {
      expect(ro5, words).toContain(words);
    }
    for (const words of ["the club's sponsors and the partners of its events", "We never sell the list", "both the club's messages and the partners'", "we give your data to no partner from then on", "we ask the partners who already hold it to stop writing to you", "6(1)(a)", "ANSPDCP", "under a version of this notice that says so"]) {
      expect(en5, words).toContain(words);
    }
    // §562's promise is gone from every paragraph: the next sentence would contradict it.
    expect(all(privacyNoticeRo).join(" ")).not.toContain("partenerii nu primesc adresa");
    expect(all(privacyNoticeEn).join(" ")).not.toContain("partners never receive your address");
  });

  it("carries the retention in section 7 and keeps the four placeholders and the twelve sections", () => {
    expect(section(privacyNoticeRo, "7.")).toContain("Lista dată partenerilor: copia clubului, ștearsă în cel mult 30 de zile de la descărcare");
    expect(section(privacyNoticeEn, "7.")).toContain("The list given to partners: the club's copy, deleted within 30 days of the download");
    expect(all(privacyNoticeRo).join(" ")).toContain("<EMAIL DE CONTACT>");
    expect(all(privacyNoticeEn).join(" ")).toContain("<CONTACT EMAIL>");
    expect(privacyNoticeRo.sections).toHaveLength(12);
    expect(privacyNoticeEn.sections).toHaveLength(12);
  });
});

describe("§570 which yes may reach a partner", () => {
  const versions = [
    { version: 1, effectiveAt: new Date("2026-01-01T00:00:00Z"), shares: false },
    { version: 2, effectiveAt: new Date("2026-06-01T00:00:00Z"), shares: true },
    { version: 3, effectiveAt: new Date("2026-09-01T00:00:00Z"), shares: false },
  ];
  const gate = sponsorShareGate(versions);

  it("reads the version in force at a moment, as the site answered then", () => {
    expect(noticeVersionInForceAt(versions, new Date("2025-12-31T00:00:00Z"))).toBeNull();
    expect(noticeVersionInForceAt(versions, new Date("2026-03-01T00:00:00Z"))).toBe(1);
    expect(noticeVersionInForceAt(versions, new Date("2026-07-01T00:00:00Z"))).toBe(2);
    expect(noticeVersionInForceAt(versions, new Date("2026-09-02T00:00:00Z"))).toBe(3);
  });

  it("shares only a yes whose recorded notice and whose notice at the moment both describe the sharing — an exact set, never a lower bound", () => {
    const yes = (privacyNoticeVersion: number, at: string | null) => sharedWithSponsors({ promoConsent: true, promoConsentAt: at ? new Date(at) : null, privacyNoticeVersion }, gate);
    expect(yes(2, "2026-07-01T00:00:00Z")).toBe(true);
    expect(yes(1, "2026-03-01T00:00:00Z")).toBe(false);
    expect(yes(1, "2026-07-01T00:00:00Z")).toBe(false);
    // A later notice that dropped the marker: its registrants are not shared, whatever came before (§421's warning).
    expect(yes(3, "2026-09-02T00:00:00Z")).toBe(false);
    expect(yes(2, "2026-09-02T00:00:00Z")).toBe(false);
    expect(yes(2, null)).toBe(false);
    expect(sharedWithSponsors({ promoConsent: false, promoConsentAt: new Date("2026-07-01T00:00:00Z"), privacyNoticeVersion: 2 }, gate)).toBe(false);
  });
});

describe("§570 the sponsor list's file", () => {
  const header = { firstName: "Prenume", lastName: "Nume", email: "Email", event: "Eveniment", consentedAt: "Data acordului" };
  const row = { firstName: "Ana", lastName: "Pop", email: "ana@example.ro", eventTitle: "Crosul, toamna", consentedAt: new Date("2026-09-29T10:00:00.000Z") };

  it("is five columns — Prenume, Nume, Email, Eveniment, Data acordului — with a BOM, CRLF and every cell neutralized", () => {
    const csv = buildSponsorListCsv(header, [row, { ...row, firstName: "=HYPERLINK(1)", eventTitle: null, consentedAt: null }]);
    const lines = csv.split("\r\n");
    expect(lines[0]).toBe("﻿Prenume,Nume,Email,Eveniment,Data acordului");
    expect(lines[1]).toBe('Ana,Pop,ana@example.ro,"Crosul, toamna",2026-09-29T10:00:00.000Z');
    expect(lines[2]).toBe("'=HYPERLINK(1),Pop,ana@example.ro,,");
    expect(lines[0].split(",")).toHaveLength(5);
  });

  it("names the file by the event's slug or «toate», with the day, and nothing else reaches the header", () => {
    expect(sponsorListFileName("crosul-toamnei", "2026-09-29")).toBe("sponsori-crosul-toamnei-2026-09-29.csv");
    expect(sponsorListFileName(null, "2026-09-29")).toBe("sponsori-toate-2026-09-29.csv");
    expect(sponsorListFileName('a"b\r\nc', "2026-09-29")).toBe("sponsori-a-b-c-2026-09-29.csv");
  });

  it("has its words in both languages, the headers the owner named", () => {
    expect(ro.Admin.sponsors.columns).toEqual({ firstName: "Prenume", lastName: "Nume", email: "Email", event: "Eveniment", consentedAt: "Data acordului" });
    expect(Object.keys(en.Admin.sponsors.columns)).toEqual(Object.keys(ro.Admin.sponsors.columns));
    expect(ro.Admin.sponsors.button).toBe("Descarcă lista pentru sponsori");
    expect(en.Admin.sponsors.button).toBe("Download the list for sponsors");
    expect(ro.Admin.sponsors.noticeMissing).toBe("Nota de confidențialitate în vigoare nu spune că lista poate fi dată partenerilor.");
    for (const catalogue of [ro, en]) {
      for (const words of [catalogue.Admin.sponsors.help, catalogue.Admin.sponsors.noticeMissing, catalogue.Registrations.promo.yesShared]) {
        expect(words.length).toBeLessThanOrEqual(200);
        expect(words).not.toMatch(/platforma|de obicei|the platform/i);
      }
    }
  });
});

describe("§570 the public-list tick names the list and the results", () => {
  it("reads «… & rezultate» on the form, the switches, the backoffice and the list's own note", () => {
    expect(ro.Registration.listOptIn).toBe("Vreau să apar pe lista de participanți & rezultate");
    expect(en.Registration.listOptIn).toBe("I want to appear on the participants & results list");
    expect(ro.Registrations.list.optIn).toBe("Vreau să apar pe lista de participanți & rezultate");
    expect(ro.Registrations.list.optOut).toBe("Nu vreau să apar pe lista de participanți & rezultate");
    expect(en.Registrations.list.optIn).toBe("I want to appear on the participants & results list");
    expect(en.Registrations.list.optOut).toBe("I do not want to appear on the participants & results list");
    expect(ro.Admin.registrations.listOptIn).toBe("Persoana vrea să apară pe lista de participanți & rezultate");
    for (const words of [ro.Event.startList.note, ro.Event.startList.noteStates, ro.Admin.editor.participantListHelp]) expect(words).toContain("„Vreau să apar pe lista de participanți & rezultate”");
    for (const words of [en.Event.startList.note, en.Event.startList.noteStates, en.Admin.editor.participantListHelp]) expect(words).toContain("“I want to appear on the participants & results list”");
  });

  it("no catalogue still names the tick by its old words", () => {
    expect(JSON.stringify(ro)).not.toMatch(/Vreau să apar pe lista de participanți”|Vreau să apar pe lista publică/);
    expect(JSON.stringify(en)).not.toMatch(/appear on the participant list|Show my name on the public list/);
  });

  it("section 4 names the list and the results as one disclosure behind one tick, in both languages", () => {
    const ro4 = section(privacyNoticeRo, "4.");
    const en4 = section(privacyNoticeEn, "4.");
    expect(ro4).toContain("au bifat „vreau să apar pe lista de participanți & rezultate”");
    expect(ro4).toContain("o singură bifă pentru listă și pentru rezultate");
    expect(ro4).not.toContain("te vom întreba separat");
    expect(en4).toContain("ticked “I want to appear on the participants & results list”");
    expect(en4).toContain("one tick for the list and the results");
    expect(en4).not.toContain("ask you separately");
  });
});
