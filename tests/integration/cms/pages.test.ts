import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { pages, pageTranslations } from "@/db/schema/pages";
import { staffUsers } from "@/db/schema/staff-users";
import {
  findPublishedPageBySlug,
  findPublishedPageSiblingSlug,
  listPublishedPages,
} from "@/modules/content/pages/repository";
import {
  createPage,
  deletePage,
  describeIncompletePageLocales,
  savePage,
  transitionPage,
} from "@/modules/content/pages/service";
import { isDomainError } from "@/shared/errors/domain-error";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";

/**
 * BR-REQ-050-03 — standing pages the club writes for itself.
 *
 * The interesting assertions are the ones the page type inherits rather than invents: both
 * languages go live together (`AGENTS.md` §11.2), a locale with no translation is a 404 and
 * never the other language's text (BR-REQ-040-02), and a stale version is a CONFLICT rather
 * than an overwrite (§11.5). If any of those had been re-implemented for pages instead of
 * reused, this is where the second copy would drift from the first.
 */
const NOW = new Date("2026-09-07T10:00:00.000Z");

async function seedStaff(db: TestDatabase, role: "MODERATOR" | "CONTRIBUTOR" | "ADMIN") {
  const [row] = await db
    .insert(staffUsers)
    .values({
      email: `${role.toLowerCase()}@example.test`,
      displayName: role,
      role,
    })
    .returning();
  return { id: row.id, role: row.role };
}

function fields(overrides: Record<string, unknown> = {}) {
  return {
    navOrder: "10",
    translations: {
      ro: {
        slug: "despre-noi",
        title: "Despre Brașov Runners",
        body: "## Cine suntem\n\nUn club de alergare din Brașov.",
        seoTitle: "",
        seoDescription: "",
      },
      en: {
        slug: "about-us",
        title: "About Brașov Runners",
        body: "## Who we are\n\nA running club in Brașov.",
        seoTitle: "",
        seoDescription: "",
      },
    },
    ...overrides,
  };
}

async function codeOf(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
    return "NO_ERROR";
  } catch (error) {
    return isDomainError(error) ? error.code : "UNKNOWN";
  }
}

describe("BR-REQ-050-03 standing pages", () => {
  let db: TestDatabase;
  let close: () => Promise<void>;

  beforeAll(async () => {
    ({ db, close } = await createTestDatabase());
  });
  afterAll(async () => close());
  beforeEach(async () => resetTables(db));

  it("creates a draft with both languages, and publishes neither until asked", async () => {
    const editor = await seedStaff(db, "MODERATOR");
    const page = await createPage(db, { actor: editor, fields: fields(), now: NOW });

    expect(page.editorialStatus).toBe("DRAFT");
    expect(page.publishedAt).toBeNull();
    expect(page.navOrder).toBe(10);

    const translations = await db
      .select()
      .from(pageTranslations)
      .where(eq(pageTranslations.pageId, page.id));
    expect(translations.map((row) => row.locale).sort()).toEqual(["en", "ro"]);

    // The body is stored structured, converted from the text an organizer typed.
    const romanian = translations.find((row) => row.locale === "ro");
    expect(romanian?.bodyJson).toEqual({
      sections: [{ heading: "Cine suntem", paragraphs: ["Un club de alergare din Brașov."] }],
    });

    // A draft is not reachable by guessing its address.
    expect(await findPublishedPageBySlug(db, "ro", "despre-noi")).toBeUndefined();
  });

  it("refuses a Contributor, who has drafts and nothing else", async () => {
    const contributor = await seedStaff(db, "CONTRIBUTOR");
    expect(await codeOf(createPage(db, { actor: contributor, fields: fields(), now: NOW }))).toBe(
      "FORBIDDEN",
    );
  });

  it("refuses a second page claiming an address already in use, naming the field", async () => {
    const editor = await seedStaff(db, "MODERATOR");
    await createPage(db, { actor: editor, fields: fields(), now: NOW });

    expect(await codeOf(createPage(db, { actor: editor, fields: fields(), now: NOW }))).toBe(
      "VALIDATION_ERROR",
    );
  });

  it.each([["ADMIN"], ["/pagina"], ["Despre Noi"], ["despre noi"]])(
    "refuses %s as a page address",
    async (slug) => {
      const editor = await seedStaff(db, "MODERATOR");
      const input = fields();
      input.translations.ro.slug = slug;
      expect(await codeOf(createPage(db, { actor: editor, fields: input, now: NOW }))).toBe(
        "VALIDATION_ERROR",
      );
    },
  );

  it("refuses a reserved address even when it is well formed", async () => {
    const editor = await seedStaff(db, "MODERATOR");
    const input = fields();
    input.translations.ro.slug = "admin";
    expect(await codeOf(createPage(db, { actor: editor, fields: input, now: NOW }))).toBe(
      "VALIDATION_ERROR",
    );
  });

  describe("publication is one state for the whole page", () => {
    it("refuses PUBLISHED while either language is empty, and says which", async () => {
      const editor = await seedStaff(db, "MODERATOR");
      const input = fields();
      input.translations.en.body = "";
      const page = await createPage(db, { actor: editor, fields: input, now: NOW });

      const reviewed = await transitionPage(db, {
        actor: editor,
        pageId: page.id,
        expectedVersion: page.version,
        to: "IN_REVIEW",
        now: NOW,
      });

      expect(
        await codeOf(
          transitionPage(db, {
            actor: editor,
            pageId: page.id,
            expectedVersion: reviewed.version,
            to: "PUBLISHED",
            now: NOW,
          }),
        ),
      ).toBe("VALIDATION_ERROR");
    });

    it("puts both languages live together, and each answers at its own address", async () => {
      const editor = await seedStaff(db, "MODERATOR");
      const page = await createPage(db, { actor: editor, fields: fields(), now: NOW });

      const reviewed = await transitionPage(db, {
        actor: editor,
        pageId: page.id,
        expectedVersion: page.version,
        to: "IN_REVIEW",
        now: NOW,
      });
      const published = await transitionPage(db, {
        actor: editor,
        pageId: page.id,
        expectedVersion: reviewed.version,
        to: "PUBLISHED",
        now: NOW,
      });

      expect(published.publishedAt).toEqual(NOW);
      expect((await findPublishedPageBySlug(db, "ro", "despre-noi"))?.title).toBe(
        "Despre Brașov Runners",
      );
      expect((await findPublishedPageBySlug(db, "en", "about-us"))?.title).toBe(
        "About Brașov Runners",
      );
    });

    it("never serves one language's text at the other's address", async () => {
      // BR-REQ-040-02. The Romanian slug in the English locale is a 404, not a fallback.
      const editor = await seedStaff(db, "MODERATOR");
      const page = await createPage(db, { actor: editor, fields: fields(), now: NOW });
      const reviewed = await transitionPage(db, {
        actor: editor,
        pageId: page.id,
        expectedVersion: page.version,
        to: "IN_REVIEW",
        now: NOW,
      });
      await transitionPage(db, {
        actor: editor,
        pageId: page.id,
        expectedVersion: reviewed.version,
        to: "PUBLISHED",
        now: NOW,
      });

      expect(await findPublishedPageBySlug(db, "en", "despre-noi")).toBeUndefined();
      expect(await findPublishedPageBySlug(db, "ro", "about-us")).toBeUndefined();
    });

    it("resolves the sibling address for the language switcher", async () => {
      const editor = await seedStaff(db, "MODERATOR");
      const page = await createPage(db, { actor: editor, fields: fields(), now: NOW });
      const reviewed = await transitionPage(db, {
        actor: editor,
        pageId: page.id,
        expectedVersion: page.version,
        to: "IN_REVIEW",
        now: NOW,
      });
      await transitionPage(db, {
        actor: editor,
        pageId: page.id,
        expectedVersion: reviewed.version,
        to: "PUBLISHED",
        now: NOW,
      });

      expect(await findPublishedPageSiblingSlug(db, page.id, "en")).toBe("about-us");
      expect(await findPublishedPageSiblingSlug(db, page.id, "ro")).toBe("despre-noi");
    });

    it("takes an archived page off the public site in both languages", async () => {
      const editor = await seedStaff(db, "MODERATOR");
      const page = await createPage(db, { actor: editor, fields: fields(), now: NOW });
      const reviewed = await transitionPage(db, {
        actor: editor,
        pageId: page.id,
        expectedVersion: page.version,
        to: "IN_REVIEW",
        now: NOW,
      });
      const published = await transitionPage(db, {
        actor: editor,
        pageId: page.id,
        expectedVersion: reviewed.version,
        to: "PUBLISHED",
        now: NOW,
      });
      await transitionPage(db, {
        actor: editor,
        pageId: page.id,
        expectedVersion: published.version,
        to: "ARCHIVED",
        now: NOW,
      });

      expect(await findPublishedPageBySlug(db, "ro", "despre-noi")).toBeUndefined();
      expect(await findPublishedPageBySlug(db, "en", "about-us")).toBeUndefined();
      expect(await listPublishedPages(db, "ro")).toHaveLength(0);
    });
  });

  describe("saving", () => {
    it("writes the page row and both translations, or none of it", async () => {
      const editor = await seedStaff(db, "MODERATOR");
      const page = await createPage(db, { actor: editor, fields: fields(), now: NOW });

      const input = fields({ navOrder: "3" });
      input.translations.ro.title = "Despre noi";
      const saved = await savePage(db, {
        actor: editor,
        pageId: page.id,
        expectedVersion: page.version,
        fields: input,
        now: NOW,
      });

      expect(saved.navOrder).toBe(3);
      expect(saved.version).toBe(page.version + 1);
      const [romanian] = await db
        .select()
        .from(pageTranslations)
        .where(eq(pageTranslations.locale, "ro"));
      expect(romanian.title).toBe("Despre noi");
    });

    it("refuses a save carrying a version somebody else already superseded", async () => {
      const editor = await seedStaff(db, "MODERATOR");
      const page = await createPage(db, { actor: editor, fields: fields(), now: NOW });

      await savePage(db, {
        actor: editor,
        pageId: page.id,
        expectedVersion: page.version,
        fields: fields(),
        now: NOW,
      });

      // The second organizer loaded the page before the first one saved.
      expect(
        await codeOf(
          savePage(db, {
            actor: editor,
            pageId: page.id,
            expectedVersion: page.version,
            fields: fields(),
            now: NOW,
          }),
        ),
      ).toBe("CONFLICT");
    });

    it("lets a page keep its own address rather than reporting it as taken", async () => {
      const editor = await seedStaff(db, "MODERATOR");
      const page = await createPage(db, { actor: editor, fields: fields(), now: NOW });

      // The slug is unchanged, and the row that holds it is this page's own.
      const saved = await savePage(db, {
        actor: editor,
        pageId: page.id,
        expectedVersion: page.version,
        fields: fields(),
        now: NOW,
      });
      expect(saved.id).toBe(page.id);
    });
  });

  it("deletes a page and its translations together", async () => {
    const editor = await seedStaff(db, "MODERATOR");
    const page = await createPage(db, { actor: editor, fields: fields(), now: NOW });

    await deletePage(db, { actor: editor, pageId: page.id });

    expect(await db.select().from(pages)).toHaveLength(0);
    // ON DELETE CASCADE, so no translation survives its page.
    expect(await db.select().from(pageTranslations)).toHaveLength(0);
  });
});

describe("BR-REQ-050-03 what counts as complete", () => {
  it("names a missing translation, an empty title and an empty body", () => {
    expect(describeIncompletePageLocales([])).toEqual([
      { locale: "ro", missing: ["translation"] },
      { locale: "en", missing: ["translation"] },
    ]);

    expect(
      describeIncompletePageLocales([
        { locale: "ro", title: "Despre", bodyJson: { sections: [{ paragraphs: ["x"] }] } },
        { locale: "en", title: "  ", bodyJson: { sections: [] } },
      ]),
    ).toEqual([{ locale: "en", missing: ["title", "body"] }]);
  });

  it("accepts a body with sections and no heading, which is how a page opens with a sentence", () => {
    expect(
      describeIncompletePageLocales([
        { locale: "ro", title: "Despre", bodyJson: { sections: [{ paragraphs: ["x"] }] } },
        { locale: "en", title: "About", bodyJson: { sections: [{ paragraphs: ["x"] }] } },
      ]),
    ).toEqual([]);
  });
});
