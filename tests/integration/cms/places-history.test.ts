import { and, asc, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { auditLogs } from "@/db/schema/audit-logs";
import { eventTranslations, events } from "@/db/schema/events";
import { registrations } from "@/db/schema/registrations";
import { type StaffUser, staffUsers } from "@/db/schema/staff-users";
import { toWallTimeInput } from "@/modules/events/domain/zoned-time";
import { computeContentHash, type LegalDocumentTranslationInput } from "@/modules/legal-documents/domain/content-hash";
import { insertLegalDocumentVersion } from "@/modules/legal-documents/repository";
import { CapacityBelowTakenError, capacityBelowTakenRefusalOf } from "@/modules/registrations/domain/capacity";
import { PlacesKeptAboveCapacityError, placesKeptRefusalOf } from "@/modules/registrations/domain/kept-places";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";

vi.mock("@/modules/public-cache/cache", async (original) => ({
  ...(await original<typeof import("@/modules/public-cache/cache")>()),
  revalidatePublicContent: () => undefined,
}));
vi.mock("@/modules/notifications/drain", () => ({
  drainOutboxAfterResponse: () => undefined,
  drainOutboxRowsAfterResponse: () => undefined,
}));

const { createEvent, duplicateEvent, repeatEvent, saveEventAndTranslations } = await import("@/modules/content/events/service");
type SeriesEditScope = Parameters<typeof saveEventAndTranslations>[1]["scope"];
const { confirmEmail, submitRegistration } = await import("@/modules/registrations/service");
const { offerPlaceByStaff } = await import("@/modules/registrations/admin-service");

/**
 * «Istoric capacitate»'s writes (§NNN; BR-REQ-034-02) and «Locuri păstrate pentru club» in the editor (BR-REQ-050-02): every
 * save that moves the capacity or the places kept leaves one audit row per value that moved, in the save's own transaction,
 * in the format lane B reads — `event.capacity_changed` `{from, to, occupied, offered, via, reason?, version}` and
 * `event.places_kept_changed` `{from, to, via, reason?, version}` — and the supplementary places' rows carry `version`,
 * `occupied` and `via`. The refusals say the numbers: the places taken by kind, and the date of a series.
 */
let db: TestDatabase;
let close: () => Promise<void>;
let admin: StaffUser;
let declarationId: string;

const NOW = new Date("2026-09-19T10:00:00.000Z");
const ZONE = "Europe/Bucharest";

beforeAll(async () => {
  ({ db, close } = await createTestDatabase());
});
afterAll(async () => close());
beforeEach(async () => {
  await resetTables(db);
  [admin] = await db.insert(staffUsers).values({ email: "admin@dev.test", displayName: "Admin", role: "ADMIN" }).returning();
  const pair: LegalDocumentTranslationInput[] = [
    { locale: "ro", title: "Document", body: { sections: [{ paragraphs: ["p"] }] } },
    { locale: "en", title: "Document", body: { sections: [{ paragraphs: ["p"] }] } },
  ];
  for (const key of ["PRIVACY_NOTICE", "TERMS", "EVENT_DECLARATION"] as const) {
    const id = await insertLegalDocumentVersion(db, { key, version: 1, effectiveAt: new Date("2026-01-01T00:00:00Z"), isApproved: true, contentSha256: computeContentHash(pair), translations: pair, now: NOW });
    if (key === "EVENT_DECLARATION") declarationId = id;
  }
});

/** A race on 11 Oct with `capacity` places, `kept` of them the club's, registration open. */
async function seedEvent(capacity: number | null, kept = 0) {
  const [row] = await db
    .insert(events)
    .values({
      type: "RACE",
      surface: "ASPHALT",
      startsAt: new Date("2026-10-11T08:00:00+03:00"),
      endsAt: new Date("2026-10-11T09:30:00+03:00"),
      timezone: ZONE,
      locationName: "Parcul Tractorul",
      registrationMode: "INTERNAL",
      capacity,
      placesKeptForClub: kept,
      registrationOpensAt: new Date("2026-09-18T08:00:00+03:00"),
      registrationClosesAt: new Date("2026-10-11T07:00:00+03:00"),
      declarationDocumentId: declarationId,
      publishedAt: NOW,
      editorialStatus: "PUBLISHED",
    })
    .returning();
  await db.insert(eventTranslations).values([
    { eventId: row.id, locale: "ro", slug: `cursa-${row.id.slice(0, 8)}`, title: "Cursa de toamnă", excerpt: "Rapid." },
    { eventId: row.id, locale: "en", slug: `race-${row.id.slice(0, 8)}`, title: "Autumn race", excerpt: "Fast." },
  ]);
  return row;
}

const reload = async (id: string) => (await db.select().from(events).where(eq(events.id, id)))[0];
const trail = (action: string) => db.select().from(auditLogs).where(eq(auditLogs.action, action)).orderBy(asc(auditLogs.createdAt));

/** The editor's form for the row, as posted, with the changes given. */
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
  mapUrl: "",
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

async function save(id: string, changes: Record<string, unknown>, options: { scope?: SeriesEditScope; reason?: string; at?: Date } = {}) {
  const row = await reload(id);
  const ro = (await db.select().from(eventTranslations).where(eq(eventTranslations.eventId, id))).find((t) => t.locale === "ro")!;
  return saveEventAndTranslations(db, {
    actor: admin,
    eventId: id,
    fields: formFor(row, changes),
    expectedVersion: row.version,
    translations: [{ translationId: ro.id, expectedVersion: ro.version, fields: { slug: ro.slug, title: ro.title, excerpt: ro.excerpt ?? "", seoTitle: "", seoDescription: "" } }],
    acknowledgeLiveEdit: true,
    scope: options.scope ?? "this",
    placesChangeReason: options.reason,
    now: options.at ?? NOW,
  });
}

async function refusal(work: Promise<unknown>): Promise<unknown> {
  try {
    await work;
  } catch (error) {
    return error;
  }
  throw new Error("expected a refusal");
}

/** One person through the form and the email link: a place on a race with room. */
async function enter(row: typeof events.$inferSelect, name: string) {
  const event = {
    id: row.id,
    eventStatus: row.eventStatus,
    registrationMode: row.registrationMode,
    startsAt: row.startsAt,
    registrationOpensAt: row.registrationOpensAt,
    registrationClosesAt: row.registrationClosesAt,
    capacity: row.capacity,
    raceId: row.raceId,
    publishedAt: row.publishedAt,
  };
  await submitRegistration(
    db,
    event,
    {
      firstName: name,
      lastName: "Pop",
      birthDate: "1990-05-17",
      sex: "FEMALE",
      nationality: "RO",
      country: "RO",
      city: "Brașov",
      phone: "+40711111111",
      emergencyContactName: "Contact Urgență",
      emergencyContactPhone: "+40722222222",
      email: `${name.toLowerCase()}@example.ro`,
      locale: "ro",
      privacyAcknowledged: true,
      fitnessDeclared: true,
      termsAccepted: true,
      rulesAcknowledged: true,
      resultsNameConsent: true,
      listOptOut: false,
      honeypot: "",
      renderedAt: new Date(NOW.getTime() - 10_000).toISOString(),
    },
    NOW,
  );
  const [created] = await db.select().from(registrations).where(and(eq(registrations.eventId, row.id), eq(registrations.registeredName, `${name} Pop`)));
  return confirmEmail(db, event, created.id, NOW);
}

describe("BR-REQ-034-02 «Istoric capacitate»: every save that moves the places leaves its row (§NNN)", () => {
  it("the editor's save: from, to, the places taken under the lock, the offers, the save, the reason and the row's version", async () => {
    const row = await seedEvent(10);
    await enter(row, "Ana");
    await save(row.id, { capacity: "12" }, { reason: "  Încă doi pacemakeri  " });
    const [moved] = await trail("event.capacity_changed");
    expect(moved).toMatchObject({ actorStaffUserId: admin.id, entityType: "event", entityId: row.id, participantId: null });
    expect(moved.metadataJson).toEqual({ from: 10, to: 12, occupied: 1, offered: 0, via: "editor", reason: "Încă doi pacemakeri", version: row.version + 1 });
    // A save that moves neither number writes nothing more, whatever reason it carries.
    await save(row.id, { capacity: "12" }, { reason: "nimic" });
    expect(await trail("event.capacity_changed")).toHaveLength(1);
    expect(await trail("event.places_kept_changed")).toEqual([]);
  });

  it("«Locuri păstrate pentru club»: saved, audited on its own row; an empty box is 0", async () => {
    const row = await seedEvent(10);
    await save(row.id, { placesKeptForClub: "3" });
    expect((await reload(row.id)).placesKeptForClub).toBe(3);
    expect((await trail("event.places_kept_changed")).map((entry) => entry.metadataJson)).toEqual([{ from: 0, to: 3, via: "editor", version: row.version + 1 }]);
    await save(row.id, { placesKeptForClub: "" });
    expect((await reload(row.id)).placesKeptForClub).toBe(0);
    expect(await trail("event.places_kept_changed")).toHaveLength(2);
  });

  it("refuses K above the places, naming the box — posted, or kept from the row under a lowered capacity — and writes nothing", async () => {
    const row = await seedEvent(10, 4);
    const above = await refusal(save(row.id, { placesKeptForClub: "11" }));
    expect(above).toBeInstanceOf(PlacesKeptAboveCapacityError);
    expect(placesKeptRefusalOf(above)).toEqual({ code: "PLACES_KEPT_ABOVE_CAPACITY", date: null });
    // The box not posted: the row's own 4 against a capacity lowered to 3.
    expect(placesKeptRefusalOf(await refusal(save(row.id, { capacity: "3" })))?.code).toBe("PLACES_KEPT_ABOVE_CAPACITY");
    expect(await reload(row.id)).toMatchObject({ capacity: 10, placesKeptForClub: 4, version: row.version });
    expect(await db.select().from(auditLogs)).toEqual([]);
  });

  it("refuses the places lowered under those taken, with the six numbers", async () => {
    const row = await seedEvent(3);
    await enter(row, "Ana");
    await enter(row, "Bia");
    const refused = await refusal(save(row.id, { capacity: "1" }));
    expect(refused).toBeInstanceOf(CapacityBelowTakenError);
    expect(capacityBelowTakenRefusalOf(refused)).toEqual({
      code: "CAPACITY_BELOW_TAKEN",
      values: { occupied: "2", confirmed: "0", declaration: "2", offered: "0", invited: "0", family: "0" },
      date: null,
    });
    expect((await reload(row.id)).capacity).toBe(3);
  });

  it("a mode switch that nulls the capacity is recorded, not refused — the places kept go to 0 with it", async () => {
    const row = await seedEvent(10, 2);
    await save(row.id, { registrationMode: "NONE" });
    expect(await reload(row.id)).toMatchObject({ capacity: null, placesKeptForClub: 0 });
    expect((await trail("event.capacity_changed")).map((entry) => entry.metadataJson)).toEqual([
      { from: 10, to: null, occupied: 0, offered: 0, via: "editor", version: row.version + 1 },
    ]);
    expect((await trail("event.places_kept_changed")).map((entry) => entry.metadataJson)).toEqual([{ from: 2, to: 0, via: "editor", version: row.version + 1 }]);
  });

  it("a create, a duplicate and the dates of a series start the history; K travels with the places", async () => {
    const created = await createEvent(db, {
      actor: admin,
      fields: {
        ...formFor({ ...(await seedEvent(null)), capacity: 20 } as typeof events.$inferSelect, { placesKeptForClub: "5" }),
        translations: {
          ro: { slug: "noua", title: "Cursa nouă", excerpt: "", seoTitle: "", seoDescription: "" },
          en: { slug: "new-one", title: "The new race", excerpt: "", seoTitle: "", seoDescription: "" },
        },
      },
      now: NOW,
    });
    const createdRows = (await trail("event.capacity_changed")).filter((entry) => entry.entityId === created.id);
    expect(createdRows.map((entry) => entry.metadataJson)).toEqual([{ from: null, to: 20, occupied: 0, offered: 0, via: "create", version: created.version }]);
    expect((await trail("event.places_kept_changed")).filter((entry) => entry.entityId === created.id).map((entry) => entry.metadataJson)).toEqual([
      { from: 0, to: 5, via: "create", version: created.version },
    ]);

    const copy = await duplicateEvent(db, { actor: admin, eventId: created.id, now: NOW });
    expect(copy).toMatchObject({ capacity: 20, placesKeptForClub: 5 });
    expect((await trail("event.capacity_changed")).find((entry) => entry.entityId === copy.id)?.metadataJson).toMatchObject({ from: null, to: 20, via: "duplicate" });

    const source = await seedEvent(30, 3);
    await repeatEvent(db, { actor: admin, eventId: source.id, rule: { cadence: "WEEKLY", weekdays: [], until: "2026-11-01", publish: false }, now: NOW });
    const dates = await db.select().from(events).where(eq(events.repeatOf, source.id));
    expect(dates.length).toBeGreaterThan(0);
    expect(dates.every((date) => date.capacity === 30 && date.placesKeptForClub === 3)).toBe(true);
    const generated = (await trail("event.capacity_changed")).filter((entry) => dates.some((date) => date.id === entry.entityId));
    expect(generated).toHaveLength(dates.length);
    expect(generated.every((entry) => (entry.metadataJson as { via: string }).via === "series_generated")).toBe(true);
  });

  it("a series save writes each date's own row, and refuses K a date's places cannot hold, naming the date", async () => {
    const source = await seedEvent(30);
    await repeatEvent(db, { actor: admin, eventId: source.id, rule: { cadence: "WEEKLY", weekdays: [], until: "2026-11-01", publish: false }, now: NOW });
    const [first, second] = await db.select().from(events).where(eq(events.repeatOf, source.id)).orderBy(asc(events.startsAt));
    await save(source.id, { placesKeptForClub: "5" }, { scope: "all", reason: "Rezerva clubului" });
    const rows = await trail("event.places_kept_changed");
    expect(rows.find((entry) => entry.entityId === source.id)?.metadataJson).toEqual({ from: 0, to: 5, via: "editor", reason: "Rezerva clubului", version: source.version + 1 });
    expect(rows.find((entry) => entry.entityId === first.id)?.metadataJson).toEqual({ from: 0, to: 5, via: "series", reason: "Rezerva clubului", version: first.version + 1 });

    // One date with fewer places of its own than the club would keep: the whole save is refused, the date named.
    await db.update(events).set({ capacity: 4, placesKeptForClub: 0 }).where(eq(events.id, second.id));
    const refused = await refusal(save(source.id, { placesKeptForClub: "6" }, { scope: "all" }));
    expect(placesKeptRefusalOf(refused)).toEqual({ code: "PLACES_KEPT_ABOVE_CAPACITY_DATED", date: toWallTimeInput(second.startsAt, ZONE).slice(0, 10) });
    expect((await reload(source.id)).placesKeptForClub).toBe(5);
  });

  it("«Trimite-i oferta»'s supplementary place carries the row's version, the places taken and the press", async () => {
    const row = await seedEvent(1);
    await enter(row, "Ana");
    const luca = await enter(row, "Luca");
    expect(luca.status).toBe("WAITLISTED");
    await offerPlaceByStaff(db, admin, luca.id, NOW, { addPlaceTo: 2 });
    const [raised] = await trail("event.capacity_raised_for_offer");
    expect(raised.metadataJson).toEqual({ from: 1, to: 2, registrationId: luca.id, version: row.version + 1, occupied: 1, via: "offer" });
  });
});
