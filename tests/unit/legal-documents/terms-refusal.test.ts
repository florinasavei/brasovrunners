import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { LegalDocumentBody } from "@/modules/legal-documents/domain/content-hash";
import { LEGAL_TEMPLATES } from "@/modules/legal-documents/templates/catalogue";
import { termsEn, termsRo } from "@/modules/legal-documents/templates/terms";
import en from "../../../messages/en.json";
import ro from "../../../messages/ro.json";

/**
 * BR-REQ-053-01 (§NNN, amending §418) — the terms say the club may refuse or cancel a registration
 * only on the objective grounds they name, that the person is told the ground by email and the place
 * goes to the waiting list by the ordinary rules, that a free event has nothing to refund, and that no
 * registration is refused on a ground the law forbids — in both languages, in §3, which §1 lists among
 * the clauses accepted expressly. The texts in force are untouched: this is the template.
 *
 * BR-REQ-037-03 — the staff cancel's box that makes a cancellation the club's refusal, in both
 * catalogues, saying before the press that the reason goes to the person; only the page's form posts it.
 */
type Locale = "ro" | "en";
const BODY: Record<Locale, LegalDocumentBody> = { ro: termsRo, en: termsEn };

const WORDS = {
  opens: {
    ro: "Clubul poate refuza o înscriere sau o poate anula după ce a fost făcută doar pe un motiv obiectiv:",
    en: "The club may refuse a registration, or cancel one already made, only on an objective ground:",
  },
  grounds: {
    ro: [
      "nu sunt îndeplinite condițiile de participare ale evenimentului (vârsta minimă, declarațiile cerute, declarația că ești apt medical, unde evenimentul o cere)",
      "datele sunt false, incomplete sau ale altei persoane",
      "o impun capacitatea sau siguranța evenimentului (vremea, traseul, numărul de voluntari)",
      "conduita persoanei contravine regulamentului evenimentului ori îi pune pe alții în pericol",
      "înscrierea a fost făcută cu încălcarea acestor termeni",
    ],
    en: [
      "the event's conditions for taking part are not met (the minimum age, the declarations it asks for, the statement that you are medically fit, where the event asks for it)",
      "the details are false, incomplete or somebody else's",
      "the event's capacity or safety requires it (the weather, the course, the number of volunteers)",
      "the person's conduct breaches the event's rules or endangers others",
      "the registration was made in breach of these terms",
    ],
  },
  told: {
    ro: "Îți spunem motivul pe e-mail",
    en: "We tell you the ground by email",
  },
  released: {
    ro: "locul eliberat trece la lista de așteptare, după regulile obișnuite.",
    en: "the place released goes to the waiting list by the ordinary rules.",
  },
  free: {
    ro: "La un eveniment gratuit nu este nimic de restituit;",
    en: "At a free event there is nothing to refund;",
  },
  lawful: {
    ro: "Clubul nu refuză și nu anulează o înscriere pe niciun criteriu interzis de lege.",
    en: "The club refuses or cancels no registration on any ground the law forbids.",
  },
  express: {
    ro: "Clauzele din secțiunile 3 (anularea înscrierii sau a evenimentului ori modificarea evenimentului),",
    en: "You accept the clauses in sections 3 (cancelling a registration or an event, or changing an event),",
  },
} as const;

const refusalParagraph = (locale: Locale) => {
  const cancelling = BODY[locale].sections[2];
  const found = cancelling.paragraphs.filter((paragraph) => paragraph.startsWith(WORDS.opens[locale]));
  expect(found).toHaveLength(1);
  return found[0];
};

describe("§NNN — the terms' template says the club may refuse or cancel a registration, on objective grounds only", () => {
  it.each(["ro", "en"] as const)("%s: one paragraph in §3 names every ground, the email, the queue, the refund and the law", (locale) => {
    expect(BODY[locale].sections[2].heading).toBe(locale === "ro" ? "3. Anularea" : "3. Cancelling");
    const paragraph = refusalParagraph(locale);
    for (const ground of WORDS.grounds[locale]) expect(paragraph).toContain(ground);
    expect(paragraph).toContain(WORDS.told[locale]);
    expect(paragraph).toContain(WORDS.released[locale]);
    expect(paragraph).toContain(WORDS.free[locale]);
    expect(paragraph.endsWith(WORDS.lawful[locale])).toBe(true);
    // Plain and short: no article number, no club fact, no merge field in it.
    expect(paragraph).not.toMatch(/articol|article|<[A-ZĂÂÎȘȚ]|\{\{/);
    expect(paragraph.length).toBeLessThan(1100);
  });

  it("both languages carry it, and nothing else in the terms moved: ten sections, the same headings", () => {
    expect(termsRo.sections.map((section) => section.paragraphs.length)).toEqual(termsEn.sections.map((section) => section.paragraphs.length));
    expect(termsRo.sections).toHaveLength(10);
    expect(termsRo.sections[2].paragraphs).toHaveLength(3);
    expect(LEGAL_TEMPLATES.TERMS.ro.body).toBe(termsRo);
    expect(LEGAL_TEMPLATES.TERMS.en.body).toBe(termsEn);
  });

  it("§1 lists cancelling a registration among the clauses accepted expressly (art. 1203)", () => {
    expect(termsRo.sections[0].paragraphs[2].startsWith(WORDS.express.ro)).toBe(true);
    expect(termsEn.sections[0].paragraphs[2].startsWith(WORDS.express.en)).toBe(true);
  });

  it("never reserves a right to refuse without a reason", () => {
    const all = [termsRo, termsEn].flatMap((body) => body.sections.flatMap((section) => section.paragraphs)).join(" ");
    expect(all).not.toMatch(/ne rezervăm dreptul|we reserve the right/i);
    expect(all).not.toMatch(/refuza[^.]*fără motiv|refuse[^.]*without (a |any )?reason/i);
  });
});

describe("§NNN — the staff cancel's refusal box says the reason goes to the person", () => {
  it("is in both catalogues, and says it before the press", () => {
    expect(ro.Admin.registrations.refusedByOrganizer).toContain("îi este trimis persoanei pe e-mail");
    expect(en.Admin.registrations.refusedByOrganizer).toContain("is emailed to the person");
    expect(ro.Admin.registrations.refusedByOrganizerHelp).toContain("Niciodată pe un criteriu interzis de lege.");
    expect(en.Admin.registrations.refusedByOrganizerHelp).toContain("Never on a ground the law forbids.");
  });

  it("only the registration's own page posts it, and the action reads it on the server", () => {
    const page = readFileSync("src/app/[locale]/admin/registrations/[id]/page.tsx", "utf8");
    const list = readFileSync("src/app/[locale]/admin/registrations/(list)/page.tsx", "utf8");
    const actions = readFileSync("src/app/[locale]/admin/registrations/actions.ts", "utf8");
    expect(page).toContain('<CheckboxField name="refusedByOrganizer" help={tr("registrations.refusedByOrganizerHelp")}>');
    expect(list).not.toContain("refusedByOrganizer");
    expect(actions).toContain('form.get("refusedByOrganizer") === "on"');
    expect(actions).toContain('{ kind: "REFUSED_BY_ORGANIZER" }');
  });
});
