import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import en from "../../../messages/en.json";
import ro from "../../../messages/ro.json";
import { describesPromotionalMaterials, isMergeField, mergeText } from "@/modules/legal-documents/domain/merge-fields";
import { privacyNoticeEn, privacyNoticeRo } from "@/modules/legal-documents/templates/privacy-notice";
import { DECLARATION_TOKENS } from "@/modules/legal-documents/templates/tokens";
import { buildPromoConsentersCsv, PROMO_LISTED_STATUSES } from "@/modules/newsletter/promo-consenters";
import { buildRegistrationsCsv, type RegistrationCsvRow } from "@/modules/registrations/csv";
import { declarationSigningSchema, withoutAnotherAdultsConsents } from "@/modules/registrations/fields";
import { readRegistrationForm } from "@/modules/registrations/form-mapping";
import { promotionalMaterialsClause, promotionalMaterialsMergeValues } from "@/modules/registrations/promo-consent-words";
import { REGISTRATION_SHEET_HEADERS } from "@/modules/registrations/workbook";

/**
 * §NNN — «Vreau să primesc materiale promoționale de la club și de la partenerii lui»: the privacy
 * notice's marker that switches the box on, the words, the form's reading, and the export's column.
 */
const text = (paragraph: string) => ({ sections: [{ paragraphs: [paragraph] }] });
const paragraphs = (body: typeof privacyNoticeRo) => body.sections.flatMap((section) => section.paragraphs);

describe("§NNN the privacy notice's marker for promotional materials", () => {
  it("is a merge field the platform's notice carries in both languages, and the legend lists", () => {
    expect(isMergeField("promotionalMaterials")).toBe(true);
    expect(describesPromotionalMaterials(privacyNoticeRo)).toBe(true);
    expect(describesPromotionalMaterials(privacyNoticeEn)).toBe(true);
    const legend = DECLARATION_TOKENS.find((entry) => entry.token === "{{promotionalMaterials}}");
    expect(legend?.example).toEqual({ ro: promotionalMaterialsClause("ro"), en: promotionalMaterialsClause("en") });
  });

  it("is off for a text that does not name it — the gate for the box, the tick and the switch", () => {
    expect(describesPromotionalMaterials(text("Trimitem doar mesaje despre înscriere."))).toBe(false);
    expect(describesPromotionalMaterials(text("{{newsletterTopics}}"))).toBe(false);
    expect(describesPromotionalMaterials(text("{{promotionalMaterial}}"))).toBe(false);
    expect(describesPromotionalMaterials("not a body")).toBe(false);
    expect(describesPromotionalMaterials(text("Bifa {{ promotionalMaterials }}."))).toBe(true);
  });

  it("is filled with the form's own box, quoted, so the approved text names the box a person ticks", () => {
    expect(promotionalMaterialsClause("ro")).toBe(`„${ro.Registration.promo.label}”`);
    expect(promotionalMaterialsClause("en")).toBe(`“${en.Registration.promo.label}”`);
    for (const [locale, body] of [["ro", privacyNoticeRo], ["en", privacyNoticeEn]] as const) {
      const all = paragraphs(body).map((paragraph) => mergeText(paragraph, promotionalMaterialsMergeValues(locale))).join(" ");
      expect(all).toContain(promotionalMaterialsClause(locale));
      expect(all).not.toContain("{{promotionalMaterials}}");
    }
  });

  it("says in section 5 what the materials are, who sends them, the basis, the box and the withdrawal", () => {
    const [ro5] = paragraphs(privacyNoticeRo).filter((paragraph) => paragraph.includes("{{promotionalMaterials}}"));
    const [en5] = paragraphs(privacyNoticeEn).filter((paragraph) => paragraph.includes("{{promotionalMaterials}}"));
    expect(privacyNoticeRo.sections.find((section) => section.paragraphs.includes(ro5))?.heading).toBe("5. E-mailurile");
    expect(privacyNoticeEn.sections.find((section) => section.paragraphs.includes(en5))?.heading).toBe("5. Emails");
    for (const words of ["partenerii nu primesc adresa", "6(1)(a)", "opțională", "nu e bifată dinainte", "pagina înscrierii", "<EMAIL DE CONTACT>", "newsletter"]) {
      expect(ro5).toContain(words);
    }
    for (const words of ["partners never receive your address", "6(1)(a)", "optional", "never ticked in advance", "registration's page", "<EMAIL DE CONTACT>", "newsletter"]) {
      expect(en5).toContain(words);
    }
  });

  it("names the partners in section 6 as receiving nothing, and the retention in section 7", () => {
    const section = (body: typeof privacyNoticeRo, number: string) => body.sections.find((entry) => entry.heading?.startsWith(number))!.paragraphs.join(" ");
    expect(section(privacyNoticeRo, "6.")).toContain("nici partenerilor clubului");
    expect(section(privacyNoticeEn, "6.")).toContain("not to the club's partners either");
    expect(section(privacyNoticeRo, "7.")).toContain("Acordul pentru materiale promoționale: până îl retragi");
    expect(section(privacyNoticeEn, "7.")).toContain("The consent to promotional materials: until you withdraw it");
  });

  it("keeps the twelve sections the code and the guide cite", () => {
    expect(privacyNoticeRo.sections).toHaveLength(12);
    expect(privacyNoticeEn.sections).toHaveLength(12);
  });
});

describe("§NNN the form's box", () => {
  it("is read as posted — never pre-ticked, never required; the service decides what is kept", () => {
    const form = new FormData();
    expect(readRegistrationForm(form, "ro").promoConsent).toBe(false);
    form.set("promoConsent", "on");
    expect(readRegistrationForm(form, "ro").promoConsent).toBe(true);
  });

  it("is never another adult's to give from someone else's address (§421); a minor's parent gives it", () => {
    const now = new Date("2026-09-29T10:00:00.000Z");
    const adult = withoutAnotherAdultsConsents({ birthDate: "1990-01-01", promoConsent: true }, now) as Record<string, unknown>;
    expect(adult.promoConsent).toBe(false);
    const minor = withoutAnotherAdultsConsents({ birthDate: "2012-01-01", promoConsent: true }, now) as Record<string, unknown>;
    expect(minor.promoConsent).toBe(true);
  });

  it("rides on the declaration's signing as an optional yes, false when absent", () => {
    const base = { accepted: true, typedName: "Ana Pop", documentId: "00000000-0000-4000-8000-000000000000", contentSha256: "a".repeat(64) };
    expect(declarationSigningSchema.parse(base).promoConsent).toBe(false);
    expect(declarationSigningSchema.parse({ ...base, promoConsent: true }).promoConsent).toBe(true);
  });

  it("has its words in both languages, plain and short", () => {
    for (const catalogue of [ro, en]) {
      const all = [
        catalogue.Registration.promo.label,
        catalogue.Registration.promo.help,
        ...Object.values(catalogue.Registrations.promo),
        catalogue.Admin.registrations.promo.yes,
        catalogue.Admin.registrations.promo.no,
        catalogue.Admin.registrations.promo.staffNo,
      ];
      for (const words of all) {
        expect(words.length).toBeLessThanOrEqual(200);
        expect(words).not.toMatch(/platforma|de obicei/i);
      }
    }
    expect(ro.Registration.promo.label).toBe("Vreau să primesc materiale promoționale de la club și de la partenerii lui");
    expect(en.Registration.promo.label).toBe("I want to receive promotional materials from the club and its partners");
    expect(ro.Registration.promo.help).toBe("Poți renunța oricând din pagina înscrierii tale.");
    expect(en.Registration.promo.help).toBe("You can opt out any time from your registration page.");
    // Two consents, two switches: the words on the person's page say so.
    expect(ro.Registrations.promo.help).toContain("newsletter");
    expect(en.Registrations.promo.help).toContain("newsletter");
  });
});

describe("§NNN the exports", () => {
  const row = (promoConsentAt: string): RegistrationCsvRow => ({
    eventTitle: "Crosul",
    registeredName: "Ana Pop",
    firstName: "Ana",
    lastName: "Pop",
    idDocument: "",
    email: "ana@example.ro",
    status: "CONFIRMED",
    clubMemberDeclared: false,
    fitnessDeclaredAt: null,
    stravaUrl: "",
    instagramHandle: "",
    guardianName: "",
    guardianIdDocument: "",
    submittedAt: "2026-09-29T10:00:00.000Z",
    confirmedAt: "",
    checkedInAt: "",
    emailBounced: false,
    promoConsentAt,
  });

  it("the registrations CSV ends with «Promotional materials»: the moment of the yes, or empty", () => {
    const [header, yes, no] = buildRegistrationsCsv([row("2026-09-29T10:00:00.000Z"), row("")]).split("\r\n");
    expect(header.split(",").at(-1)).toBe("Promotional materials");
    expect(yes.split(",").at(-1)).toBe("2026-09-29T10:00:00.000Z");
    expect(no.split(",").at(-1)).toBe("");
    expect(REGISTRATION_SHEET_HEADERS.at(-1)).toBe("Promotional materials");
  });

  it("the promotional-materials CSV neutralizes formulas, carries a BOM and CRLF", () => {
    const csv = buildPromoConsentersCsv({ name: "Nume", email: "Adresa de email", event: "Evenimentul", consentedAt: "Bifat pe" }, [
      { registrationId: "x", name: "=HYPERLINK(1)", email: "ana@example.ro", eventTitle: "Crosul, toamna", consentedAt: new Date("2026-09-29T10:00:00.000Z") },
    ]);
    expect(csv.startsWith("﻿Nume,Adresa de email,Evenimentul,Bifat pe\r\n")).toBe(true);
    expect(csv).toContain("'=HYPERLINK(1)");
    expect(csv).toContain('"Crosul, toamna"');
    expect(csv).toContain("2026-09-29T10:00:00.000Z");
  });

  it("lists no cancelled, expired or unproved registration", () => {
    expect(PROMO_LISTED_STATUSES).not.toContain("CANCELLED");
    expect(PROMO_LISTED_STATUSES).not.toContain("EXPIRED");
    expect(PROMO_LISTED_STATUSES).not.toContain("PENDING_EMAIL_CONFIRMATION");
  });
});

describe("§NNN no public page imports the backoffice glyph table (§318)", () => {
  it("the pages that draw the box and the switch take their glyphs from @mui/icons-material/<Name>", () => {
    const root = process.cwd();
    const files = [
      "src/app/[locale]/events/[slug]/register/page.tsx",
      "src/app/[locale]/registrations/manage/[token]/page.tsx",
      "src/app/[locale]/registrations/mine/[token]/page.tsx",
      "src/app/[locale]/registrations/declare/[token]/page.tsx",
    ];
    for (const file of files) {
      const source = readFileSync(path.join(root, file), "utf8");
      expect(source).toContain('from "@mui/icons-material/Campaign"');
      expect(source).not.toContain("action-icons");
      expect(source).not.toMatch(/from "@mui\/icons-material"/);
    }
    // And the files exist where the list above says.
    expect(readdirSync(path.join(root, "src/app/[locale]/registrations")).length).toBeGreaterThan(0);
    expect(statSync(path.join(root, files[0])).isFile()).toBe(true);
  });
});
