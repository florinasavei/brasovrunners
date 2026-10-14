import { asc, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eventTranslations, events } from "@/db/schema/events";
import { type StaffUser, staffUsers } from "@/db/schema/staff-users";
import { createEventAndPublish, duplicateEvent, repeatEvent, saveEventAndTranslations } from "@/modules/content/events/service";
import { changeCheckpoints, listCheckpoints, SavedCheckpointsRefusal } from "@/modules/event-checkpoints/checkpoints";
import type { PostedCheckpoint } from "@/modules/event-checkpoints/domain/checkpoint";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";

/**
 * §757, §NNN, BR-REQ-050-02 — the checkpoints' rules hold after every save, not only their own card's: an
 * event save that shortens «Timp limită» under a saved point's time limit or shortens the route under a
 * point is refused naming «Puncte de control» and the rule, writing nothing; a save that keeps them true
 * goes through — and one that moves the gun moves every clock and no limit, which is the point of a
 * time limit. On a series the other dates the save reaches are held to the same rules, the refusal naming
 * the date. «Duplică» and a series' new dates carry the checkpoints.
 */
const NOW = new Date("2026-10-14T10:00:00.000Z");

/** A 21.1 km race: the meeting at 09:00, the gun at 09:30, «Timp limită» three hours — the finish closes at 12:30. */
const RACE = {
  type: "RACE",
  surface: null,
  eventStatus: "SCHEDULED",
  timezone: "Europe/Bucharest",
  startsAtWallTime: "2026-11-21T09:00",
  endsAtWallTime: "",
  durationMinutes: "180",
  raceStartsAtWallTime: "2026-11-21T09:30",
  scheduleRows: [],
  stravaEventUrl: "",
  facebookEventUrl: "",
  coHosts: [],
  links: [],
  locationName: "Parcul Tractorul",
  locationAddress: null,
  locationToBeAnnounced: false,
  difficulty: null,
  costType: null,
  costAmount: "",
  costUrl: "",
  mapUrl: "",
  routeUrl: "",
  distanceMeters: "21100",
  elevationGainMeters: "",
  featured: false,
  isSpecial: false,
  registrationMode: "NONE",
  capacity: "",
  bibStartNumber: "",
  bibColour: "",
  confirmationOpensDaysBefore: "",
  confirmationDeadlineDaysBefore: "",
  minAge: "",
  registrationOpensAtWallTime: "",
  registrationClosesAtWallTime: "",
  declarationDocumentId: "",
  participantListVisibility: "HIDDEN" as const,
  externalProvider: "",
  externalRegistrationUrl: "",
};

const TRANSLATIONS = {
  ro: { slug: "crosul-punctelor", title: "Crosul punctelor", excerpt: "Cu puncte de control." },
  en: { slug: "checkpoint-cross", title: "Checkpoint cross", excerpt: "With checkpoints." },
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
});

const reload = async (id: string) => (await db.select().from(events).where(eq(events.id, id)))[0];

const posted = (index: number, over: Partial<PostedCheckpoint>): PostedCheckpoint => ({
  id: "",
  nameRo: "",
  nameEn: "",
  km: "",
  kinds: [],
  cutoffHours: "",
  cutoffMinutesPart: "",
  noteRo: "",
  noteEn: "",
  remove: false,
  index,
  ...over,
});

/** A time limit in minutes as the card's two boxes post it. */
const limit = (minutes: number) => ({ cutoffHours: String(Math.floor(minutes / 60)), cutoffMinutesPart: String(minutes % 60) });

/** The race, with water at km 5 closing 30 minutes after the gun (10:00) and timing at km 20 closing 150 minutes after it (12:00). */
async function raceWithCheckpoints() {
  const { event } = await createEventAndPublish(db, { actor: admin, fields: { ...RACE, translations: TRANSLATIONS }, publish: false, now: NOW });
  await changeCheckpoints(
    db,
    admin,
    {
      kind: "save",
      eventId: event.id,
      rows: [
        posted(0, { nameRo: "Apă", nameEn: "Water", km: "5", kinds: ["WATER"], ...limit(30) }),
        posted(1, { nameRo: "Cronometrare", nameEn: "Timing", km: "20", kinds: ["TIMING"], ...limit(150) }),
      ],
    },
    NOW,
  );
  return event;
}

async function save(eventId: string, changes: Record<string, unknown>, scope: "this" | "all" = "this") {
  const row = await reload(eventId);
  const translations = await db.select().from(eventTranslations).where(eq(eventTranslations.eventId, eventId));
  return saveEventAndTranslations(db, {
    actor: admin,
    eventId,
    expectedVersion: row.version,
    fields: { ...RACE, ...changes },
    translations: translations.map((translation) => ({
      translationId: translation.id,
      expectedVersion: translation.version,
      fields: { slug: translation.slug, title: translation.title, excerpt: translation.excerpt ?? "" },
    })),
    scope,
    now: NOW,
  });
}

async function refusalOf(operation: Promise<unknown>): Promise<SavedCheckpointsRefusal> {
  const error = await operation.then(
    () => null,
    (caught: unknown) => caught,
  );
  if (error instanceof SavedCheckpointsRefusal) return error;
  throw new Error(`expected the saved checkpoints to refuse the save, got ${String(error)}`);
}

describe("§757 an event save holds the saved checkpoints to their rules", () => {
  it("lets the gun move: every clock follows it and no time limit changes (§NNN)", async () => {
    const event = await raceWithCheckpoints();
    expect((await listCheckpoints(db, event.id)).map((row) => [row.cutoffMinutes, row.cutoffClock])).toEqual([
      [30, "10:00"],
      [150, "12:00"],
    ]);
    // A quarter of an hour later, past what a time of the day would have allowed for the water point's old 10:00.
    await save(event.id, { raceStartsAtWallTime: "2026-11-21T10:15" });
    expect((await reload(event.id)).raceStartsAt?.toISOString()).toBe("2026-11-21T08:15:00.000Z");
    expect((await listCheckpoints(db, event.id)).map((row) => [row.cutoffMinutes, row.cutoffClock])).toEqual([
      [30, "10:45"],
      [150, "12:45"],
    ]);
  });

  it("refuses shortening the route under a saved point, saying the new length", async () => {
    const event = await raceWithCheckpoints();
    const refused = await refusalOf(save(event.id, { distanceMeters: "15000" }));
    expect(refused.refusal.reason).toBe("CHECKPOINT_KM_BEYOND_ROUTE");
    expect(refused.refusal.values).toMatchObject({ name: "Cronometrare", km: "20", max: "15" });
    expect((await reload(event.id)).distanceMeters).toBe(21_100);
  });

  it("refuses shortening «Timp limită» under a saved time limit, saying both durations", async () => {
    const event = await raceWithCheckpoints();
    const before = await reload(event.id);
    // Two hours from the gun: shorter than the timing point's two and a half.
    const refused = await refusalOf(save(event.id, { durationMinutes: "120" }));
    expect(refused.code).toBe("VALIDATION_ERROR");
    expect(refused.fields).toEqual(["checkpoints"]);
    expect(refused.date).toBeNull();
    expect(refused.refusal.reason).toBe("CHECKPOINT_CUTOFF_AFTER_END");
    expect(refused.refusal.values).toMatchObject({ name: "Cronometrare", cutoff: "2 h 30 min", limit: "2 h" });
    const after = await reload(event.id);
    expect(after.version).toBe(before.version);
    expect(after.endsAt?.toISOString()).toBe(before.endsAt?.toISOString());
    // Exactly as long as the longest limit is fine.
    await save(event.id, { durationMinutes: "150" });
    expect((await reload(event.id)).endsAt?.toISOString()).toBe("2026-11-21T10:00:00.000Z");
  });

  it("keeps a saved time limit when the start's hour is later said to be announced: a duration needs no hour to stay true", async () => {
    const event = await raceWithCheckpoints();
    const minutes = (await listCheckpoints(db, event.id)).map((row) => row.cutoffMinutes);
    await save(event.id, { startsAtWallTime: "2026-11-21", raceStartsAtWallTime: "", timeToBeAnnounced: true });
    expect((await listCheckpoints(db, event.id)).map((row) => [row.cutoffMinutes, row.cutoffClock])).toEqual([
      [minutes[0], null],
      [minutes[1], null],
    ]);
  });

  it("still holds the saved limits to a shortened «Timp limită» while the start's hour is to be announced: minutes against minutes", async () => {
    const event = await raceWithCheckpoints();
    await save(event.id, { startsAtWallTime: "2026-11-21", raceStartsAtWallTime: "", timeToBeAnnounced: true });
    const unsaid = await reload(event.id);
    // No hour, no gun: nothing to say a clock from, yet one hour is shorter than the timing point's two and a half.
    const refused = await refusalOf(save(event.id, { startsAtWallTime: "2026-11-21", raceStartsAtWallTime: "", timeToBeAnnounced: true, durationMinutes: "60" }));
    expect(refused.refusal.reason).toBe("CHECKPOINT_CUTOFF_AFTER_END");
    expect(refused.refusal.values).toMatchObject({ name: "Cronometrare", cutoff: "2 h 30 min", limit: "1 h" });
    expect((await reload(event.id)).endsAt?.toISOString()).toBe(unsaid.endsAt?.toISOString());
    // A limit that still covers the longest point is accepted.
    await save(event.id, { startsAtWallTime: "2026-11-21", raceStartsAtWallTime: "", timeToBeAnnounced: true, durationMinutes: "150" });
    expect((await listCheckpoints(db, event.id)).map((row) => row.cutoffMinutes)).toEqual([30, 150]);
  });

  it("lets every save through that keeps the points true, and never touches them", async () => {
    const event = await raceWithCheckpoints();
    const points = await listCheckpoints(db, event.id);
    await save(event.id, { distanceMeters: "21500", raceStartsAtWallTime: "2026-11-21T09:45", locationName: "Pietrele lui Solomon" });
    const after = await reload(event.id);
    expect(after.distanceMeters).toBe(21_500);
    // The minutes stay as they were; only the clocks moved with the gun (a quarter of an hour earlier than 09:30 is later: 09:45).
    const identity = (rows: typeof points) => rows.map((row) => [row.id, row.km, row.nameRo, row.cutoffMinutes]);
    expect(identity(await listCheckpoints(db, event.id))).toEqual(identity(points));
    expect((await listCheckpoints(db, event.id)).map((row) => row.cutoffClock)).toEqual(["10:15", "12:15"]);
  });
});

describe("§757 the checkpoints on a copy and on a series", () => {
  it("«Duplică» copies the checkpoints with the route", async () => {
    const event = await raceWithCheckpoints();
    const copy = await duplicateEvent(db, { actor: admin, eventId: event.id, now: NOW });
    expect((await listCheckpoints(db, copy.id)).map((row) => [row.km, row.nameRo, row.nameEn, row.kinds, row.cutoffMinutes])).toEqual([
      [5, "Apă", "Water", ["WATER"], 30],
      [20, "Cronometrare", "Timing", ["TIMING"], 150],
    ]);
    // The source keeps its own.
    expect(await listCheckpoints(db, event.id)).toHaveLength(2);
  });

  it("gives a series' new dates the checkpoints, and holds every date a save reaches to them, naming the date", async () => {
    const source = await raceWithCheckpoints();
    const { created } = await repeatEvent(db, { actor: admin, eventId: source.id, rule: { cadence: "WEEKLY", weekdays: [], until: "2026-12-01", publish: false }, now: NOW });
    expect(created).toBeGreaterThan(0);
    const [date] = await db.select().from(events).where(eq(events.repeatOf, source.id)).orderBy(asc(events.startsAt));
    expect(await listCheckpoints(db, date.id)).toHaveLength(2);

    // The source's own points go; the date's stay — a «Timp limită» shortened on every date breaks the date's timing limit.
    const sourcePoints = await listCheckpoints(db, source.id);
    await changeCheckpoints(
      db,
      admin,
      { kind: "save", eventId: source.id, rows: sourcePoints.map((row, index) => posted(index, { id: row.id, nameRo: row.nameRo, nameEn: row.nameEn, km: String(row.km), remove: true })) },
      NOW,
    );
    const refused = await refusalOf(save(source.id, { durationMinutes: "120" }, "all"));
    expect(refused.date).toBe("2026-11-28");
    expect(refused.refusal.reason).toBe("CHECKPOINT_CUTOFF_AFTER_END");
    // Nothing written on any date.
    expect((await reload(source.id)).endsAt?.toISOString()).toBe("2026-11-21T10:30:00.000Z");
  });
});
