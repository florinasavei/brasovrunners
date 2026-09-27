import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { events } from "@/db/schema/events";
import { type StaffUser, staffUsers } from "@/db/schema/staff-users";
import { createEvent, duplicateEvent, saveEventFields } from "@/modules/content/events/service";
import { difficultyLevelOf } from "@/modules/events/domain/difficulty";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";

/**
 * BR-REQ-041-01 (`DECISIONS.md` §526) — the difficulty as the owner's five bands of three steps
 * (ușor, mediu, greuț, greu, foarte greu), one level column on the club's scale of fifteen, end to
 * end on PGlite: migration `0104_difficulty_level` over rows the previous release wrote, and the
 * editor's services writing the level (and the retired column's best-effort word beside it).
 */

const MIGRATIONS = "src/db/migrations";
const TAG = "0104_difficulty_level";
type Journal = { entries: Array<{ idx: number; tag: string; when: number }> };

describe("§526 migration 0104 — the old five words onto the owner's scale", () => {
  let client: PGlite;
  let folder: string;
  const ids: Record<string, string> = {};

  beforeAll(async () => {
    const journal = JSON.parse(readFileSync(`${MIGRATIONS}/meta/_journal.json`, "utf8")) as Journal;
    const position = journal.entries.findIndex((entry) => entry.tag === TAG);
    expect(position, "the journal lists the migration").toBeGreaterThan(0);
    expect(journal.entries[position].when, "sorts after the migration before it").toBeGreaterThan(journal.entries[position - 1].when);
    folder = mkdtempSync(path.join(tmpdir(), "difficulty-level-"));
    cpSync(MIGRATIONS, folder, { recursive: true });
    writeFileSync(path.join(folder, "meta", "_journal.json"), JSON.stringify({ ...journal, entries: journal.entries.slice(0, position) }));
    client = new PGlite();
    await migrate(drizzle(client), { migrationsFolder: folder });
    // Rows as the release before this one writes them: a band, or none.
    for (const band of ["VERY_EASY", "EASY", "MODERATE", "HARD", "VERY_HARD", null] as const) {
      const { rows } = await client.query<{ id: string }>(
        "INSERT INTO events (type, starts_at, difficulty) VALUES ('GROUP_RUN', '2026-11-21T08:00:00Z', $1) RETURNING id",
        [band],
      );
      ids[band ?? "none"] = rows[0].id;
    }
    await migrate(drizzle(client), { migrationsFolder: MIGRATIONS });
  });

  afterAll(async () => {
    await client.close();
    rmSync(folder, { recursive: true, force: true });
  });

  const level = async (key: string) =>
    (await client.query<{ difficulty_level: number | null }>("SELECT difficulty_level FROM events WHERE id = $1", [ids[key]])).rows[0].difficulty_level;

  it("gives VERY_EASY … VERY_HARD «ușor 1», «ușor 2», «mediu 2», «greu 2», «foarte greu 2» (1, 2, 5, 11, 14), and a row with no word none", async () => {
    expect(await level("VERY_EASY")).toBe(1);
    expect(await level("EASY")).toBe(2);
    expect(await level("MODERATE")).toBe(5);
    expect(await level("HARD")).toBe(11);
    expect(await level("VERY_HARD")).toBe(14);
    expect(await level("none")).toBeNull();
  });

  it("is idempotent: run again, it keeps a level already there", async () => {
    await client.query("UPDATE events SET difficulty_level = 12 WHERE id = $1", [ids.HARD]);
    const sql = readFileSync(`${MIGRATIONS}/${TAG}.sql`, "utf8").split("--> statement-breakpoint").at(-1)!;
    await client.query(sql);
    expect(await level("HARD")).toBe(12);
    expect(await level("VERY_EASY")).toBe(1);
    await client.query("UPDATE events SET difficulty_level = 11 WHERE id = $1", [ids.HARD]);
  });

  it("leaves the old column as it was, for the release still serving", async () => {
    const { rows } = await client.query<{ difficulty: string }>("SELECT difficulty FROM events WHERE id = $1", [ids.HARD]);
    expect(rows[0].difficulty).toBe("HARD");
  });

  it("refuses a level off the scale of fifteen", async () => {
    await expect(client.query("UPDATE events SET difficulty_level = 16 WHERE id = $1", [ids.HARD])).rejects.toThrow(/events_difficulty_level_in_scale/);
    await expect(client.query("UPDATE events SET difficulty_level = 0 WHERE id = $1", [ids.HARD])).rejects.toThrow(/events_difficulty_level_in_scale/);
    await client.query("UPDATE events SET difficulty_level = 15 WHERE id = $1", [ids.VERY_HARD]);
  });

  it("is expand only: the file adds and backfills, and drops nothing", () => {
    const sql = readFileSync(`${MIGRATIONS}/${TAG}.sql`, "utf8").replace(/--[^\n]*/g, "");
    expect(sql).not.toMatch(/\bDROP\b|\bRENAME\b|SET NOT NULL/i);
  });
});

describe("§526 migration 0104 in the same run as 0078 — a database migrated from further back", () => {
  it("backfills without naming an enum value 0078 added in the same transaction (55P04)", async () => {
    const journal = JSON.parse(readFileSync(`${MIGRATIONS}/meta/_journal.json`, "utf8")) as Journal;
    const position = journal.entries.findIndex((entry) => entry.tag === "0078_difficulty_five");
    expect(position).toBeGreaterThan(0);
    const folder = mkdtempSync(path.join(tmpdir(), "difficulty-level-0078-"));
    cpSync(MIGRATIONS, folder, { recursive: true });
    writeFileSync(path.join(folder, "meta", "_journal.json"), JSON.stringify({ ...journal, entries: journal.entries.slice(0, position) }));
    const client = new PGlite();
    try {
      await migrate(drizzle(client), { migrationsFolder: folder });
      const { rows } = await client.query<{ id: string }>(
        "INSERT INTO events (type, starts_at, difficulty) VALUES ('GROUP_RUN', '2026-11-21T08:00:00Z', 'HARD') RETURNING id",
      );
      // 0078 … 0104 in one transaction, as a fresh local or cloud database migrates them.
      await migrate(drizzle(client), { migrationsFolder: MIGRATIONS });
      const after = await client.query<{ difficulty_level: number }>("SELECT difficulty_level FROM events WHERE id = $1", [rows[0].id]);
      expect(after.rows[0].difficulty_level).toBe(11);
    } finally {
      await client.close();
      rmSync(folder, { recursive: true, force: true });
    }
  });
});

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

describe("§526 the editor writes the level, and the retired column's best-effort word beside it", () => {
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

  const stored = async (id: string) =>
    (await db.select({ difficulty: events.difficulty, difficultyLevel: events.difficultyLevel }).from(events).where(eq(events.id, id)))[0];

  async function created(slug: string, difficulty: string | null, difficultyStep?: string | number) {
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

  it("«Greu» step 3 is level 12", async () => {
    const event = await created("greu-sus", "HARD", "3");
    expect(await stored(event.id)).toEqual({ difficulty: "HARD", difficultyLevel: 12 });
  });

  it("«Greuț», which the old scale lacked, is 7 … 9", async () => {
    expect((await stored((await created("greut", "FAIRLY_HARD", "2")).id)).difficultyLevel).toBe(8);
  });

  it("the ends of the scale: «Ușor» step 1 is 1, «Foarte greu» step 3 is 15", async () => {
    expect(await stored((await created("capat-jos", "EASY", 1)).id)).toEqual({ difficulty: "VERY_EASY", difficultyLevel: 1 });
    expect(await stored((await created("capat-sus", "VERY_HARD", 3)).id)).toEqual({ difficulty: "VERY_HARD", difficultyLevel: 15 });
  });

  it("a band with no step, or an empty one, stands at its middle", async () => {
    expect(await stored((await created("fara-treapta", "MEDIUM")).id)).toEqual({ difficulty: "MODERATE", difficultyLevel: 5 });
    expect(await stored((await created("treapta-goala", "EASY", "")).id)).toEqual({ difficulty: "EASY", difficultyLevel: 2 });
  });

  it("refuses a band of the old scale that the new one does not have", async () => {
    await expect(created("foarte-usor", "VERY_EASY", "1")).rejects.toThrow();
    await expect(created("moderat", "MODERATE", "1")).rejects.toThrow();
  });

  it("no band is no difficulty, whatever the step says", async () => {
    expect(await stored((await created("nespecificat", null, "3")).id)).toEqual({ difficulty: null, difficultyLevel: null });
  });

  it("refuses a step outside 1 … 3", async () => {
    await expect(created("treapta-patru", "HARD", "4")).rejects.toThrow();
    await expect(created("treapta-zero", "HARD", "0")).rejects.toThrow();
  });

  it("a save moves the step inside the band, and to another band", async () => {
    const event = await created("mutat", "MEDIUM", "1");
    const once = await saveEventFields(db, { actor: admin, eventId: event.id, expectedVersion: event.version, fields: { ...FIELDS, difficulty: "MEDIUM", difficultyStep: "3" } });
    expect((await stored(event.id)).difficultyLevel).toBe(6);
    await saveEventFields(db, { actor: admin, eventId: event.id, expectedVersion: once.version, fields: { ...FIELDS, difficulty: "EASY", difficultyStep: "2" } });
    expect(await stored(event.id)).toEqual({ difficulty: "EASY", difficultyLevel: 2 });
  });

  it("a copy keeps the level", async () => {
    const event = await created("original", "HARD", "1");
    const copy = await duplicateEvent(db, { actor: admin, eventId: event.id });
    expect(await stored(copy.id)).toEqual({ difficulty: "HARD", difficultyLevel: 10 });
  });

  it("the old column is never read back: only the level says the difficulty", async () => {
    const event = await created("rollback", "HARD", "3");
    // What the release before this one does on a save: it writes the old column and knows no level.
    await db.update(events).set({ difficulty: "EASY" }).where(eq(events.id, event.id));
    expect(difficultyLevelOf(await stored(event.id))).toBe(12);
    await db.update(events).set({ difficulty: null }).where(eq(events.id, event.id));
    expect(difficultyLevelOf(await stored(event.id))).toBe(12);
    await db.update(events).set({ difficultyLevel: null }).where(eq(events.id, event.id));
    expect(difficultyLevelOf(await stored(event.id))).toBeNull();
  });
});
