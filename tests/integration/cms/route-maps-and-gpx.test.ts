import { asc, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eventTranslations, events } from "@/db/schema/events";
import { type StaffUser, staffUsers } from "@/db/schema/staff-users";
import { isDomainError } from "@/shared/errors/domain-error";
import { expectViolation, SQLSTATE } from "../../helpers/constraints";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";

/**
 * BR-REQ-050-02 and BR-REQ-011-01 (§718) — «Traseul»'s Strava and Garmin Connect maps and its GPX,
 * end to end: saved through the editor's service from what the club pasted (ids only, never the
 * HTML), cleared per field, refused naming the field, held by the database's own CHECKs, read back
 * by the public query, carried by a series edit, a repeat and a duplicate; the GPX uploaded through
 * its route (checked for what it is, only by whoever may change the event), served as a file to
 * save, deleted when the last date naming it lets go — and never touched by the pictures' sweep.
 * Every id, token and track here is invented.
 */
const state = vi.hoisted(() => ({ actor: undefined as unknown }));
vi.mock("@/modules/staff-identity/session", () => ({
  DEV_STAFF_COOKIE: "dev-staff",
  requireStaff: async () => state.actor,
  requireStaffCapability: async () => state.actor,
}));

const { deleteEvent, duplicateEvent, hardDeleteEvent, repeatEvent, saveEventAndTranslations } = await import("@/modules/content/events/service");
const { findPublishedEventBySlug } = await import("@/modules/events/repository");
const { sweepOrphanAssets } = await import("@/modules/media/references");
const { getStorage, readLocalObject } = await import("@/modules/media/storage");
const { storeRouteGpx } = await import("@/modules/content/events/route-gpx");
const { POST: uploadGpx } = await import("@/app/api/admin/route-gpx/route");
const { GET: serveMedia } = await import("@/app/api/media/[...key]/route");

const NOW = new Date("2026-10-11T10:00:00.000Z");
const ZONE = "Europe/Bucharest";
const STRAVA_ID = "1111222233334444555";
const GARMIN_ID = "987654321";
const TOKEN = "abc123def456abc123def456abc123def456abcd";
const STRAVA_EMBED = `<div class="strava-embed-placeholder" data-embed-type="route" data-embed-id="${STRAVA_ID}" data-style="hybrid" data-map-hash="11.66/45.6375/25.5935" data-from-embed="false" data-token="${TOKEN}"></div><script src="https://strava-embeds.com/embed.js"></script>`;
const GARMIN_LINK = `https://connect.garmin.com/modern/course/${GARMIN_ID}`;
const TRACK = Buffer.from(`<?xml version="1.0"?><gpx version="1.1" creator="test"><trk><trkseg><trkpt lat="45.63" lon="25.59"/></trkseg></trk></gpx>`);

const FIELDS = {
  type: "GROUP_RUN",
  eventStatus: "SCHEDULED",
  timezone: ZONE,
  startsAtWallTime: "2026-10-14T19:00",
  endsAtWallTime: "",
  raceStartsAtWallTime: "",
  locationName: "Tâmpa",
  locationAddress: "",
  surface: "TRAIL",
  difficulty: null,
  costType: "FREE",
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

let db: TestDatabase;
let close: () => Promise<void>;
let admin: StaffUser;

beforeAll(async () => {
  ({ db, close } = await createTestDatabase());
});
afterAll(async () => close());

beforeEach(async () => {
  await resetTables(db);
  [admin] = await db.insert(staffUsers).values({ email: "admin@dev.test", displayName: "Admin", role: "ADMIN" }).returning();
  state.actor = admin;
});

async function createDraft(slug = "tampa") {
  const [event] = await db
    .insert(events)
    .values({ type: "GROUP_RUN", startsAt: new Date("2026-10-14T16:00:00.000Z"), timezone: ZONE, locationName: "Tâmpa" })
    .returning();
  await db.insert(eventTranslations).values(
    (["ro", "en"] as const).map((locale) => ({ eventId: event.id, locale, slug: `${slug}-${locale}`, title: `Tâmpa ${locale}`, excerpt: "x" })),
  );
  return event;
}

const reload = async (id: string) => (await db.select().from(events).where(eq(events.id, id)))[0];

function save(eventId: string, version: number, fields: Record<string, unknown>, scope?: "this" | "following" | "all") {
  return saveEventAndTranslations(db, { actor: admin, eventId, expectedVersion: version, fields, translations: [], scope, now: NOW });
}

async function refusal(operation: Promise<unknown>): Promise<string> {
  try {
    await operation;
    return "no error";
  } catch (error) {
    if (isDomainError(error)) return `${error.code} [${error.fields.join(", ")}]`;
    throw error;
  }
}

const upload = () => storeRouteGpx(getStorage(), { bytes: TRACK, name: "Traseu Tâmpa.gpx", environment: "test", now: NOW });

describe("BR-REQ-050-02 the maps are saved from what the club pasted (§718)", () => {
  it("stores the ids and Strava's three values — never the pasted HTML — Strava first (§738), and the public page reads them", async () => {
    const event = await createDraft();
    await save(event.id, event.version, { ...FIELDS, routeStrava: STRAVA_EMBED, routeGarmin: GARMIN_LINK });
    const row = await reload(event.id);
    expect(row.routeMaps).toEqual([
      { provider: "strava", id: STRAVA_ID, style: "hybrid", mapHash: "11.66/45.6375/25.5935", token: TOKEN },
      { provider: "garmin", id: GARMIN_ID },
    ]);
    expect(JSON.stringify(row.routeMaps)).not.toMatch(/[<>]|script|embed\.js/);

    await db.update(events).set({ editorialStatus: "PUBLISHED", publishedAt: NOW }).where(eq(events.id, event.id));
    expect((await findPublishedEventBySlug(db, "ro", "tampa-ro"))?.routeMaps).toEqual(row.routeMaps);
  });

  it("clears each field on its own, and a caller that posts neither leaves the maps alone", async () => {
    const event = await createDraft();
    await save(event.id, event.version, { ...FIELDS, routeStrava: STRAVA_EMBED, routeGarmin: GARMIN_LINK });
    let row = await reload(event.id);
    await save(row.id, row.version, { ...FIELDS, routeStrava: "", routeGarmin: GARMIN_LINK });
    row = await reload(event.id);
    expect(row.routeMaps).toEqual([{ provider: "garmin", id: GARMIN_ID }]);
    // Saved without the two boxes (a fixture, a script): nothing about the maps changes.
    await save(row.id, row.version, { ...FIELDS });
    row = await reload(event.id);
    expect(row.routeMaps).toEqual([{ provider: "garmin", id: GARMIN_ID }]);
    await save(row.id, row.version, { ...FIELDS, routeStrava: "", routeGarmin: "" });
    expect((await reload(event.id)).routeMaps).toBeNull();
  });

  it("refuses a paste it does not recognise, naming the box, and writes nothing", async () => {
    const event = await createDraft();
    expect(await refusal(save(event.id, event.version, { ...FIELDS, routeStrava: `<script>alert(1)</script>`, routeGarmin: "" }))).toBe(
      "VALIDATION_ERROR [routeStrava]",
    );
    expect(await refusal(save(event.id, event.version, { ...FIELDS, routeStrava: "", routeGarmin: "https://connect.garmin.com/modern/course/12ab" }))).toBe(
      "VALIDATION_ERROR [routeGarmin]",
    );
    expect((await reload(event.id)).version).toBe(event.version);
    expect((await reload(event.id)).routeMaps).toBeNull();
  });

  it("is held by the database too: no third service, no id with a letter, no GPX key off its shape", async () => {
    const event = await createDraft();
    for (const routeMaps of [[{ provider: "komoot", id: "1" }], [{ provider: "strava", id: "12a" }], { provider: "strava", id: "1" }, [1, 2, 3]]) {
      await expectViolation(db.update(events).set({ routeMaps }).where(eq(events.id, event.id)), {
        code: SQLSTATE.CHECK_VIOLATION,
        constraint: "events_route_maps_is_a_short_array_of_ids",
      });
    }
    for (const routeGpx of [{ key: "https://evil.example.test/x.gpx" }, { name: "x" }, "test/route-gpx/x.gpx"]) {
      await expectViolation(db.update(events).set({ routeGpx }).where(eq(events.id, event.id)), {
        code: SQLSTATE.CHECK_VIOLATION,
        constraint: "events_route_gpx_names_a_gpx_key",
      });
    }
  });

  it("travel with a repeat, a series edit and a duplicate, like the route", async () => {
    const event = await createDraft();
    const gpx = await upload();
    await save(event.id, event.version, { ...FIELDS, routeGarmin: GARMIN_LINK, routeStrava: "", routeGpx: JSON.stringify(gpx) });
    await repeatEvent(db, { actor: admin, eventId: event.id, rule: { cadence: "WEEKLY", weekdays: [], until: "2026-11-01", publish: false }, now: NOW });
    const dates = await db.select().from(events).where(eq(events.repeatOf, event.id)).orderBy(asc(events.startsAt));
    expect(dates.length).toBeGreaterThan(0);
    for (const date of dates) {
      expect(date.routeMaps).toEqual([{ provider: "garmin", id: GARMIN_ID }]);
      expect(date.routeGpx).toEqual(gpx);
    }

    const source = await reload(event.id);
    await save(source.id, source.version, { ...FIELDS, routeGarmin: GARMIN_LINK, routeStrava: `https://www.strava.com/routes/${STRAVA_ID}`, routeGpx: JSON.stringify(gpx) }, "all");
    for (const date of await db.select().from(events).where(eq(events.repeatOf, event.id))) {
      expect(date.routeMaps).toEqual([
        { provider: "strava", id: STRAVA_ID },
        { provider: "garmin", id: GARMIN_ID },
      ]);
    }

    const copy = await duplicateEvent(db, { actor: admin, eventId: event.id });
    expect(copy.routeMaps).toEqual((await reload(event.id)).routeMaps);
    expect(copy.routeGpx).toEqual(gpx);
  });
});

describe("BR-REQ-050-02 the GPX file (§718)", () => {
  it("is uploaded only by whoever may change the event, checked for what it is, and stored as given", async () => {
    const post = (file: File) => {
      const body = new FormData();
      body.append("file", file);
      return uploadGpx(new Request("http://localhost/api/admin/route-gpx", { method: "POST", body }));
    };
    const answer = await post(new File([TRACK], "Traseu Tâmpa.gpx", { type: "application/octet-stream" }));
    expect(answer.status).toBe(201);
    const gpx = (await answer.json()) as { key: string; name: string; size: number };
    expect(gpx.key).toMatch(/^test\/route-gpx\/[0-9a-f-]{36}\/traseu-tampa\.gpx$/);
    expect(gpx).toMatchObject({ name: "Traseu Tâmpa.gpx", size: TRACK.byteLength });
    expect((await readLocalObject(gpx.key))?.body.equals(TRACK)).toBe(true);

    // Called .gpx, but a picture's bytes: refused, nothing stored.
    const fake = await post(new File([Buffer.from("not xml at all")], "track.gpx"));
    expect(fake.status).toBe(400);
    expect(await fake.json()).toMatchObject({ detail: "notXml" });
    const kml = await post(new File([Buffer.from(`<?xml version="1.0"?><kml></kml>`)], "track.gpx"));
    expect(await kml.json()).toMatchObject({ detail: "notGpx" });

    // An Organizer reads the event and changes nothing on it (§542): no upload either.
    const [organizer] = await db.insert(staffUsers).values({ email: "org@dev.test", displayName: "Org", role: "MODERATOR" }).returning();
    state.actor = organizer;
    expect((await post(new File([TRACK], "track.gpx"))).status).toBe(403);
  });

  it("is served as a file to save, under its own name", async () => {
    const gpx = await upload();
    const response = await serveMedia(new Request(`http://localhost/api/media/${gpx.key}`), { params: Promise.resolve({ key: gpx.key.split("/") }) });
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/gpx+xml");
    expect(response.headers.get("content-disposition")).toBe('attachment; filename="traseu-tampa.gpx"');
    expect(Buffer.from(await response.arrayBuffer()).equals(TRACK)).toBe(true);
  });

  it("refuses another environment's key at the save", async () => {
    const event = await createDraft();
    const foreign = { key: "production/route-gpx/0123abcd-0123-4abc-8def-0123456789ab/x.gpx", name: "x.gpx", size: 1, uploadedAt: NOW.toISOString() };
    expect(await refusal(save(event.id, event.version, { ...FIELDS, routeGpx: JSON.stringify(foreign) }))).toBe("VALIDATION_ERROR [routeGpx]");
    expect(await refusal(save(event.id, event.version, { ...FIELDS, routeGpx: "not json" }))).toBe("VALIDATION_ERROR [routeGpx]");
  });

  it("stays in the store while any date names it, and goes when the last one lets go", async () => {
    const event = await createDraft();
    const gpx = await upload();
    await save(event.id, event.version, { ...FIELDS, routeGpx: JSON.stringify(gpx) });
    const copy = await duplicateEvent(db, { actor: admin, eventId: event.id });

    // Removed from the first: the copy still names it, so the file stays.
    const first = await reload(event.id);
    await save(first.id, first.version, { ...FIELDS, routeGpx: "" });
    expect((await reload(event.id)).routeGpx).toBeNull();
    expect(await readLocalObject(gpx.key)).not.toBeNull();

    // Replaced on the copy: nobody names the old file any more, so it goes; the new one stays.
    const replacement = await upload();
    const second = await reload(copy.id);
    await save(second.id, second.version, { ...FIELDS, routeGpx: JSON.stringify(replacement) });
    expect(await readLocalObject(gpx.key)).toBeNull();
    expect(await readLocalObject(replacement.key)).not.toBeNull();

    // Erased with its event.
    const titled = await db.select().from(eventTranslations).where(eq(eventTranslations.eventId, copy.id));
    await hardDeleteEvent(db, { actor: { ...admin, role: "SUPERADMIN" }, eventId: copy.id, reason: "test", typedTitle: titled[0].title, now: NOW });
    expect(await readLocalObject(replacement.key)).toBeNull();
  });

  it("goes with an ordinary delete of its last holder, and stays while another date names it", async () => {
    const event = await createDraft();
    const gpx = await upload();
    await save(event.id, event.version, { ...FIELDS, routeGpx: JSON.stringify(gpx) });
    const copy = await duplicateEvent(db, { actor: admin, eventId: event.id });

    await deleteEvent(db, { actor: admin, eventId: copy.id });
    expect(await readLocalObject(gpx.key)).not.toBeNull();

    await deleteEvent(db, { actor: admin, eventId: event.id });
    expect(await readLocalObject(gpx.key)).toBeNull();
  });

  it("lets go of the file a series save writes over on another date, not only this date's", async () => {
    const event = await createDraft();
    const first = await upload();
    await save(event.id, event.version, { ...FIELDS, routeGpx: JSON.stringify(first) });
    await repeatEvent(db, { actor: admin, eventId: event.id, rule: { cadence: "WEEKLY", weekdays: [], until: "2026-11-01", publish: false }, now: NOW });
    const [date] = await db.select().from(events).where(eq(events.repeatOf, event.id)).orderBy(asc(events.startsAt));

    // One date takes a file of its own, "from this date" style: only it changes.
    const own = await upload();
    await save(date.id, date.version, { ...FIELDS, startsAtWallTime: "2026-10-21T19:00", routeGpx: JSON.stringify(own) });
    expect((await reload(date.id)).routeGpx).toEqual(own);

    // The source then replaces the series' file on every date: both old objects have no holder left.
    const next = await upload();
    const source = await reload(event.id);
    await save(source.id, source.version, { ...FIELDS, routeGpx: JSON.stringify(next) }, "all");
    expect((await reload(date.id)).routeGpx).toEqual(next);
    expect(await readLocalObject(first.key)).toBeNull();
    expect(await readLocalObject(own.key)).toBeNull();
    expect(await readLocalObject(next.key)).not.toBeNull();
  });

  it("is never taken by the pictures' sweep (§17, §73): it is no picture row", async () => {
    const event = await createDraft();
    const gpx = await upload();
    await save(event.id, event.version, { ...FIELDS, routeGpx: JSON.stringify(gpx) });
    const later = new Date(NOW.getTime() + 60 * 24 * 60 * 60_000);
    await sweepOrphanAssets(db, later);
    expect(await readLocalObject(gpx.key)).not.toBeNull();
    expect((await reload(event.id)).routeGpx).toEqual(gpx);
  });
});
