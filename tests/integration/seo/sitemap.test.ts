import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eventTranslations, events } from "@/db/schema/events";
import { galleryAlbums, galleryAlbumTranslations } from "@/db/schema/gallery";
import { pages, pageTranslations } from "@/db/schema/pages";
import { computeContentHash, type LegalDocumentTranslationInput } from "@/modules/legal-documents/domain/content-hash";
import { insertLegalDocumentVersion } from "@/modules/legal-documents/repository";
import { env } from "@/shared/config/env";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";

/**
 * BR-REQ-070-02 criterion 2 — the sitemap carries only published public content, each with the
 * `hreflang` alternates its own page declares (`modules/seo/alternates.ts`), and never an
 * address that redirects or a locale nothing was published in.
 *
 * Every expected address is built from `env.APP_BASE_URL` rather than a literal, the same rule
 * `AGENTS.md` §8 holds the application to — a hardcoded host here would just as easily hide a
 * `sitemap.ts` that had started building one of its own.
 */

const BASE = env.APP_BASE_URL;
const NOW = new Date("2026-09-24T10:00:00.000Z");

let db: TestDatabase;
let close: () => Promise<void>;

vi.mock("@/db/client", () => ({ getDb: () => db }));

const { default: sitemap } = await import("@/app/sitemap");

beforeAll(async () => {
  ({ db, close } = await createTestDatabase());
});
afterAll(async () => close());

beforeEach(async () => {
  await resetTables(db);
});

/** Every URL a sitemap run produced, whichever section it came from. */
function urlsOf(entries: Awaited<ReturnType<typeof sitemap>>): string[] {
  return entries.map((entry) => entry.url);
}

describe("BR-REQ-070-02 criterion 2 — the sitemap", () => {
  it("lists a published event once per locale, each with the other locale's own slug as its alternate", async () => {
    const [event] = await db
      .insert(events)
      .values({ type: "GROUP_RUN", startsAt: new Date("2027-05-01T06:00:00.000Z"), editorialStatus: "PUBLISHED", publishedAt: NOW })
      .returning();
    await db.insert(eventTranslations).values([
      { eventId: event.id, locale: "ro", slug: "tura-pe-tampa", title: "Tură pe Tâmpa" },
      { eventId: event.id, locale: "en", slug: "tampa-trail", title: "Tâmpa trail run" },
    ]);

    const entries = await sitemap();
    const ro = entries.find((e) => e.url === `${BASE}/ro/evenimente/tura-pe-tampa`);
    const en = entries.find((e) => e.url === `${BASE}/en/events/tampa-trail`);
    expect(ro).toBeDefined();
    expect(en).toBeDefined();
    expect(ro?.lastModified).toEqual(NOW);
    // Neither entry carries a query string — the type filter and the `view` param are not this.
    expect(ro?.url).not.toContain("?");
    expect(ro?.alternates?.languages).toEqual({
      ro: `${BASE}/ro/evenimente/tura-pe-tampa`,
      en: `${BASE}/en/events/tampa-trail`,
      "x-default": `${BASE}/ro/evenimente/tura-pe-tampa`,
    });
    expect(en?.alternates?.languages).toEqual(ro?.alternates?.languages);
  });

  it("omits the alternate for a locale the event has no translation in — never advertise a 404", async () => {
    const [event] = await db
      .insert(events)
      .values({ type: "GROUP_RUN", startsAt: new Date("2027-05-01T06:00:00.000Z"), editorialStatus: "PUBLISHED", publishedAt: NOW })
      .returning();
    // Romanian only: a partial translation the editor never let through publication, reached
    // here directly to prove the sitemap itself refuses to invent the missing side.
    await db.insert(eventTranslations).values([{ eventId: event.id, locale: "ro", slug: "doar-romana", title: "Doar română" }]);

    const entries = await sitemap();
    expect(urlsOf(entries)).toContain(`${BASE}/ro/evenimente/doar-romana`);
    expect(urlsOf(entries)).not.toContain(`${BASE}/en/events/doar-romana`);
    const ro = entries.find((e) => e.url === `${BASE}/ro/evenimente/doar-romana`);
    expect(ro?.alternates?.languages?.en).toBeUndefined();
    expect(ro?.alternates?.languages?.["x-default"]).toBe(`${BASE}/ro/evenimente/doar-romana`);
  });

  it("never lists a draft event, the site root, or an unprefixed path", async () => {
    await db.insert(events).values({ type: "GROUP_RUN", startsAt: new Date("2027-05-01T06:00:00.000Z"), editorialStatus: "DRAFT" });

    const entries = await sitemap();
    for (const url of urlsOf(entries)) {
      const { pathname } = new URL(url);
      expect(pathname).not.toBe("/");
      expect(pathname === "/ro" || pathname === "/en").toBe(false);
      expect(pathname.startsWith("/ro/") || pathname.startsWith("/en/")).toBe(true);
    }
  });

  it("lists a published standing page with its own slug per locale", async () => {
    const [page] = await db.insert(pages).values({ editorialStatus: "PUBLISHED", publishedAt: NOW }).returning();
    await db.insert(pageTranslations).values([
      { pageId: page.id, locale: "ro", slug: "despre-noi", title: "Despre noi" },
      { pageId: page.id, locale: "en", slug: "about-us", title: "About us" },
    ]);

    const entries = await sitemap();
    const ro = entries.find((e) => e.url === `${BASE}/ro/pagini/despre-noi`);
    expect(ro).toBeDefined();
    expect(ro?.alternates?.languages?.en).toBe(`${BASE}/en/pages/about-us`);
  });

  it("lists a published album, keyed to the album's own updated time, not the shoot's date", async () => {
    const [album] = await db
      .insert(galleryAlbums)
      .values({ editorialStatus: "PUBLISHED", publishedAt: NOW, takenOn: new Date("2026-08-01T00:00:00.000Z") })
      .returning();
    await db.insert(galleryAlbumTranslations).values([
      { albumId: album.id, locale: "ro", slug: "crosul-2026", title: "Crosul 2026" },
      { albumId: album.id, locale: "en", slug: "cross-2026", title: "Cross 2026" },
    ]);

    const entries = await sitemap();
    const ro = entries.find((e) => e.url === `${BASE}/ro/galerie/crosul-2026`);
    // The gallery listing is only worth listing where there is something on it (as events are).
    expect(urlsOf(entries)).toContain(`${BASE}/ro/galerie`);
    expect(ro?.lastModified).toEqual(album.updatedAt);
  });

  it("lists a legal text only once the club approved a version, never a not-approved placeholder", async () => {
    const body = { sections: [{ paragraphs: ["p"] }] };
    const ro: LegalDocumentTranslationInput = { locale: "ro", title: "Termeni", body };
    await insertLegalDocumentVersion(db, {
      key: "TERMS",
      version: 1,
      effectiveAt: new Date("2026-01-01T00:00:00.000Z"),
      isApproved: true,
      contentSha256: computeContentHash([ro]),
      translations: [ro],
      now: NOW,
    });

    const entries = await sitemap();
    // Romanian only: no English version was ever approved, so no English entry and no `en`
    // alternate — the same rule `legal-documents/public-page.ts` uses for the page's `noindex`.
    expect(urlsOf(entries)).toContain(`${BASE}/ro/termeni`);
    expect(urlsOf(entries)).not.toContain(`${BASE}/en/terms`);
    const entry = entries.find((e) => e.url === `${BASE}/ro/termeni`);
    expect(entry?.alternates?.languages?.en).toBeUndefined();
    // The privacy notice was never approved at all here, so it carries no entry either.
    expect(urlsOf(entries).some((url) => url.includes("confidentialitate") || url.includes("privacy"))).toBe(false);
  });
});
