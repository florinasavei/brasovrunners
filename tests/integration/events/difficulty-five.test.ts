import { readFileSync } from "node:fs";
import path from "node:path";
import { asc, eq, inArray, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { events } from "@/db/schema/events";
import { type StaffUser, staffUsers } from "@/db/schema/staff-users";
import { createEvent, saveEventFields } from "@/modules/content/events/service";
import { DIFFICULTY_BANDS, type DifficultyBand, difficultyBandOf } from "@/modules/events/domain/difficulty";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";

/**
 * BR-REQ-041-01 (`DECISIONS.md` §412) — five difficulty levels (the owner, 2026-09-25: "vreau să
 * fie foarte ușor, ușor, mediu, greu și foarte greu"), end to end through the migrations and the
 * editor's own services on PGlite.
 *
 * Migration `0078_difficulty_five` is two `ALTER TYPE … ADD VALUE` statements and nothing else:
 * PGlite 0.5 is PostgreSQL 18, which (like every PostgreSQL since 12, Neon's included) runs `ADD VALUE` inside the migrator's transaction as
 * long as nothing in that same transaction *uses* the new value — and nothing does; the first use
 * is the seed's or the editor's, each in a later transaction. That the `createTestDatabase` below
 * migrates at all is the proof the runner applies it.
 */

const FIELDS = {
  type: "GROUP_RUN",
  eventStatus: "SCHEDULED",
  timezone: "Europe/Bucharest",
  startsAtWallTime: "2026-10-18T18:00",
  endsAtWallTime: "",
  raceStartsAtWallTime: "",
  locationName: "Parcul Tractorul",
  locationAddress: "",
  surface: null,
  mapUrl: "",
  routeUrl: "",
  distanceMeters: "",
  elevationGainMeters: "",
  featured: false,
  registrationMode: "NONE",
  participantListVisibility: "HIDDEN",
  capacity: "",
  registrationOpensAtWallTime: "",
  registrationClosesAtWallTime: "",
  declarationDocumentId: "",
  externalProvider: "",
  externalRegistrationUrl: "",
  costAmount: "",
  costUrl: "",
} as const;

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

async function created(difficulty: DifficultyBand | null, slug: string, difficultyStep?: string) {
  return createEvent(db, {
    actor: admin,
    fields: {
      ...FIELDS,
      difficulty,
      ...(difficultyStep === undefined ? {} : { difficultyStep }),
      translations: {
        ro: { slug: `${slug}-ro`, title: `Tura ${slug}`, excerpt: "Kilometri împreună." },
        en: { slug: `${slug}-en`, title: `Run ${slug}`, excerpt: "Kilometres together." },
      },
    },
  });
}

const stored = async (id: string) =>
  (await db.select({ difficulty: events.difficulty, difficultyLevel: events.difficultyLevel }).from(events).where(eq(events.id, id)))[0];

describe("BR-REQ-041-01 §412 the five-word enum, migration 0078 — retired by §526, still written", () => {
  it("the migrated enum keeps §412's order — the column the release before §526 reads", async () => {
    const result = await db.execute<{ level: string }>(sql`select unnest(enum_range(null::event_difficulty))::text as level`);
    expect(result.rows.map((row) => row.level)).toEqual(["VERY_EASY", "EASY", "MODERATE", "HARD", "VERY_HARD"]);
  });

  it("the editor's create stores «Foarte greu» as a level and the old word beside it", async () => {
    const event = await created("VERY_HARD", "foarte-greu");
    expect(await stored(event.id)).toEqual({ difficulty: "VERY_HARD", difficultyLevel: 14 });
  });

  it("the editor's save moves an event to «Ușor 1», the old «Foarte ușor»", async () => {
    const event = await created("MEDIUM", "mutat");
    const saved = await saveEventFields(db, {
      actor: admin,
      eventId: event.id,
      expectedVersion: event.version,
      fields: { ...FIELDS, difficulty: "EASY", difficultyStep: "1" },
    });
    expect(await stored(saved.id)).toEqual({ difficulty: "VERY_EASY", difficultyLevel: 1 });
  });

  it("a sort by the level is the scale, never the alphabet", async () => {
    const ids: string[] = [];
    for (const band of ["VERY_HARD", "EASY", "FAIRLY_HARD", "HARD", "MEDIUM"] as const) ids.push((await created(band, `rang-${band.toLowerCase().replace("_", "-")}`)).id);
    const ranked = await db.select({ level: events.difficultyLevel }).from(events).where(inArray(events.id, ids)).orderBy(asc(events.difficultyLevel));
    expect(ranked.map((row) => difficultyBandOf(row.level!))).toEqual([...DIFFICULTY_BANDS]);
  });

  it("the sample seed shows both ends of the scale (§526), so local and QA draw the gauge at one and at fifteen", () => {
    const seed = readFileSync(path.join(process.cwd(), "src", "db", "seeds", "pilot.ts"), "utf8");
    expect(seed).toContain("difficultyLevel: 1,");
    expect(seed).toContain("difficultyLevel: 15,");
  });
});
