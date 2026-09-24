import { asc, eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eventTranslations, events } from "@/db/schema/events";
import { type StaffUser, staffUsers } from "@/db/schema/staff-users";
import {
  duplicateEvent,
  repeatEvent,
  saveEventAndTranslations,
  type SeriesEditScope,
} from "@/modules/content/events/service";
import { readEventLinks } from "@/modules/events/domain/links";
import { findPublishedEventBySlug } from "@/modules/events/repository";
import { isDomainError } from "@/shared/errors/domain-error";
import { expectViolation, SQLSTATE } from "../../helpers/constraints";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";

/**
 * BR-REQ-011-01 criterion 20 (`DECISIONS.md` §332) — "Linkuri și fișiere", saved through the
 * editor's service and read back by the public page's query: the order kept, the spare line
 * dropped, a bad row refused by its number with nothing written, an empty list stored as none,
 * a caller that says nothing leaving the column alone; the database refusing what the form
 * would, whatever writes it; and the links being the series' — carried to every repeated date,
 * by a series edit, and by a duplicate, like the route.
 */
const NOW = new Date("2026-09-19T10:00:00.000Z");
const ZONE = "Europe/Bucharest";

const FIELDS = {
  type: "RACE",
  eventStatus: "SCHEDULED",
  timezone: ZONE,
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

const DRIVE = ["https:/", "drive.example.test", "file", "d", "gpx21", "view"].join("/");
const PDF = ["https:/", "files.example.test", "regulament.pdf"].join("/");

/** What the editor posts: two links and the spare line. */
const POSTED = [
  { kind: "GPX", url: DRIVE, labelRo: "Traseul de 21 km", labelEn: "The 21 km route" },
  { kind: "DOCUMENT", url: PDF, labelRo: "", labelEn: "" },
  { kind: "OTHER", url: "", labelRo: "", labelEn: "" },
];
const STORED = [
  { kind: "GPX", url: DRIVE, labelRo: "Traseul de 21 km", labelEn: "The 21 km route" },
  { kind: "DOCUMENT", url: PDF, labelRo: null, labelEn: null },
];

let db: TestDatabase;
let close: () => Promise<void>;
let organizer: StaffUser;

beforeAll(async () => {
  ({ db, close } = await createTestDatabase());
});
afterAll(async () => {
  await close();
});

beforeEach(async () => {
  await resetTables(db);
  [organizer] = await db
    .insert(staffUsers)
    .values({ email: "organizer@dev.test", displayName: "Organizer", role: "ADMIN" })
    .returning();
});

async function createDraft(type: "RACE" | "GROUP_RUN" = "RACE", slug = "crosul") {
  const [event] = await db
    .insert(events)
    .values({ type, startsAt: new Date("2026-10-11T06:00:00.000Z"), timezone: ZONE, locationName: "Parcul Tractorul" })
    .returning();
  await db.insert(eventTranslations).values(
    (["ro", "en"] as const).map((locale) => ({ eventId: event.id, locale, slug: `${slug}-${locale}`, title: `Crosul ${locale}`, excerpt: "x" })),
  );
  return event;
}

const reload = async (id: string) => (await db.select().from(events).where(eq(events.id, id)))[0];

function save(eventId: string, version: number, fields: Record<string, unknown>, scope?: SeriesEditScope) {
  return saveEventAndTranslations(db, { actor: organizer, eventId, expectedVersion: version, fields, translations: [], scope, now: NOW });
}

async function codeOf(operation: Promise<unknown>): Promise<string> {
  try {
    await operation;
    return "no error";
  } catch (error) {
    if (isDomainError(error)) return `${error.code}: ${error.message} [${error.fields.join(", ")}]`;
    throw error;
  }
}

describe("BR-REQ-011-01 criterion 20 saving the links", () => {
  it("stores them in the editor's order without the spare line, and the public page reads them back", async () => {
    const event = await createDraft();
    await save(event.id, event.version, { ...FIELDS, links: POSTED });
    expect((await reload(event.id)).links).toEqual(STORED);

    await db.update(events).set({ editorialStatus: "PUBLISHED", publishedAt: NOW }).where(eq(events.id, event.id));
    const page = await findPublishedEventBySlug(db, "en", "crosul-en");
    expect(readEventLinks(page?.links)).toEqual(STORED);
  });

  it("refuses a row whose address is not https, by its number, and writes nothing", async () => {
    const event = await createDraft();
    const refusal = await codeOf(save(event.id, event.version, { ...FIELDS, links: [POSTED[0], { kind: "MAP", url: "http://maps.example.test/x" }] }));
    expect(refusal).toContain("VALIDATION_ERROR");
    expect(refusal).toContain("link 2: the address must start with https://");
    expect(refusal).toContain("[links.1.url]");
    const row = await reload(event.id);
    expect(row.links).toBeNull();
    expect(row.version).toBe(event.version);
  });

  it("stores no links as null — removing every row clears them", async () => {
    const event = await createDraft();
    await save(event.id, event.version, { ...FIELDS, links: POSTED });
    await save(event.id, (await reload(event.id)).version, { ...FIELDS, links: [{ kind: "OTHER", url: "", labelRo: "", labelEn: "" }] });
    expect((await reload(event.id)).links).toBeNull();
  });

  it("leaves the links alone when a caller says nothing about them (§169)", async () => {
    const event = await createDraft();
    await save(event.id, event.version, { ...FIELDS, links: POSTED });
    await save(event.id, (await reload(event.id)).version, { ...FIELDS, distanceMeters: "21000" });
    const row = await reload(event.id);
    expect(row.distanceMeters).toBe(21000);
    expect(row.links).toEqual(STORED);
  });

  it("keeps them on a group run, which has a route but no programme (§111)", async () => {
    const event = await createDraft("GROUP_RUN");
    await save(event.id, event.version, { ...FIELDS, type: "GROUP_RUN", links: POSTED });
    expect((await reload(event.id)).links).toEqual(STORED);
  });
});

describe("BR-REQ-011-01 criterion 20 the database's own rule", () => {
  const write = async (links: unknown) => {
    const event = await createDraft("RACE", `raw-${Math.random().toString(36).slice(2, 8)}`);
    // A hand-written UPDATE, the path the form's checks never see.
    return db.execute(sql`UPDATE events SET links = ${JSON.stringify(links)}::jsonb WHERE id = ${event.id}`);
  };
  const refused = { code: SQLSTATE.CHECK_VIOLATION, constraint: "events_links_is_a_short_array_of_https_links" };

  it("accepts a list of https links, up to twelve, and null", async () => {
    await write(STORED);
    await write(Array.from({ length: 12 }, (_, index) => ({ kind: "OTHER", url: `${DRIVE}?n=${index}` })));
    await write([]);
    const event = await createDraft("RACE", "nul");
    await db.update(events).set({ links: null }).where(eq(events.id, event.id));
  });

  it("refuses an address that is not https, a missing one, a thirteenth link, and anything that is not a list", async () => {
    await expectViolation(write([{ kind: "GPX", url: "http://drive.example.test/x" }]), refused);
    await expectViolation(write([{ kind: "GPX", url: "javascript:alert(1)" }]), refused);
    await expectViolation(write([{ kind: "GPX" }]), refused);
    await expectViolation(write([{ kind: "GPX", url: 42 }]), refused);
    await expectViolation(write(["https://drive.example.test/x"]), refused);
    await expectViolation(write(Array.from({ length: 13 }, (_, index) => ({ kind: "OTHER", url: `${DRIVE}?n=${index}` }))), refused);
    await expectViolation(write({ kind: "GPX", url: DRIVE }), refused);
    await expectViolation(write("x"), refused);
  });
});

describe("BR-REQ-011-01 criterion 20 the links are the series'", () => {
  it("are carried onto every repeated date and by a duplicate, like the route", async () => {
    const event = await createDraft();
    await save(event.id, event.version, { ...FIELDS, links: POSTED });
    await repeatEvent(db, { actor: organizer, eventId: event.id, rule: { cadence: "WEEKLY", weekdays: [], until: "2026-11-01", publish: false }, now: NOW });
    const dates = await db.select().from(events).where(eq(events.repeatOf, event.id)).orderBy(asc(events.startsAt));
    expect(dates).toHaveLength(3);
    for (const date of dates) expect(date.links).toEqual(STORED);

    const copy = await duplicateEvent(db, { actor: organizer, eventId: event.id });
    expect(copy.links).toEqual(STORED);
  });

  it("travel with a series edit to every date, and a save that changed nothing carries nothing", async () => {
    const event = await createDraft();
    await repeatEvent(db, { actor: organizer, eventId: event.id, rule: { cadence: "WEEKLY", weekdays: [], until: "2026-11-01", publish: false }, now: NOW });
    const dates = await db.select().from(events).where(eq(events.repeatOf, event.id)).orderBy(asc(events.startsAt));
    expect(dates.every((date) => date.links === null)).toBe(true);

    // The source is saved with its links for the whole series.
    const source = await reload(event.id);
    const result = await save(source.id, source.version, { ...FIELDS, links: POSTED }, "all");
    expect(result.appliedTo).toBe(3);
    for (const date of dates) expect((await reload(date.id)).links).toEqual(STORED);

    // An editor that posts the rows it was given changes nothing, and reaches nobody.
    const again = await reload(event.id);
    expect((await save(again.id, again.version, { ...FIELDS, links: POSTED }, "all")).appliedTo).toBe(0);

    // A row that never had links and a list with every row removed are one value: no change.
    const fresh = await createDraft("RACE", "fara-linkuri");
    await repeatEvent(db, { actor: organizer, eventId: fresh.id, rule: { cadence: "WEEKLY", weekdays: [], until: "2026-10-25", publish: false }, now: NOW });
    const unsaved = await reload(fresh.id);
    expect((await save(unsaved.id, unsaved.version, { ...FIELDS, links: [] }, "all")).appliedTo).toBe(0);
  });
});
