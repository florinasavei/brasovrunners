import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { declarationAcceptances } from "@/db/schema/declaration-acceptances";
import { eventResults } from "@/db/schema/event-results";
import { computeContentHash } from "@/modules/legal-documents/domain/content-hash";
import { insertLegalDocumentVersion } from "@/modules/legal-documents/repository";
import { PRUNE_STEPS, pruneExpiredRows } from "@/modules/jobs/retention";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";
import { createRace, registerRunner } from "../../helpers/results";

/**
 * §NNN — the retention sweep's step for a race's results: the privacy notice says a race's results stay as long as its registrations
 * (sections 4 and 7), so three years after the race the rows go with them — the typed runners', the erased and the deleted registrations'
 * rows, with every category and place that describes a person — and a younger race is left exactly as it is. A registration an
 * Administrator holds for a dispute keeps its result with it until the hold is cleared.
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

describe("§NNN the sweep deletes a race's results with its registrations, three years after the race", () => {
  it("is a step of its own, listed with the others", () => {
    expect(PRUNE_STEPS).toContain("event-results");
  });

  it("deletes every result row of an old race — typed runners', erased registrations' and registered runners' — and nothing of a person stays", async () => {
    const old = await createRace(db, { startsAt: new Date("2026-11-21T07:00:00.000Z") });
    const ana = await registerRunner(db, old.id, { name: "Ana Popescu", bibNumber: 101, sex: "FEMALE", birthDate: "1996-05-01" });
    await db.insert(eventResults).values([
      { eventId: old.id, registrationId: ana.id, bibNumber: 101, status: "FINISHED", gunTimeMs: 3_000_000, positionOverall: 2, positionSex: 1, positionCategory: 1, categoryKey: "FEMALE:from30", note: "Ana Popescu a venit pe jos" },
      { eventId: old.id, bibNumber: 900, displayName: "Ion Vasile", sex: "MALE", birthDate: "1985-03-05", status: "FINISHED", gunTimeMs: 2_940_000, positionOverall: 1, positionSex: 1, positionCategory: 1, categoryKey: "MALE:from40", note: "a căzut" },
      { eventId: old.id, bibNumber: 102, status: "DNS" },
    ]);
    const outcome = await pruneExpiredRows(db, NOW);
    expect(outcome.failures).toEqual([]);
    expect(outcome.results).toBe(3);
    expect(await resultsOf(old.id)).toEqual([]);
  });

  it("keeps the result of a registration an Administrator holds, with the registration, and takes it on the run after the hold is cleared", async () => {
    const translations = [
      { locale: "ro" as const, title: "Declarație", body: { sections: [{ paragraphs: ["Text"] }] } },
      { locale: "en" as const, title: "Declaration", body: { sections: [{ paragraphs: ["Text"] }] } },
    ];
    const version = await insertLegalDocumentVersion(db, { key: "EVENT_DECLARATION", version: 1, effectiveAt: NOW, isApproved: true, contentSha256: computeContentHash(translations), translations, now: NOW });
    const old = await createRace(db, { startsAt: new Date("2026-11-21T07:00:00.000Z") });
    const held = await registerRunner(db, old.id, { name: "Ana Popescu", bibNumber: 101 });
    await db.insert(declarationAcceptances).values({
      registrationId: held.id,
      legalDocumentId: version,
      declarationVersion: 1,
      contentSha256: computeContentHash(translations),
      locale: "ro",
      typedName: "Ana Popescu",
      acceptedAt: NOW,
      retentionHold: true,
    });
    await db.insert(eventResults).values([
      { eventId: old.id, registrationId: held.id, bibNumber: 101, status: "FINISHED", gunTimeMs: 3_000_000, positionOverall: 1 },
      { eventId: old.id, bibNumber: 900, displayName: "Ion Vasile", status: "FINISHED", gunTimeMs: 2_940_000, positionOverall: 2 },
    ]);
    const first = await pruneExpiredRows(db, NOW);
    expect(first.failures).toEqual([]);
    // The typed runner's row went; the held registration is still there, and so is its result.
    expect((await resultsOf(old.id)).map((row) => row.bibNumber)).toEqual([101]);
    await db.update(declarationAcceptances).set({ retentionHold: false }).where(eq(declarationAcceptances.registrationId, held.id));
    expect((await pruneExpiredRows(db, NOW)).failures).toEqual([]);
    expect(await resultsOf(old.id)).toEqual([]);
  });

  it("leaves a race younger than three years exactly as it is, and deletes nothing for a sweep with nothing to delete", async () => {
    const recent = await createRace(db, { startsAt: new Date("2028-11-21T07:00:00.000Z") });
    await db.insert(eventResults).values({ eventId: recent.id, bibNumber: 900, displayName: "Ion Vasile", sex: "MALE", birthDate: "1985-03-05", status: "FINISHED", gunTimeMs: 2_940_000, note: "a căzut" });
    const outcome = await pruneExpiredRows(db, NOW);
    expect(outcome.results).toBe(0);
    expect((await resultsOf(recent.id))[0]).toMatchObject({ displayName: "Ion Vasile", sex: "MALE", birthDate: "1985-03-05", note: "a căzut" });
    // A second sweep over an old race that was already emptied finds nothing more.
    const old = await createRace(db, { startsAt: new Date("2026-11-21T07:00:00.000Z") });
    await db.insert(eventResults).values({ eventId: old.id, bibNumber: 1, status: "FINISHED", gunTimeMs: 1000 });
    expect((await pruneExpiredRows(db, NOW)).results).toBe(1);
    expect((await pruneExpiredRows(db, NOW)).results).toBe(0);
  });
});
