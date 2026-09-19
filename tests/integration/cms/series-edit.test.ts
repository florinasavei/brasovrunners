import { asc, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eventTranslations, events } from "@/db/schema/events";
import { participants } from "@/db/schema/participants";
import { registrations } from "@/db/schema/registrations";
import { type StaffUser, staffUsers } from "@/db/schema/staff-users";
import { repeatEvent, saveEventAndTranslations } from "@/modules/content/events/service";
import { toWallTimeInput } from "@/modules/events/domain/zoned-time";
import { computeContentHash } from "@/modules/legal-documents/domain/content-hash";
import { insertLegalDocumentVersion } from "@/modules/legal-documents/repository";
import { isDomainError } from "@/shared/errors/domain-error";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";

/**
 * BR-REQ-050-02 criterion 15 (`DECISIONS.md` §130) — a save on one date of a series reaches
 * the following dates or all of them, as Google Calendar asks, and only what changed travels.
 */
describe("BR-REQ-050-02 criterion 15 editing one date, the following ones or the whole series", () => {
  let db: TestDatabase;
  let close: () => Promise<void>;
  let editor: StaffUser;
  let declarationId: string;

  beforeAll(async () => {
    ({ db, close } = await createTestDatabase());
  });
  afterAll(async () => close());

  beforeEach(async () => {
    await resetTables(db);
    [editor] = await db
      .insert(staffUsers)
      .values({ email: "moderator@dev.test", displayName: "Editor", role: "MODERATOR" })
      .returning();
    const translations = [
      { locale: "ro" as const, title: "Declarație", body: { sections: [{ paragraphs: ["Declar."] }] } },
      { locale: "en" as const, title: "Declaration", body: { sections: [{ paragraphs: ["I declare."] }] } },
    ];
    declarationId = await insertLegalDocumentVersion(db, {
      key: "EVENT_DECLARATION",
      version: 1,
      effectiveAt: NOW,
      isApproved: true,
      contentSha256: computeContentHash(translations),
      translations,
      now: NOW,
    });
  });

  /** The day the series is made; the horizon reaches past the rule's end. */
  const NOW = new Date("2026-09-19T10:00:00.000Z");
  const ZONE = "Europe/Bucharest";

  /** A Sunday run on 11 Oct 08:00, repeated every Sunday until 8 Nov — across the clock change on 25 Oct. */
  async function seedSeries() {
    const [source] = await db
      .insert(events)
      .values({
        type: "RACE",
        surface: "ASPHALT",
        startsAt: new Date("2026-10-11T08:00:00+03:00"),
        endsAt: new Date("2026-10-11T09:30:00+03:00"),
        timezone: ZONE,
        locationName: "Parcul Tractorul",
        registrationMode: "INTERNAL",
        capacity: 30,
        registrationOpensAt: new Date("2026-10-04T08:00:00+03:00"),
        registrationClosesAt: new Date("2026-10-11T07:00:00+03:00"),
        declarationDocumentId: declarationId,
      })
      .returning();
    await db.insert(eventTranslations).values([
      { eventId: source.id, locale: "ro", slug: "alergare-de-duminica", title: "Alergare de duminică", excerpt: "Relaxat." },
      { eventId: source.id, locale: "en", slug: "sunday-run", title: "Sunday run", excerpt: "Easy." },
    ]);
    await repeatEvent(db, { actor: editor, eventId: source.id, rule: { cadence: "WEEKLY", weekdays: [], until: "2026-11-08", publish: false }, now: NOW });
    const dates = await db.select().from(events).where(eq(events.repeatOf, source.id)).orderBy(asc(events.startsAt));
    expect(dates.map((row) => toWallTimeInput(row.startsAt, ZONE).slice(0, 10))).toEqual(["2026-10-18", "2026-10-25", "2026-11-01", "2026-11-08"]);
    return { source, dates };
  }

  const reload = async (id: string) => (await db.select().from(events).where(eq(events.id, id)))[0];
  const translationOf = async (eventId: string, locale: "ro" | "en") =>
    (await db.select().from(eventTranslations).where(eq(eventTranslations.eventId, eventId))).find((row) => row.locale === locale)!;

  /** The editor's form for one date, as posted: every field the row has, with the changes given. */
  const formFor = (row: typeof events.$inferSelect, changes: Record<string, unknown> = {}) => ({
    type: row.type,
    eventStatus: row.eventStatus,
    timezone: row.timezone,
    startsAtWallTime: toWallTimeInput(row.startsAt, row.timezone),
    endsAtWallTime: toWallTimeInput(row.endsAt, row.timezone),
    raceStartsAtWallTime: "",
    locationName: row.locationName ?? "",
    locationAddress: "",
    surface: row.surface,
    difficulty: null,
    costType: null,
    mapUrl: row.mapUrl ?? "",
    routeUrl: "",
    distanceMeters: "",
    elevationGainMeters: "",
    featured: false,
    registrationMode: row.registrationMode,
    participantListVisibility: "HIDDEN" as const,
    capacity: row.capacity === null ? "" : String(row.capacity),
    registrationOpensAtWallTime: toWallTimeInput(row.registrationOpensAt, row.timezone),
    registrationClosesAtWallTime: toWallTimeInput(row.registrationClosesAt, row.timezone),
    declarationDocumentId: row.declarationDocumentId ?? "",
    externalProvider: "",
    externalRegistrationUrl: "",
    ...changes,
  });

  const wordsFor = (row: typeof eventTranslations.$inferSelect, changes: Record<string, unknown> = {}) => ({
    slug: row.slug,
    title: row.title,
    excerpt: row.excerpt ?? "",
    seoTitle: "",
    seoDescription: "",
    ...changes,
  });

  async function save(row: typeof events.$inferSelect, scope: "this" | "following" | "all", changes: { fields?: Record<string, unknown>; ro?: Record<string, unknown> }) {
    const ro = await translationOf(row.id, "ro");
    return saveEventAndTranslations(db, {
      actor: editor,
      eventId: row.id,
      fields: formFor(row, changes.fields),
      expectedVersion: row.version,
      translations: [{ translationId: ro.id, expectedVersion: ro.version, fields: wordsFor(ro, changes.ro) }],
      scope,
      now: NOW,
    });
  }

  it("carries a new time and a new title to the following dates only, at the same hour on each date's own day", async () => {
    const { source, dates } = await seedSeries();
    const [oct18, oct25, nov1, nov8] = dates;

    // The 25 October run moves to 08:50 and gets a new title, for itself and what follows.
    const result = await save(oct25, "following", {
      fields: { startsAtWallTime: "2026-10-25T08:50", endsAtWallTime: "2026-10-25T10:20" },
      ro: { title: "Alergare de duminică 🏃" },
    });
    expect(result.appliedTo).toBe(2);

    // The two after it: 08:50 on their own Sunday — across the clock change — and the title.
    for (const later of [nov1, nov8]) {
      const row = await reload(later.id);
      expect(toWallTimeInput(row.startsAt, ZONE)).toBe(`${toWallTimeInput(later.startsAt, ZONE).slice(0, 10)}T08:50`);
      expect(toWallTimeInput(row.endsAt, ZONE)).toBe(`${toWallTimeInput(later.startsAt, ZONE).slice(0, 10)}T10:20`);
      expect(row.version).toBe(later.version + 1);
      const ro = await translationOf(later.id, "ro");
      expect(ro.title).toBe("Alergare de duminică 🏃");
      expect(ro.slug).toBe(`alergare-de-duminica-${toWallTimeInput(later.startsAt, ZONE).slice(0, 10)}`); // the address stays
      expect((await translationOf(later.id, "en")).title).toBe("Sunday run"); // English was not posted
    }
    // The registration window was not edited, so it did not travel.
    expect((await reload(nov1.id)).registrationClosesAt?.toISOString()).toBe(nov1.registrationClosesAt?.toISOString());

    // The source and the date before stay as they were.
    for (const earlier of [source, oct18]) {
      const row = await reload(earlier.id);
      expect(toWallTimeInput(row.startsAt, ZONE).slice(11)).toBe("08:00");
      expect((await translationOf(earlier.id, "ro")).title).toBe("Alergare de duminică");
    }
  });

  it("carries only what changed to all dates: a date moved or cancelled on its own keeps that", async () => {
    const { source, dates } = await seedSeries();
    const [oct18, oct25] = dates;

    // One date is at another place, another is cancelled — each on its own.
    await save(oct18, "this", { fields: { locationName: "Poiana Brașov" } });
    await save(oct25, "this", { fields: { eventStatus: "CANCELLED" } });

    // The source's capacity changes for every date.
    const result = await save(await reload(source.id), "all", { fields: { capacity: "40" } });
    expect(result.appliedTo).toBe(4);

    expect((await reload(oct18.id)).capacity).toBe(40);
    expect((await reload(oct18.id)).locationName).toBe("Poiana Brașov");
    expect((await reload(oct25.id)).capacity).toBe(40);
    expect((await reload(oct25.id)).eventStatus).toBe("CANCELLED");
    expect((await reload(dates[3].id)).capacity).toBe(40);

    // "This date only" and a save that changes nothing reach nobody.
    expect((await save(await reload(source.id), "this", { fields: { capacity: "45" } })).appliedTo).toBe(0);
    expect((await reload(oct18.id)).capacity).toBe(40);
    expect((await save(await reload(source.id), "all", {})).appliedTo).toBe(0);
  });

  it("refuses the whole save when one date has more places taken than the new capacity, naming its day", async () => {
    const { source, dates } = await seedSeries();
    const people = await db
      .insert(participants)
      .values(
        ["ana", "bogdan"].map((name) => ({
          deliveryEmail: `${name}@example.test`,
          normalizedEmail: `${name}@example.test`,
          canonicalEmail: `${name}@example.test`,
          canonicalizationVersion: 1,
          defaultName: name,
        })),
      )
      .returning();
    await db.insert(registrations).values(
      people.map((person) => ({
        eventId: dates[1].id,
        participantId: person.id,
        status: "CONFIRMED" as const,
        locale: "ro" as const,
        registeredName: "Ana",
        displayName: "Ana",
        privacyNoticeVersion: 1,
        privacyAcknowledgedAt: NOW,
        raceId: null,
        resultsNameConsent: false,
        resultsConsentVersion: 1,
      })),
    );

    let error: unknown;
    try {
      await save(source, "all", { fields: { capacity: "1", locationName: "Altundeva" } });
    } catch (caught) {
      error = caught;
    }
    expect(isDomainError(error) && error.code).toBe("VALIDATION_ERROR");
    expect(isDomainError(error) && error.message).toContain("2026-10-25");
    // Nothing was written — not even the source's own save.
    expect((await reload(source.id)).capacity).toBe(30);
    expect((await reload(source.id)).locationName).toBe("Parcul Tractorul");
    expect((await reload(dates[0].id)).locationName).toBe("Parcul Tractorul");
  });

  it("is ignored on an event that is not part of a series", async () => {
    const [alone] = await db
      .insert(events)
      .values({ type: "GROUP_RUN", startsAt: new Date("2026-10-01T06:00:00.000Z"), timezone: ZONE, locationName: "Parcul Tractorul" })
      .returning();
    await db.insert(eventTranslations).values({ eventId: alone.id, locale: "ro", slug: "singur", title: "Singur" });
    expect((await save(alone, "all", { fields: { locationName: "Aiurea" } })).appliedTo).toBe(0);
    expect((await reload(alone.id)).locationName).toBe("Aiurea");
  });
});
