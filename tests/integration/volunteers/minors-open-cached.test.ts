import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { computeContentHash, type LegalDocumentTranslationInput } from "@/modules/legal-documents/domain/content-hash";
import { insertLegalDocumentVersion, volunteerMinorsOpen } from "@/modules/legal-documents/repository";
import { LEGAL_TEMPLATES } from "@/modules/legal-documents/templates/catalogue";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";

/**
 * §NNN — the volunteers' own page reads whether the club may take a minor through the public cache
 * (`cachedVolunteerMinorsOpen`), and the sign-up asks the database (`volunteerMinorsOpen`). The two are one rule written
 * twice, so this pins that they agree in the four states a club passes through: both texts describe minors, the notice
 * alone, the agreement alone, and one language missing — a page that says «sub 18 ani» must never lead to a refusal.
 */
let db: TestDatabase;
let close: () => Promise<void>;
vi.mock("@/db/client", () => ({ getDb: () => db }));
vi.mock("next/cache", async () => (await import("../../helpers/next-cache")).fakeNextCache.module);
vi.mock("@/modules/diagnostics/budget-level", () => ({ peekNeonBudgetLevel: () => "unknown", lastKnownBudget: () => null }));
const request = vi.hoisted(() => ({ reads: new Map<string, Promise<unknown>>() }));
vi.mock("@/modules/public-cache/request-memo", () => ({ thisRequestsReads: () => request.reads }));

const { fakeNextCache } = await import("../../helpers/next-cache");
const reads = await import("@/modules/public-cache/reads");

const NOW = new Date("2026-10-14T10:00:00.000Z");
const EFFECTIVE = new Date("2026-01-01T00:00:00.000Z");

describe("§NNN the cached twin of «may the club take a minor» agrees with the database's", () => {
  beforeAll(async () => {
    ({ db, close } = await createTestDatabase());
  });
  afterAll(async () => close());
  beforeEach(async () => {
    await resetTables(db);
    fakeNextCache.reset();
    request.reads.clear();
  });

  /** The privacy notice in force in the given languages, naming the minors or not. */
  async function notice(minors: boolean, locales: readonly ("ro" | "en")[] = ["ro", "en"]) {
    const marker = `{{volunteers}}, {{volunteerProfile}}${minors ? ", {{volunteerMinors}}" : ""}`;
    const translations: LegalDocumentTranslationInput[] = locales.map((locale) => ({
      locale,
      title: "Privacy",
      body: { sections: [{ paragraphs: [`Volunteers (${marker}): we keep the name`] }] },
    }));
    await insertLegalDocumentVersion(db, { key: "PRIVACY_NOTICE", version: 1, effectiveAt: EFFECTIVE, isApproved: true, contentSha256: computeContentHash(translations), translations, now: NOW });
  }

  /** The volunteer agreement in force: the platform's template, with or without the guardian's clause, in the given languages. */
  async function agreement(minors: boolean, locales: readonly ("ro" | "en")[] = ["ro", "en"]) {
    const translations: LegalDocumentTranslationInput[] = locales.map((locale) => {
      const template = LEGAL_TEMPLATES.VOLUNTEER_AGREEMENT[locale];
      const sections = template.body.sections.map((section) => ({
        ...section,
        paragraphs: minors ? section.paragraphs : section.paragraphs.filter((paragraph) => !paragraph.includes("{{volunteerGuardian}}")),
      }));
      return { locale, ...template, body: { ...template.body, sections } };
    });
    await insertLegalDocumentVersion(db, { key: "VOLUNTEER_AGREEMENT", version: 1, effectiveAt: EFFECTIVE, isApproved: true, contentSha256: computeContentHash(translations), translations, now: NOW });
  }

  const cases: { name: string; setup: () => Promise<void>; open: boolean }[] = [
    {
      name: "both texts describe minors",
      setup: async () => {
        await notice(true);
        await agreement(true);
      },
      open: true,
    },
    {
      name: "the notice alone does",
      setup: async () => {
        await notice(true);
        await agreement(false);
      },
      open: false,
    },
    {
      name: "the agreement alone does",
      setup: async () => {
        await notice(false);
        await agreement(true);
      },
      open: false,
    },
    {
      name: "both do, but the agreement is in one language only",
      setup: async () => {
        await notice(true);
        await agreement(true, ["ro"]);
      },
      open: false,
    },
  ];

  for (const { name, setup, open } of cases) {
    it(`${name}: the cached read and the database's say ${open ? "open" : "closed"}`, async () => {
      await setup();
      expect(await volunteerMinorsOpen(db, NOW)).toBe(open);
      expect(await reads.cachedVolunteerMinorsOpen(NOW)).toBe(open);
    });
  }
});
