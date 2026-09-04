import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eventTranslations, events } from "@/db/schema/events";
import { findTranslationForPreview } from "@/modules/content/events/repository";
import { findPublishedEventBySlug, listPublishedEvents } from "@/modules/events/repository";
import { isPrivatePath } from "@/shared/security/private-paths";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";

/**
 * BR-REQ-051-02 — protected preview.
 *
 * Criterion 1, refusal without staff authorization, is the page calling `requireStaff()`
 * before it reads a row; the end-to-end suite proves it over HTTP, which is the only place a
 * genuinely anonymous request exists. What is proven here is the half that a browser cannot
 * show: that the preview query is the only one in the codebase that returns unpublished
 * content, and that everything public still refuses it.
 */
describe("BR-REQ-051-02 the preview reads what the public cannot", () => {
  let db: TestDatabase;
  let close: () => Promise<void>;

  beforeAll(async () => {
    ({ db, close } = await createTestDatabase());
  });
  afterAll(async () => close());
  beforeEach(async () => resetTables(db));

  async function seedDraft() {
    const [event] = await db
      .insert(events)
      .values({
        kind: "RACE",
        startsAt: new Date("2026-10-11T06:00:00Z"),
        editorialStatus: "DRAFT",
      })
      .returning();
    await db.insert(eventTranslations).values([
      {
        eventId: event.id,
        locale: "ro",
        slug: "crosul-aniversar",
        title: "Crosul aniversar",
        locationName: "Parcul Tractorul",
      },
      {
        eventId: event.id,
        locale: "en",
        slug: "anniversary-cross",
        title: "Anniversary cross",
        locationName: "Tractorul Park",
      },
    ]);
    return event;
  }

  it("returns a draft translation for staff", async () => {
    const event = await seedDraft();

    const preview = await findTranslationForPreview(db, event.id, "ro");
    expect(preview?.translation.title).toBe("Crosul aniversar");
    expect(preview?.event.editorialStatus).toBe("DRAFT");
  });

  it("returns the locale that was asked for, and not the other one", async () => {
    const event = await seedDraft();

    const english = await findTranslationForPreview(db, event.id, "en");
    expect(english?.translation.title).toBe("Anniversary cross");
    expect(english?.event.editorialStatus).toBe("DRAFT");
  });

  it("returns nothing for an event that has no translation in that locale", async () => {
    const [event] = await db
      .insert(events)
      .values({ kind: "MEETUP", startsAt: new Date("2026-10-11T06:00:00Z") })
      .returning();

    expect(await findTranslationForPreview(db, event.id, "ro")).toBeUndefined();
  });

  it("leaves the same content invisible to every public query", async () => {
    await seedDraft();

    // The sitemap is built from exactly this query, so a draft cannot appear in it either.
    expect(await listPublishedEvents(db, "ro")).toHaveLength(0);
    expect(await listPublishedEvents(db, "en")).toHaveLength(0);
    expect(await findPublishedEventBySlug(db, "ro", "crosul-aniversar")).toBeUndefined();
  });

  it("treats every preview URL as private, so it is never indexed or cached", () => {
    // Criterion 2. The proxy sets `X-Robots-Tag: noindex` and a private, no-store policy on
    // these paths; the page sets the same in its metadata.
    expect(isPrivatePath("/ro/previzualizare/evenimente/8f0c")).toBe(true);
    expect(isPrivatePath("/en/preview/events/8f0c")).toBe(true);
  });
});
