import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { computeContentHash, type LegalDocumentBody } from "@/modules/legal-documents/domain/content-hash";
import { insertLegalDocumentVersion, termsDescribeRefusal } from "@/modules/legal-documents/repository";
import { termsEn, termsRo } from "@/modules/legal-documents/templates/terms";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";

/**
 * §NNN (on §618) — the terms in force switch the form's express box and the fold's step on: only an
 * approved version in force, and in every language. The backoffice's reading (`termsDescribeRefusal`,
 * for `/admin/tasks` and `/admin/legal`) and the public cache's (`cachedRefusalDisclosed`, for the
 * register page and the event page) answer the same, on this test's PGlite database.
 */
let db: TestDatabase;
let close: () => Promise<void>;

vi.mock("@/db/client", () => ({ getDb: () => db }));

const { cachedRefusalDisclosed } = await import("@/modules/public-cache/reads");

const NOW = new Date("2026-10-02T08:00:00.000Z");

/** Terms approved before §618: the narrow refusals of §4 and §8, no grounds paragraph. */
const OLDER_TERMS = {
  ro: { sections: [{ heading: "3. Anularea", paragraphs: ["Îți poți anula înscrierea oricând înainte de start, din legătura primită pe e-mail; locul trece la lista de așteptare."] }] },
  en: { sections: [{ heading: "3. Cancelling", paragraphs: ["You may cancel at any time before the start, from the link in your email; the place goes to the waiting list."] }] },
};

async function insertTerms(bodies: { ro: LegalDocumentBody; en: LegalDocumentBody }, version: number, isApproved = true) {
  const translations = [
    { locale: "ro" as const, title: "Termeni și condiții", body: bodies.ro },
    { locale: "en" as const, title: "Terms and conditions", body: bodies.en },
  ];
  await insertLegalDocumentVersion(db, {
    key: "TERMS",
    version,
    effectiveAt: new Date(NOW.getTime() - 60_000),
    isApproved,
    contentSha256: computeContentHash(translations),
    translations,
    now: NOW,
  });
}

const both = async () => [await termsDescribeRefusal(db, NOW), await cachedRefusalDisclosed(NOW)];

beforeAll(async () => {
  ({ db, close } = await createTestDatabase());
});
afterAll(async () => close());
beforeEach(async () => {
  await resetTables(db);
});

describe("§NNN the terms in force carry the club's right to refuse", () => {
  it("is off with no terms, off with older ones, on with the platform's template, off again if the next version drops it", async () => {
    expect(await both()).toEqual([false, false]);
    await insertTerms(OLDER_TERMS, 1);
    expect(await both()).toEqual([false, false]);
    await insertTerms({ ro: termsRo, en: termsEn }, 2);
    expect(await both()).toEqual([true, true]);
    await insertTerms(OLDER_TERMS, 3);
    expect(await both()).toEqual([false, false]);
  });

  it("ignores a draft that names it: only the text in force says it", async () => {
    await insertTerms(OLDER_TERMS, 1);
    await insertTerms({ ro: termsRo, en: termsEn }, 2, false);
    expect(await both()).toEqual([false, false]);
  });

  it("needs every language: Romanian terms carrying it beside English ones that do not are not enough", async () => {
    await insertTerms({ ro: termsRo, en: OLDER_TERMS.en }, 1);
    expect(await both()).toEqual([false, false]);
  });
});
