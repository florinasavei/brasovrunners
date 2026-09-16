import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import * as legalDocumentsRepository from "@/modules/legal-documents/repository";
import { computeContentHash, type LegalDocumentTranslationInput } from "@/modules/legal-documents/domain/content-hash";
import { findCurrentApprovedDocument, insertLegalDocumentVersion } from "@/modules/legal-documents/repository";
import {
  assertSampleLegalDocumentsAllowed,
  SAMPLE_DOCUMENTS,
} from "@/db/seeds/sample-legal-documents";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";

/**
 * BR-REQ-053-01 — legal documents are versioned and immutable.
 */
const translations = (suffix: string): LegalDocumentTranslationInput[] => [
  { locale: "ro", title: `Titlu ${suffix}`, body: { sections: [{ paragraphs: [`RO ${suffix}`] }] } },
  { locale: "en", title: `Title ${suffix}`, body: { sections: [{ paragraphs: [`EN ${suffix}`] }] } },
];

describe("BR-REQ-053-01 legal document versions", () => {
  let db: TestDatabase;
  let close: () => Promise<void>;

  beforeAll(async () => {
    ({ db, close } = await createTestDatabase());
  });
  afterAll(async () => close());

  beforeEach(async () => {
    await resetTables(db);
  });

  it("resolves the current version as the highest approved one whose effective date has passed", async () => {
    const v1 = translations("v1");
    const v2 = translations("v2");
    await insertLegalDocumentVersion(db, {
      key: "PRIVACY_NOTICE",
      version: 1,
      effectiveAt: new Date("2026-01-01T00:00:00.000Z"),
      isApproved: true,
      contentSha256: computeContentHash(v1),
      translations: v1,
      now: new Date("2026-01-01T00:00:00.000Z"),
    });
    await insertLegalDocumentVersion(db, {
      key: "PRIVACY_NOTICE",
      version: 2,
      effectiveAt: new Date("2026-06-01T00:00:00.000Z"),
      isApproved: true,
      contentSha256: computeContentHash(v2),
      translations: v2,
      now: new Date("2026-01-15T00:00:00.000Z"),
    });

    const beforeV2 = await findCurrentApprovedDocument(
      db,
      "PRIVACY_NOTICE",
      "ro",
      new Date("2026-03-01T00:00:00.000Z"),
    );
    expect(beforeV2?.version).toBe(1);

    const afterV2 = await findCurrentApprovedDocument(
      db,
      "PRIVACY_NOTICE",
      "ro",
      new Date("2026-07-01T00:00:00.000Z"),
    );
    expect(afterV2?.version).toBe(2);
  });

  it("ignores an unapproved version even if it is the highest", async () => {
    const approved = translations("approved");
    const draft = translations("draft");
    await insertLegalDocumentVersion(db, {
      key: "TERMS",
      version: 1,
      effectiveAt: new Date("2026-01-01T00:00:00.000Z"),
      isApproved: true,
      contentSha256: computeContentHash(approved),
      translations: approved,
      now: new Date("2026-01-01T00:00:00.000Z"),
    });
    await insertLegalDocumentVersion(db, {
      key: "TERMS",
      version: 2,
      effectiveAt: new Date("2026-01-01T00:00:00.000Z"),
      isApproved: false,
      contentSha256: computeContentHash(draft),
      translations: draft,
      now: new Date("2026-01-01T00:00:00.000Z"),
    });

    const current = await findCurrentApprovedDocument(db, "TERMS", "ro", new Date("2026-02-01T00:00:00.000Z"));
    expect(current?.version).toBe(1);
  });

  it("returns nothing when no version has been approved yet", async () => {
    const current = await findCurrentApprovedDocument(db, "EVENT_DECLARATION", "ro", new Date());
    expect(current).toBeUndefined();
  });

  it("resolves each locale to its own title and body from the same version", async () => {
    const both = translations("shared");
    await insertLegalDocumentVersion(db, {
      key: "TERMS",
      version: 1,
      effectiveAt: new Date("2026-01-01T00:00:00.000Z"),
      isApproved: true,
      contentSha256: computeContentHash(both),
      translations: both,
      now: new Date("2026-01-01T00:00:00.000Z"),
    });

    const ro = await findCurrentApprovedDocument(db, "TERMS", "ro", new Date("2026-02-01T00:00:00.000Z"));
    const en = await findCurrentApprovedDocument(db, "TERMS", "en", new Date("2026-02-01T00:00:00.000Z"));

    expect(ro?.title).toBe("Titlu shared");
    expect(en?.title).toBe("Title shared");
    // Same version, same hash, regardless of locale — the hash covers both translations.
    expect(ro?.contentSha256).toBe(en?.contentSha256);
  });

  it("has no function that updates an existing version — a new version is the only way to change content", () => {
    // AGENTS.md §12.5: "a version referenced by an acceptance is immutable." Structural, not
    // reviewed: there is no exported function in this module that could perform an UPDATE.
    const exportNames = Object.keys(legalDocumentsRepository);
    for (const name of exportNames) {
      expect(name.toLowerCase()).not.toMatch(/update|edit/);
    }
  });
});

/**
 * BR-REQ-053-01 — the sample documents, and the one environment that refuses them.
 *
 * `DECISIONS.md` §29 supersedes §27: sample text is permitted everywhere a real participant's
 * browser cannot reach, which now includes qa, and production is refused hard. The refusal gets
 * its own test because it is the whole of the difference between the two.
 */
describe("BR-REQ-053-01 sample legal documents (DECISIONS.md §29)", () => {
  const originalAppEnv = process.env.APP_ENV;
  afterEach(() => {
    process.env.APP_ENV = originalAppEnv;
  });

  it("refuses production outright", () => {
    process.env.APP_ENV = "production";
    expect(() => assertSampleLegalDocumentsAllowed()).toThrow(/Refusing to seed/);
  });

  it.each(["local", "test", "qa"])("permits %s, where no real participant registers", (APP_ENV) => {
    process.env.APP_ENV = APP_ENV;
    expect(() => assertSampleLegalDocumentsAllowed()).not.toThrow();
  });

  it("covers all three keys in both languages", () => {
    expect(SAMPLE_DOCUMENTS.map((document) => document.key).sort()).toEqual([
      "EVENT_DECLARATION",
      "PRIVACY_NOTICE",
      "TERMS",
    ]);
    for (const document of SAMPLE_DOCUMENTS) {
      expect(document.translations.map((t) => t.locale).sort(), document.key).toEqual(["en", "ro"]);
    }
  });

  /**
   * The banner is the point of the whole exercise: it has to be in the rendered body, in both
   * languages, so that whoever opens the public page sees it. A code comment or a column
   * nobody renders would not be seen by the person who most needs to.
   */
  it("opens every document, in both languages, with a visible not-approved banner", () => {
    for (const document of SAMPLE_DOCUMENTS) {
      for (const translation of document.translations) {
        const [first] = translation.body.sections;
        const text = [first.heading ?? "", ...first.paragraphs].join(" ");
        expect(text, `${document.key} ${translation.locale}`).toMatch(
          translation.locale === "ro" ? /TEXT DE EXEMPLU/ : /SAMPLE TEXT/,
        );
        expect(text, `${document.key} ${translation.locale} says it is not approved`).toMatch(
          translation.locale === "ro" ? /NU a fost aprobat/ : /NOT been approved/,
        );
        expect(translation.title, `${document.key} ${translation.locale} title`).toMatch(
          /EXEMPLU|SAMPLE/,
        );
      }
    }
  });

  /** Club-specific facts are visible gaps, never plausible inventions (AGENTS.md §1.2). */
  it("leaves every club-specific fact as an angle-bracket placeholder", () => {
    for (const document of SAMPLE_DOCUMENTS) {
      for (const translation of document.translations) {
        const body = translation.body.sections
          .flatMap((section) => [section.heading ?? "", ...section.paragraphs])
          .join(" ");
        expect(body, `${document.key} ${translation.locale}`).toMatch(/<[A-ZĂÂÎȘȚ][^>]*>/);
        // The named reviewer the drafts are waiting on.
        if (translation.locale === "en") expect(body).toMatch(/<REVIEWER NAME>/);
        else expect(body).toMatch(/<NUME RECENZENT>/);
      }
    }
  });
});
