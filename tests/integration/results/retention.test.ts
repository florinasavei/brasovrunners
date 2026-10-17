import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eventResults } from "@/db/schema/event-results";
import { PRUNE_STEPS, pruneExpiredRows } from "@/modules/jobs/retention";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";
import { createRace } from "../../helpers/results";

/**
 * §NNN — the retention sweep's step for a race's results: three years after the race, with the registrations, what a person typed about a
 * runner — the name, the sex and the birth date of a runner who never registered, the free-text note on any row — is cleared. The rows
 * and their times stay, so no other runner's place moves; a younger race is left exactly as it is. The privacy notice's section 4 says
 * «în același termen».
 */
vi.mock("next/cache", () => ({ revalidateTag: vi.fn(), unstable_cache: vi.fn() }));

const NOW = new Date("2030-06-01T12:00:00.000Z");
let db: TestDatabase;
let close: () => Promise<void>;

beforeAll(async () => {
  ({ db, close } = await createTestDatabase());
});
afterAll(async () => close());
beforeEach(async () => resetTables(db));

async function resultsOf(eventId: string) {
  return db.select().from(eventResults).where(eq(eventResults.eventId, eventId)).orderBy(eventResults.bibNumber);
}

describe("§NNN the sweep clears what was typed about a runner, three years after the race", () => {
  it("is a step of its own, listed with the others", () => {
    expect(PRUNE_STEPS).toContain("event-results-names");
  });

  it("clears a typed runner's name, sex and birth date and every row's note on an old race, and keeps the times, the positions and the rows", async () => {
    const old = await createRace(db, { startsAt: new Date("2026-11-21T07:00:00.000Z") });
    await db.insert(eventResults).values([
      { eventId: old.id, bibNumber: 900, displayName: "Ion Vasile", sex: "MALE", birthDate: "1985-03-05", status: "FINISHED", gunTimeMs: 2_940_000, positionOverall: 1, positionSex: 1, positionCategory: 1, categoryKey: "MALE:from40", note: "a căzut" },
      { eventId: old.id, bibNumber: 101, status: "FINISHED", gunTimeMs: 3_000_000, positionOverall: 2, note: "Ana Popescu a venit pe jos" },
      { eventId: old.id, bibNumber: 102, status: "DNS" },
    ]);
    const outcome = await pruneExpiredRows(db, NOW);
    expect(outcome.failures).toEqual([]);
    expect(outcome.resultNames).toBe(2);
    const rows = await resultsOf(old.id);
    expect(rows.map((row) => [row.bibNumber, row.displayName, row.sex, row.birthDate, row.note])).toEqual([
      [101, null, null, null, null],
      [102, null, null, null, null],
      [900, null, null, null, null],
    ]);
    // The ranking of the old race stays whole: times, positions and the category the club's statistics counted.
    expect(rows.find((row) => row.bibNumber === 900)).toMatchObject({ gunTimeMs: 2_940_000, positionOverall: 1, positionSex: 1, positionCategory: 1, categoryKey: "MALE:from40" });
    expect(rows.find((row) => row.bibNumber === 101)).toMatchObject({ gunTimeMs: 3_000_000, positionOverall: 2 });
  });

  it("leaves a race younger than three years exactly as it is, and records nothing for a sweep with nothing to clear", async () => {
    const recent = await createRace(db, { startsAt: new Date("2028-11-21T07:00:00.000Z") });
    await db.insert(eventResults).values({ eventId: recent.id, bibNumber: 900, displayName: "Ion Vasile", sex: "MALE", birthDate: "1985-03-05", status: "FINISHED", gunTimeMs: 2_940_000, note: "a căzut" });
    const outcome = await pruneExpiredRows(db, NOW);
    expect(outcome.resultNames).toBe(0);
    expect((await resultsOf(recent.id))[0]).toMatchObject({ displayName: "Ion Vasile", sex: "MALE", birthDate: "1985-03-05", note: "a căzut" });
    // A second sweep over an old race that was already cleared finds nothing more.
    const old = await createRace(db, { startsAt: new Date("2026-11-21T07:00:00.000Z") });
    await db.insert(eventResults).values({ eventId: old.id, bibNumber: 1, status: "FINISHED", gunTimeMs: 1000 });
    expect((await pruneExpiredRows(db, NOW)).resultNames).toBe(0);
  });
});
