import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eventTranslations, events } from "@/db/schema/events";
import { type StaffUser, staffUsers } from "@/db/schema/staff-users";
import { saveEventAndTranslations } from "@/modules/content/events/service";
import { isDomainError } from "@/shared/errors/domain-error";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";

/**
 * BR-REQ-051-01 criterion 5 — a save carries the version it was loaded with, for the editor's
 * one form.
 *
 * The editor used to be a settings form and one form per language: three saves, three version
 * guards, and two of them silently stale the moment the first succeeded. It is one form and one
 * transaction now, and the property that matters is the one the old shape could not have — a
 * stale version *anywhere* fails the whole save and writes none of it. Half a save is exactly
 * the state this criterion exists to prevent.
 */
const NOW = new Date("2026-09-05T10:00:00.000Z");

const EVENT_FIELDS = {
  kind: "COMMUNITY_RUN",
  eventStatus: "SCHEDULED",
  timezone: "Europe/Bucharest",
  startsAtWallTime: "2026-10-01T09:00",
  endsAtWallTime: "",
  raceStartsAtWallTime: "",
  latitude: "",
  longitude: "",
  // One value for the whole event now (`DECISIONS.md` §36).
  locationName: "Parcul Tractorul",
  locationAddress: "",
  difficultyLabel: "",
  costText: "",
  mapUrl: "",
  distanceMeters: "",
  elevationGainMeters: "",
  featured: false,
  registrationMode: "NONE",
  participantListVisibility: "HIDDEN" as const,
  capacity: "",
  registrationOpensAtWallTime: "",
  registrationClosesAtWallTime: "",
  declarationDocumentId: "",
  externalProvider: "",
  externalRegistrationUrl: "",
};

const translationFields = (title: string) => ({
  slug: title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""),
  title,
  excerpt: "",
  seoTitle: "",
  seoDescription: "",
});

let db: TestDatabase;
let close: () => Promise<void>;
let editor: StaffUser;
let author: StaffUser;

beforeAll(async () => {
  ({ db, close } = await createTestDatabase());
});
afterAll(async () => {
  await close();
});

beforeEach(async () => {
  await resetTables(db);
  [editor] = await db
    .insert(staffUsers)
    .values({ email: "moderator@dev.test", displayName: "Editor", role: "MODERATOR" })
    .returning();
  [author] = await db
    .insert(staffUsers)
    .values({ email: "contributor@dev.test", displayName: "Author", role: "CONTRIBUTOR" })
    .returning();
});

async function createDraft(options: { authorStaffUserId?: string } = {}) {
  const [event] = await db
    .insert(events)
    .values({ kind: "COMMUNITY_RUN", startsAt: new Date("2026-10-01T06:00:00.000Z") })
    .returning();

  const rows = await db
    .insert(eventTranslations)
    .values(
      (["ro", "en"] as const).map((locale) => ({
        eventId: event.id,
        locale,
        slug: `evenimentul-${locale}`,
        title: `Titlu ${locale}`,
        locationName: "Parcul Tractorul",
        authorStaffUserId: options.authorStaffUserId ?? null,
      })),
    )
    .returning();

  return { event, ro: rows.find((r) => r.locale === "ro")!, en: rows.find((r) => r.locale === "en")! };
}

async function codeOf(operation: Promise<unknown>): Promise<string> {
  try {
    await operation;
    return "no error";
  } catch (error) {
    if (isDomainError(error)) return error.code;
    throw error;
  }
}

const reloadEvent = async (id: string) =>
  (await db.select().from(events).where(eq(events.id, id)))[0];
const reloadTranslation = async (id: string) =>
  (await db.select().from(eventTranslations).where(eq(eventTranslations.id, id)))[0];

describe("BR-REQ-051-01 one save writes the event row and every language", () => {
  it("writes all three in one call and bumps every version", async () => {
    const { event, ro, en } = await createDraft();

    await saveEventAndTranslations(db, {
      actor: editor,
      eventId: event.id,
      expectedVersion: event.version,
      fields: { ...EVENT_FIELDS, distanceMeters: "8000" },
      translations: [
        { translationId: ro.id, expectedVersion: ro.version, fields: translationFields("Alergare") },
        { translationId: en.id, expectedVersion: en.version, fields: translationFields("A run") },
      ],
      now: NOW,
    });

    const saved = await reloadEvent(event.id);
    expect(saved.distanceMeters).toBe(8000);
    expect(saved.version).toBe(event.version + 1);
    expect((await reloadTranslation(ro.id)).title).toBe("Alergare");
    expect((await reloadTranslation(en.id)).title).toBe("A run");
    expect((await reloadTranslation(ro.id)).version).toBe(ro.version + 1);
  });

  it("fails the whole save when one language's version is stale, and writes nothing", async () => {
    const { event, ro, en } = await createDraft();

    const code = await codeOf(
      saveEventAndTranslations(db, {
        actor: editor,
        eventId: event.id,
        expectedVersion: event.version,
        fields: { ...EVENT_FIELDS, distanceMeters: "8000" },
        translations: [
          { translationId: ro.id, expectedVersion: ro.version, fields: translationFields("Alergare") },
          // Somebody else saved the English text since this page was rendered.
          { translationId: en.id, expectedVersion: en.version + 5, fields: translationFields("A run") },
        ],
        now: NOW,
      }),
    );

    expect(code).toBe("CONFLICT");
    // The transaction rolled back: the event row and the Romanian text are untouched, which is
    // the property the three-forms shape could not offer.
    const after = await reloadEvent(event.id);
    expect(after.distanceMeters).toBeNull();
    expect(after.version).toBe(event.version);
    expect((await reloadTranslation(ro.id)).title).toBe("Titlu ro");
    expect((await reloadTranslation(ro.id)).version).toBe(ro.version);
  });

  it("fails the whole save when the event row's version is stale", async () => {
    const { event, ro, en } = await createDraft();

    const code = await codeOf(
      saveEventAndTranslations(db, {
        actor: editor,
        eventId: event.id,
        expectedVersion: event.version + 3,
        fields: { ...EVENT_FIELDS, distanceMeters: "8000" },
        translations: [
          { translationId: ro.id, expectedVersion: ro.version, fields: translationFields("Alergare") },
          { translationId: en.id, expectedVersion: en.version, fields: translationFields("A run") },
        ],
        now: NOW,
      }),
    );

    expect(code).toBe("CONFLICT");
    expect((await reloadTranslation(ro.id)).title).toBe("Titlu ro");
    expect((await reloadTranslation(en.id)).title).toBe("Titlu en");
  });
});

describe("BR-REQ-060-01 the one save respects the same role boundaries", () => {
  it("writes only the text when an Author saves their own draft, and no event row", async () => {
    // An Author sees no settings panel, so the form posts no `event.expectedVersion` and the
    // save carries no event fields. §10.2: editorial control of what the club advertises is not
    // an Author's.
    const { event, ro } = await createDraft({ authorStaffUserId: author.id });

    await saveEventAndTranslations(db, {
      actor: author,
      eventId: event.id,
      translations: [
        { translationId: ro.id, expectedVersion: ro.version, fields: translationFields("Alergarea mea") },
      ],
      now: NOW,
    });

    expect((await reloadTranslation(ro.id)).title).toBe("Alergarea mea");
    // Untouched, and its version not bumped: nothing about the event row was part of this save.
    expect((await reloadEvent(event.id)).version).toBe(event.version);
  });

  it("refuses an Author who posts event fields anyway", async () => {
    const { event, ro } = await createDraft({ authorStaffUserId: author.id });

    const code = await codeOf(
      saveEventAndTranslations(db, {
        actor: author,
        eventId: event.id,
        expectedVersion: event.version,
        fields: EVENT_FIELDS,
        translations: [
          { translationId: ro.id, expectedVersion: ro.version, fields: translationFields("Alergarea mea") },
        ],
        now: NOW,
      }),
    );

    expect(code).toBe("FORBIDDEN");
    expect((await reloadTranslation(ro.id)).title).toBe("Titlu ro");
  });

  it("refuses a save of published content without the acknowledgement", async () => {
    // BR-REQ-051-01 criterion 4, now one checkbox for the whole save.
    const { event, ro, en } = await createDraft();
    await db
      .update(events)
      .set({ editorialStatus: "PUBLISHED", publishedAt: NOW })
      .where(eq(events.id, event.id));
    const published = await reloadEvent(event.id);

    const code = await codeOf(
      saveEventAndTranslations(db, {
        actor: editor,
        eventId: event.id,
        expectedVersion: published.version,
        fields: EVENT_FIELDS,
        translations: [
          { translationId: ro.id, expectedVersion: ro.version, fields: { ...translationFields("Alergare"), slug: ro.slug } },
          { translationId: en.id, expectedVersion: en.version, fields: { ...translationFields("A run"), slug: en.slug } },
        ],
        now: NOW,
      }),
    );

    expect(code).toBe("VALIDATION_ERROR");
    expect((await reloadTranslation(ro.id)).title).toBe("Titlu ro");
  });
});
