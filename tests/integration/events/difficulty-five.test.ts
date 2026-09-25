import { readFileSync } from "node:fs";
import path from "node:path";
import { asc, eq, inArray, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { events } from "@/db/schema/events";
import { type StaffUser, staffUsers } from "@/db/schema/staff-users";
import { createEvent, saveEventFields } from "@/modules/content/events/service";
import { DIFFICULTY_LEVELS, type DifficultyLevel } from "@/modules/events/domain/difficulty";
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

async function created(difficulty: DifficultyLevel | null, slug: string) {
  return createEvent(db, {
    actor: admin,
    fields: {
      ...FIELDS,
      difficulty,
      translations: {
        ro: { slug: `${slug}-ro`, title: `Tura ${slug}`, excerpt: "Kilometri împreună." },
        en: { slug: `${slug}-en`, title: `Run ${slug}`, excerpt: "Kilometres together." },
      },
    },
  });
}

const difficultyOf = async (id: string) => (await db.select({ difficulty: events.difficulty }).from(events).where(eq(events.id, id)))[0]?.difficulty;

describe("BR-REQ-041-01 §412 five difficulty levels, migration 0078", () => {
  it("the migrated enum is the scale, in the scale's order — the domain list's own", async () => {
    const result = await db.execute<{ level: string }>(sql`select unnest(enum_range(null::event_difficulty))::text as level`);
    expect(result.rows.map((row) => row.level)).toEqual([...DIFFICULTY_LEVELS]);
  });

  it("the editor's create stores «Foarte greu» and reads it back", async () => {
    const event = await created("VERY_HARD", "foarte-greu");
    expect(await difficultyOf(event.id)).toBe("VERY_HARD");
  });

  it("the editor's save moves an event to «Foarte ușor»", async () => {
    const event = await created("MODERATE", "mutat");
    const saved = await saveEventFields(db, {
      actor: admin,
      eventId: event.id,
      expectedVersion: event.version,
      fields: { ...FIELDS, difficulty: "VERY_EASY" },
    });
    expect(await difficultyOf(saved.id)).toBe("VERY_EASY");
  });

  it("an event saved with one of the three old values reads as before — nothing is rewritten", async () => {
    for (const level of ["EASY", "MODERATE", "HARD"] as const) {
      const event = await created(level, `vechi-${level.toLowerCase()}`);
      expect(await difficultyOf(event.id)).toBe(level);
    }
  });

  it("the database ranks by the enum's order, so a sort by difficulty is the scale, never the alphabet", async () => {
    const ids: string[] = [];
    for (const level of ["VERY_HARD", "EASY", "VERY_EASY", "HARD", "MODERATE"] as const) ids.push((await created(level, `rang-${level.toLowerCase().replace("_", "-")}`)).id);
    const ranked = await db.select({ difficulty: events.difficulty }).from(events).where(inArray(events.id, ids)).orderBy(asc(events.difficulty));
    expect(ranked.map((row) => row.difficulty)).toEqual([...DIFFICULTY_LEVELS]);
  });

  it("the sample seed shows both ends of the scale (§412), so local and QA draw the gauge at one and at five", () => {
    const seed = readFileSync(path.join(process.cwd(), "src", "db", "seeds", "pilot.ts"), "utf8");
    expect(seed).toContain('difficulty: "VERY_EASY" as const');
    expect(seed).toContain('difficulty: "VERY_HARD" as const');
  });
});
