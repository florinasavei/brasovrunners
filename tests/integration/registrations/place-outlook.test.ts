import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eventReserveEntries } from "@/db/schema/event-reserve-entries";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";
import { createRace, registerRunner, type Runner } from "../../helpers/results";

/**
 * «Locuri» under «Cine s-a înscris» (the owner, 2026-11-03: «fă niște update-uri pe site să văd mai clar
 * asta, nu să mă uit eu de fiecare dată»): one event's places taken against its capacity, the official
 * waiting list, the internal list's lines and the special guests — never a cancelled or test row, never
 * another event's — and how many can be let in with and without a place added.
 */
const NOW = new Date("2026-11-03T10:00:00.000Z");

let db: TestDatabase;
let close: () => Promise<void>;

vi.mock("@/db/client", () => ({ getDb: () => db }));
vi.mock("next-intl/server", async () => (await import("../../helpers/intl-server")).intlServerMock);

const { readPlaceOutlook } = await import("@/modules/registrations/admin-repository");
const { default: PlaceOutlook } = await import("@/modules/registrations/ui/PlaceOutlook");

async function drawn(eventId: string): Promise<string> {
  const outlook = await readPlaceOutlook(db, eventId, NOW);
  if (!outlook) throw new Error("no outlook");
  return renderToStaticMarkup(await PlaceOutlook({ outlook })).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

beforeAll(async () => {
  ({ db, close } = await createTestDatabase());
});
afterAll(async () => close());
beforeEach(async () => {
  await resetTables(db);
});

async function runners(eventId: string, n: number, input: Omit<Runner, "name" | "bibNumber"> = {}) {
  for (let i = 0; i < n; i++) await registerRunner(db, eventId, { name: "Ana Test", bibNumber: null, ...input });
}

async function internalLines(eventId: string, n: number) {
  for (let i = 0; i < n; i++) await db.insert(eventReserveEntries).values({ eventId, firstName: "Ana", lastName: `Test ${i}` });
}

describe("«Locuri»", () => {
  it("counts the places taken, both lists and the special guests, and says how many can be let in", async () => {
    const race = await createRace(db, { capacity: 10 });
    const other = await createRace(db, { capacity: 10 });
    await runners(race.id, 6);
    await runners(race.id, 1, { status: "PENDING_DECLARATION" });
    await runners(race.id, 4, { status: "WAITLISTED" });
    await runners(race.id, 2, { outsideCapacity: true });
    await runners(race.id, 2, { status: "CANCELLED" });
    await runners(race.id, 3, { kind: "TEST" });
    await internalLines(race.id, 2);
    await runners(other.id, 5);
    await internalLines(other.id, 1);

    // 3 test rows take places too (§12.6: the allocator ignores `kind`), so 10 of 10 are taken.
    expect(await readPlaceOutlook(db, race.id, NOW)).toMatchObject({ capacity: 10, occupied: 10, free: 0, waiting: 4, internal: 2, outside: 2, raises: 6, totalIfAll: 18 });
  });

  it("draws the free places going to the official list first, then the internal list, then the places to add", async () => {
    const race = await createRace(db, { capacity: 10 });
    await runners(race.id, 5);
    await runners(race.id, 4, { status: "WAITLISTED" });
    await internalLines(race.id, 3);
    await runners(race.id, 1, { outsideCapacity: true });

    const text = await drawn(race.id);
    expect(text).toContain("Locuri ocupate: 5 din 10 · Libere: 5");
    expect(text).toContain("Lista oficială de așteptare: 4 · Lista internă (doar notițe): 3 · Invitați speciali (nu ocupă loc): 1");
    expect(text).toContain("Poți da drumul acum la 5 fără locuri în plus — de pe lista oficială: 4 («Trimite-i oferta»), de pe lista internă: 1 («Oferă-i un loc acum»).");
    expect(text).toContain("Pentru restul de pe liste (2), fiecare ofertă adaugă un loc: capacitatea ar ajunge la 12.");
    expect(text).toContain("Total dacă intră toți: 13");
  });

  it("says when no place is free, and when nobody waits", async () => {
    const full = await createRace(db, { capacity: 2 });
    await runners(full.id, 2);
    await runners(full.id, 1, { status: "WAITLISTED" });
    const fullText = await drawn(full.id);
    expect(fullText).toContain("Nu e niciun loc liber: pentru cei de pe liste (1), fiecare ofertă adaugă un loc — capacitatea ar ajunge la 3.");
    expect(fullText).not.toContain("Poți da drumul");

    const calm = await createRace(db, { capacity: 5 });
    await runners(calm.id, 1);
    expect(await drawn(calm.id)).toContain("Nu așteaptă nimeni pe liste.");
    expect(await drawn(calm.id)).not.toContain("fiecare ofertă adaugă");
  });

  it("has nothing to say for an event with no capacity", async () => {
    const race = await createRace(db, { capacity: null });
    await runners(race.id, 3);
    expect(await readPlaceOutlook(db, race.id, NOW)).toBeNull();
  });
});
