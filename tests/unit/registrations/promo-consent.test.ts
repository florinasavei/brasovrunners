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
import { CLUB_NAME } from "@/theme/brand";

/**
 * §562 — «Vreau să primesc oferte și beneficii de la <club> și partenerii săi.»: the privacy
 * notice's marker that switches the box on, the words, the form's reading, and the export's column.
 */
const text = (paragraph: string) => ({ sections: [{ paragraphs: [paragraph] }] });
const paragraphs = (body: typeof privacyNoticeRo) => body.sections.flatMap((section) => section.paragraphs);

describe("§562 the privacy notice's marker for offers and benefits", () => {
  it("is a merge field the platform's notice carries in both languages, and the legend lists", () => {
    expect(isMergeField("promotionalMaterials")).toBe(true);
    expect(describesPromotionalMaterials(privacyNoticeRo)).toBe(true);
    expect(describesPromotionalMaterials(privacyNoticeEn)).toBe(true);
    const legend = DECLARATION_TOKENS.find((entry) => entry.token === "{{promotionalMaterials}}");
    // The legend never names the club (§369): the same sentence with a plain «club».
    expect(legend?.example).toEqual({ ro: promotionalMaterialsClause("ro", "club"), en: promotionalMaterialsClause("en", "the club") });
    expect(legend?.example.ro).toBe("„Vreau să primesc oferte și beneficii de la club și partenerii săi.”");
  });

  it("is off for a text that does not name it — the gate for the box, the tick and the switch", () => {
    expect(describesPromotionalMaterials(text("Trimitem doar mesaje despre înscriere."))).toBe(false);
    expect(describesPromotionalMaterials(text("{{newsletterTopics}}"))).toBe(false);
    expect(describesPromotionalMaterials(text("{{promotionalMaterial}}"))).toBe(false);
    expect(describesPromotionalMaterials("not a body")).toBe(false);
    expect(describesPromotionalMaterials(text("Bifa {{ promotionalMaterials }}."))).toBe(true);
  });

  it("is filled with the form's own box, quoted, so the approved text names the box a person ticks", () => {
    // The club named from the one constant (§215), never a second literal in the catalogue.
    expect(promotionalMaterialsClause("ro")).toBe(`„Vreau să primesc oferte și beneficii de la ${CLUB_NAME} și partenerii săi.”`);
    expect(promotionalMaterialsClause("en")).toBe(`“I want to receive offers and benefits from ${CLUB_NAME} and its partners.”`);
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
    // §NNN took «partenerii nu primesc adresa» out: the next paragraph says what a partner may receive.
    expect(ro5).not.toContain("partenerii nu primesc adresa");
    expect(en5).not.toContain("partners never receive your address");
    for (const words of ["6(1)(a)", "opțională", "nu e bifată dinainte", "pagina înscrierii", "<EMAIL DE CONTACT>", "newsletter"]) {
      expect(ro5).toContain(words);
    }
    for (const words of ["6(1)(a)", "optional", "never ticked in advance", "registration's page", "<CONTACT EMAIL>", "Romanian Law no. 506/2004", "newsletter"]) {
      expect(en5).toContain(words);
    }
  });

  it("names the partners in section 6 as the one exception, behind the sharing marker (§NNN), and the retention in section 7", () => {
    const section = (body: typeof privacyNoticeRo, number: string) => body.sections.find((entry) => entry.heading?.startsWith(number))!.paragraphs.join(" ");
    expect(section(privacyNoticeRo, "6.")).toContain("cu o singură excepție: dacă ai bifat ofertele și beneficiile, partenerilor clubului");
    expect(section(privacyNoticeRo, "6.")).toContain("{{promotionalMaterialsShared}}");
    expect(section(privacyNoticeEn, "6.")).toContain("with one exception: if you ticked offers and benefits, we may give the club's partners");
    expect(section(privacyNoticeEn, "6.")).toContain("{{promotionalMaterialsShared}}");
    expect(section(privacyNoticeRo, "7.")).toContain("Acordul pentru oferte și beneficii: până îl retragi");
    expect(section(privacyNoticeEn, "7.")).toContain("The consent to offers and benefits: until you withdraw it");
  });

  it("keeps the twelve sections the code and the guide cite", () => {
    expect(privacyNoticeRo.sections).toHaveLength(12);
    expect(privacyNoticeEn.sections).toHaveLength(12);
  });
});

describe("§562 the form's box", () => {
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
    // The owner's words (2026-09-29 16:12), the club by its name from `CLUB_NAME`.
    expect(ro.Registration.promo.label).toBe("Vreau să primesc oferte și beneficii de la {club} și partenerii săi.");
    expect(en.Registration.promo.label).toBe("I want to receive offers and benefits from {club} and its partners.");
    expect(ro.Registration.promo.help).toBe("Opțional. Poți renunța oricând din pagina înscrierii tale.");
    expect(en.Registration.promo.help).toBe("Optional. You can opt out any time from your registration page.");
    // Two consents, two switches: the words on the person's page say so.
    expect(ro.Registrations.promo.help).toContain("newsletter");
    expect(en.Registrations.promo.help).toContain("newsletter");
  });
});

describe("§562 the same words on every surface, scoped to the registration", () => {
  const values = (node: unknown): string[] =>
    typeof node === "string" ? [node] : node && typeof node === "object" ? Object.values(node).flatMap(values) : [];

  it("no message in either catalogue still says «materiale promoționale» / “promotional materials”", () => {
    expect(values(ro).filter((words) => /materiale promo[țt]ionale/i.test(words))).toEqual([]);
    expect(values(en).filter((words) => /promotional materials?/i.test(words))).toEqual([]);
  });

  it("every surface that names the consent says «oferte și beneficii» / “offers and benefits”", () => {
    const surfaces = (catalogue: typeof ro) => [
      catalogue.Registration.promo.label,
      catalogue.Registrations.promo.title,
      catalogue.Registrations.promo.optIn,
      catalogue.Registrations.promo.optOut,
      catalogue.Admin.registrations.promo.yes,
      catalogue.Admin.registrations.promo.no,
      catalogue.Admin.registrations.withdraw.promo,
      catalogue.Admin.newsletter.promo.title,
      catalogue.Admin.tasks.items.promoNotice.title,
    ];
    for (const words of surfaces(ro)) expect(words.toLowerCase()).toContain("oferte și beneficii");
    for (const words of surfaces(en as unknown as typeof ro)) expect(words.toLowerCase()).toContain("offers and benefits");
  });

  it("the person's page speaks of this registration, never of the person at large (a consent is per registration)", () => {
    expect(ro.Registrations.promo.no).toBe("La această înscriere nu ai bifat oferte și beneficii.");
    expect(en.Registrations.promo.no).toBe("You did not tick offers and benefits on this registration.");
    expect(ro.Registrations.promo.yes.startsWith("La această înscriere primești oferte și beneficii.")).toBe(true);
    expect(en.Registrations.promo.yes.startsWith("On this registration you receive offers and benefits.")).toBe(true);
    expect(ro.Registrations.promo.optIn).toBe("Vreau oferte și beneficii pentru această înscriere");
    expect(ro.Registrations.promo.optOut).toBe("Nu mai vreau oferte și beneficii pentru această înscriere");
    expect(en.Registrations.promo.optIn).toBe("I want offers and benefits for this registration");
    expect(en.Registrations.promo.optOut).toBe("I no longer want offers and benefits for this registration");
    expect(ro.Registrations.promo.changed).toContain("pentru această înscriere");
    expect(en.Registrations.promo.changed).toContain("for this registration");
  });
});

describe("§562 «Înscrierile mele» is a door out only (second fix round)", () => {
  it("draws only «Nu mai vreau», posts only a no, and says where the yes is given", () => {
    const source = readFileSync(path.join(process.cwd(), "src/app/[locale]/registrations/mine/[token]/page.tsx"), "utf8");
    expect(source).not.toContain('t("promo.optIn")');
    expect(source).toContain('t("promo.optOut")');
    expect(source).toContain('name="consent" value="0"');
    expect(source).not.toContain('name="consent" value={');
    expect(source).toContain('t("promo.whereToSayYes")');
  });

  it("the pointer sentence names the registration's own page and the declaration, in both languages", () => {
    expect(ro.Registrations.promo.whereToSayYes).toBe(
      "Acordul pentru oferte și beneficii se dă din pagina înscrierii (linkul din emailul ei) sau din declarație. De aici îl poți doar retrage.",
    );
    expect(en.Registrations.promo.whereToSayYes).toBe(
      "The consent to offers and benefits is given on the registration's own page (the link in its email) or on the declaration. From here you can only withdraw it.",
    );
  });
});

describe("§562 the exports", () => {
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

  it("the registrations CSV ends with «Offers and benefits»: the moment of the yes, or empty", () => {
    const [header, yes, no] = buildRegistrationsCsv([row("2026-09-29T10:00:00.000Z"), row("")]).split("\r\n");
    expect(header.split(",").at(-1)).toBe("Offers and benefits");
    expect(yes.split(",").at(-1)).toBe("2026-09-29T10:00:00.000Z");
    expect(no.split(",").at(-1)).toBe("");
    expect(REGISTRATION_SHEET_HEADERS.at(-1)).toBe("Offers and benefits");
  });

  it("the offers-and-benefits CSV neutralizes formulas, carries a BOM and CRLF — the sponsor list's five columns since §NNN", () => {
    const csv = buildPromoConsentersCsv({ firstName: "Prenume", lastName: "Nume", email: "Email", event: "Eveniment", consentedAt: "Data acordului" }, [
      {
        registrationId: "x",
        eventId: "e",
        name: "=HYPERLINK(1) Pop",
        firstName: "=HYPERLINK(1)",
        lastName: "Pop",
        email: "ana@example.ro",
        eventTitle: "Crosul, toamna",
        consentedAt: new Date("2026-09-29T10:00:00.000Z"),
        privacyNoticeVersion: 1,
      },
    ]);
    expect(csv.startsWith("﻿Prenume,Nume,Email,Eveniment,Data acordului\r\n")).toBe(true);
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

describe("§562 no public page imports the backoffice glyph table (§318)", () => {
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
      // «Înscrierile mele» only withdraws (second fix round): its one button carries the way-out glyph.
      expect(source).toContain(file.includes("/mine/") ? 'from "@mui/icons-material/Unsubscribe"' : 'from "@mui/icons-material/Campaign"');
      expect(source).not.toContain("action-icons");
      expect(source).not.toMatch(/from "@mui\/icons-material"/);
    }
    // And the files exist where the list above says.
    expect(readdirSync(path.join(root, "src/app/[locale]/registrations")).length).toBeGreaterThan(0);
    expect(statSync(path.join(root, files[0])).isFile()).toBe(true);
  });
});
