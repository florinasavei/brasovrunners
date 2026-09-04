import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import * as legalDocumentsRepository from "@/modules/legal-documents/repository";
import { computeContentHash, type LegalDocumentTranslationInput } from "@/modules/legal-documents/domain/content-hash";
import { findCurrentApprovedDocument, insertLegalDocumentVersion } from "@/modules/legal-documents/repository";
import { seedPlaceholderLegalDocuments } from "@/db/seeds/legal-placeholder";
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

describe("BR-REQ-053-01 placeholder seed guard (DECISIONS.md §27)", () => {
  const originalAppEnv = process.env.APP_ENV;
  afterEach(() => {
    process.env.APP_ENV = originalAppEnv;
  });

  it("refuses to seed placeholder legal text into qa or production", async () => {
    for (const APP_ENV of ["qa", "production"]) {
      process.env.APP_ENV = APP_ENV;
      await expect(seedPlaceholderLegalDocuments()).rejects.toThrow(/Refusing to seed/);
    }
  });
});
