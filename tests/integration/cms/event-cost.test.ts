import { asc, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eventTranslations, events } from "@/db/schema/events";
import { type StaffUser, staffUsers } from "@/db/schema/staff-users";
import { createEvent, repeatEvent, saveEventAndTranslations } from "@/modules/content/events/service";
import { toWallTimeInput } from "@/modules/events/domain/zoned-time";
import { isDomainError } from "@/shared/errors/domain-error";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";

/**
 * `DECISIONS.md` §343 — save and read the three cost kinds, a series carries the amount and
 * the link like it carries `cost_type`, and a row saved before this migration reads exactly as
 * it did (§343 reversing no rule; `cost_amount`/`cost_url` are null on it and that is not an
 * error).
 */
describe("event cost: save, read, series carry (§343)", () => {
  let db: TestDatabase;
  let close: () => Promise<void>;
  let admin: StaffUser;

  beforeAll(async () => {
    ({ db, close } = await createTestDatabase());
  });
  afterAll(async () => close());

  beforeEach(async () => {
    await resetTables(db);
    [admin] = await db
      .insert(staffUsers)
      .values({ email: "superadmin@dev.test", displayName: "Admin", role: "ADMIN" })
      .returning();
  });

  const EVENT_FIELDS = {
    type: "RACE",
    eventStatus: "SCHEDULED",
    timezone: "Europe/Bucharest",
    startsAtWallTime: "2026-10-11T09:00",
    endsAtWallTime: "",
    raceStartsAtWallTime: "",
    locationName: "Parcul Tractorul",
    locationAddress: "",
    surface: null,
    difficulty: null,
    costType: null,
    mapUrl: "",
    routeUrl: "",
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

  async function seedEvent() {
    return createEvent(db, {
      actor: admin,
      fields: {
        ...EVENT_FIELDS,
        translations: {
          ro: { slug: "crosul-aniversar", title: "Crosul aniversar", excerpt: "Cursa clubului." },
          en: { slug: "anniversary-cross", title: "Anniversary cross", excerpt: "The club's own race." },
        },
      },
    });
  }

  const reload = async (id: string) => (await db.select().from(events).where(eq(events.id, id)))[0];

  async function saveCost(row: typeof events.$inferSelect, changes: Record<string, unknown>) {
    const [ro] = await db.select().from(eventTranslations).where(eq(eventTranslations.eventId, row.id));
    return saveEventAndTranslations(db, {
      actor: admin,
      eventId: row.id,
      fields: {
        ...EVENT_FIELDS,
        startsAtWallTime: toWallTimeInput(row.startsAt, row.timezone),
        locationName: row.locationName,
        ...changes,
      },
      expectedVersion: row.version,
      translations: [{ translationId: ro.id, expectedVersion: ro.version, fields: { slug: ro.slug, title: ro.title, excerpt: ro.excerpt ?? "" } }],
    });
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

  it("saves and reads back a free, a paid and a donation event", async () => {
    const created = await seedEvent();

    await saveCost(created, { costType: "FREE", costAmount: "", costUrl: "" });
    expect(await reload(created.id)).toMatchObject({ costType: "FREE", costAmount: null, costUrl: null });

    const paid = await reload(created.id);
    await saveCost(paid, { costType: "PAID", costAmount: "50 lei", costUrl: "https://revolut.me/brasovrunners" });
    expect(await reload(created.id)).toMatchObject({
      costType: "PAID",
      costAmount: "50 lei",
      costUrl: "https://revolut.me/brasovrunners",
    });

    const donation = await reload(created.id);
    await saveCost(donation, {
      costType: "DONATION",
      costAmount: "",
      costUrl: "https://www.wingsforlifeworldrun.com/en/donate",
    });
    expect(await reload(created.id)).toMatchObject({
      costType: "DONATION",
      costAmount: null,
      costUrl: "https://www.wingsforlifeworldrun.com/en/donate",
    });
  });

  it("refuses a paid event with no stated amount, and a donation with no link", async () => {
    const created = await seedEvent();
    expect(await codeOf(saveCost(created, { costType: "PAID", costAmount: "", costUrl: "" }))).toBe("VALIDATION_ERROR");
    expect(await codeOf(saveCost(created, { costType: "DONATION", costAmount: "", costUrl: "" }))).toBe("VALIDATION_ERROR");
    // Nothing was written: the row is still what it was created as.
    expect((await reload(created.id)).costType).toBeNull();
  });

  it("refuses a cost link that does not start with https://", async () => {
    const created = await seedEvent();
    expect(await codeOf(saveCost(created, { costType: "DONATION", costAmount: "", costUrl: "http://example.test/donate" }))).toBe(
      "VALIDATION_ERROR",
    );
  });

  it("keeps the amount typed for PAID when the club tries DONATION and comes back, like the meeting point while the place is to be announced (§328)", async () => {
    const created = await seedEvent();
    await saveCost(created, { costType: "PAID", costAmount: "50 lei", costUrl: "" });
    const paid = await reload(created.id);
    await saveCost(paid, { costType: "DONATION", costAmount: "50 lei", costUrl: "https://revolut.me/x" });
    // The editor always posts both boxes, so "50 lei" travels as the suggested amount rather
    // than being cleared — the same "values kept while hidden" rule PlaceToBeAnnounced follows.
    expect((await reload(created.id)).costAmount).toBe("50 lei");
  });

  it("carries the amount and the link to every date of a series, like cost_type", async () => {
    const source = await seedEvent();
    await repeatEvent(db, {
      actor: admin,
      eventId: source.id,
      rule: { cadence: "WEEKLY", weekdays: [], until: "2026-11-01", publish: false },
      now: new Date("2026-10-01T00:00:00Z"),
    });
    const dates = await db.select().from(events).where(eq(events.repeatOf, source.id)).orderBy(asc(events.startsAt));
    expect(dates.length).toBeGreaterThan(0);

    const row = await reload(source.id);
    const [ro] = await db.select().from(eventTranslations).where(eq(eventTranslations.eventId, source.id));
    const result = await saveEventAndTranslations(db, {
      actor: admin,
      eventId: source.id,
      fields: {
        ...EVENT_FIELDS,
        startsAtWallTime: toWallTimeInput(row.startsAt, row.timezone),
        locationName: row.locationName,
        costType: "DONATION",
        costAmount: "50 lei",
        costUrl: "https://www.wingsforlifeworldrun.com/en/donate",
      },
      expectedVersion: row.version,
      translations: [{ translationId: ro.id, expectedVersion: ro.version, fields: { slug: ro.slug, title: ro.title, excerpt: ro.excerpt ?? "" } }],
      scope: "all",
    });
    expect(result.appliedTo).toBeGreaterThan(1);

    for (const date of dates) {
      const carried = await reload(date.id);
      expect(carried.costType).toBe("DONATION");
      expect(carried.costAmount).toBe("50 lei");
      expect(carried.costUrl).toBe("https://www.wingsforlifeworldrun.com/en/donate");
    }
  });

  it("reads an event saved before this migration exactly as before — null cost_amount and cost_url are not an error", async () => {
    // A row exactly as migration 0018 left it: cost_type set, the two new columns never written.
    const [legacy] = await db
      .insert(events)
      .values({
        type: "GROUP_RUN",
        eventStatus: "SCHEDULED",
        timezone: "Europe/Bucharest",
        startsAt: new Date("2026-10-11T06:00:00Z"),
        locationName: "Parcul Tractorul",
        registrationMode: "NONE",
        costType: "PAID",
      })
      .returning();
    expect(legacy.costAmount).toBeNull();
    expect(legacy.costUrl).toBeNull();

    // A save that does not touch the cost fields leaves them exactly as they were (§169's rule
    // for `links` and `bibDesign`): the real editor always posts both, but this simulates an
    // older caller — a script, a fixture — that does not know they exist yet.
    await db.insert(eventTranslations).values({ eventId: legacy.id, locale: "ro", slug: "vechi", title: "Vechi", excerpt: "E." });
    const ro = (await db.select().from(eventTranslations).where(eq(eventTranslations.eventId, legacy.id)))[0];
    await saveEventAndTranslations(db, {
      actor: admin,
      eventId: legacy.id,
      fields: {
        ...EVENT_FIELDS,
        startsAtWallTime: toWallTimeInput(legacy.startsAt, legacy.timezone),
        locationName: legacy.locationName,
        costType: "PAID",
        // costAmount and costUrl deliberately absent, like a caller from before they existed.
      },
      expectedVersion: legacy.version,
      translations: [{ translationId: ro.id, expectedVersion: ro.version, fields: { slug: ro.slug, title: ro.title, excerpt: ro.excerpt ?? "" } }],
    });
    const after = await reload(legacy.id);
    expect(after.costType).toBe("PAID");
    expect(after.costAmount).toBeNull();
    expect(after.costUrl).toBeNull();
  });
});
