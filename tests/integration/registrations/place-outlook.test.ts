import { and, eq, inArray } from "drizzle-orm";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eventInvitations } from "@/db/schema/event-invitations";
import { eventReserveEntries } from "@/db/schema/event-reserve-entries";
import { participants } from "@/db/schema/participants";
import { registrations } from "@/db/schema/registrations";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";
import { createRace, registerRunner, type Runner } from "../../helpers/results";

/**
 * «Locuri» under «Cine s-a înscris» (the owner, 2026-11-03: «fă niște update-uri pe site să văd mai clar
 * asta, nu să mă uit eu de fiecare dată»): one event's places taken against its capacity, the official
 * waiting list, the internal list's lines and the special guests — never a cancelled or test row, never
 * another event's — and how many can be let in with and without a place added. The places held until somebody
 * signs are named by what holds them, counted (§906; the production review of 2026-11-03: the parenthesis said
 * «declarație de semnat sau ofertă activă» while two of the thirteen were invitations).
 */
const NOW = new Date("2026-11-03T10:00:00.000Z");

let db: TestDatabase;
let close: () => Promise<void>;

vi.mock("@/db/client", () => ({ getDb: () => db }));
vi.mock("next-intl/server", async () => (await import("../../helpers/intl-server")).intlServerMock);

const { countKits, readPlaceOutlook } = await import("@/modules/registrations/admin-repository");
const { default: PlaceOutlook } = await import("@/modules/registrations/ui/PlaceOutlook");

async function drawn(eventId: string, elites?: number): Promise<string> {
  const outlook = await readPlaceOutlook(db, eventId, NOW);
  if (!outlook) throw new Error("no outlook");
  return renderToStaticMarkup(await PlaceOutlook({ outlook, locale: "ro", elites })).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

let invited = 0;
/** A live invitation (§647): a place kept for the person until its deadline — none when sent «Pe lista de invitați speciali». */
async function invite(eventId: string, expiresAt: Date, extra: Partial<typeof eventInvitations.$inferInsert> = {}) {
  invited += 1;
  const email = `invited${invited}@example.org`;
  const [participant] = await db
    .insert(participants)
    .values({ deliveryEmail: email, normalizedEmail: email, canonicalEmail: email, canonicalizationVersion: 1, defaultName: "Ioana Test", preferredLocale: "ro" })
    .returning();
  await db.insert(eventInvitations).values({ eventId, participantId: participant.id, name: "Ioana Test", email, canonicalEmail: email, sentAt: NOW, lastSentAt: NOW, expiresAt, ...extra });
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
    expect(await readPlaceOutlook(db, race.id, NOW)).toMatchObject({ capacity: 10, occupied: 10, confirmed: 9, held: 1, declaration: 1, offered: 0, invited: 0, family: 0, free: 0, waiting: 4, internal: 2, outside: 2, raises: 6, totalIfAll: 18 });
    // One held place: the singular, and only the kind that holds it.
    expect(await drawn(race.id)).toContain("Ocupate 10: 9 confirmați și 1 care își ține locul până semnează — 1 declarație.");
  });

  it("names the places held until somebody signs by kind, each counted, a kind at 0 left out (§906)", async () => {
    const race = await createRace(db, { capacity: 20 });
    await runners(race.id, 5);
    await runners(race.id, 2, { status: "PENDING_DECLARATION" });
    await runners(race.id, 1, { status: "WAITLIST_OFFERED" });
    // A family's reservations (§543): the sitting's forms before the address is confirmed, until their deadline.
    await runners(race.id, 2, { status: "PENDING_EMAIL_CONFIRMATION" });
    const later = new Date(NOW.getTime() + 86_400_000);
    await db
      .update(registrations)
      .set({ holdExpiresAt: later })
      .where(and(eq(registrations.eventId, race.id), inArray(registrations.status, ["WAITLIST_OFFERED", "PENDING_EMAIL_CONFIRMATION"])));
    await invite(race.id, later);

    // The kinds add up to the places held: the same count the allocator takes (`placesTaken`).
    expect(await readPlaceOutlook(db, race.id, NOW)).toMatchObject({ occupied: 11, confirmed: 5, held: 6, declaration: 2, offered: 1, invited: 1, family: 2 });
    const text = await drawn(race.id);
    expect(text).toContain("Ocupate 11: 5 confirmați și 6 care își țin locul până semnează — 2 declarații, 1 ofertă, 1 invitație, 2 rezervări de familie.");
    // No parenthesis guessing at the kinds any more.
    expect(text).not.toContain("declarație de semnat sau ofertă activă");

    // The owner's thirteen on 2026-11-03, by kind: 9 declarations, 2 offers, 2 invitations, no family.
    const owners = await createRace(db, { capacity: 20 });
    await runners(owners.id, 3);
    await runners(owners.id, 9, { status: "PENDING_DECLARATION" });
    await runners(owners.id, 2, { status: "WAITLIST_OFFERED" });
    await db.update(registrations).set({ holdExpiresAt: later }).where(and(eq(registrations.eventId, owners.id), eq(registrations.status, "WAITLIST_OFFERED")));
    await invite(owners.id, later);
    await invite(owners.id, later);
    expect(await drawn(owners.id)).toContain("Ocupate 16: 3 confirmați și 13 care își țin locul până semnează — 9 declarații, 2 oferte, 2 invitații.");
  });

  it("draws the free places going to the official list first, then the internal list, then the places to add", async () => {
    const race = await createRace(db, { capacity: 10 });
    await runners(race.id, 5);
    await runners(race.id, 4, { status: "WAITLISTED" });
    await internalLines(race.id, 3);
    await runners(race.id, 1, { outsideCapacity: true });

    const text = await drawn(race.id);
    // The answer first: the places free now (the owner, 2026-11-03: «nu înțeleg exact câte locuri mai pot să dau»).
    expect(text.indexOf("Locuri libere acum: 5 din 10")).toBeGreaterThan(-1);
    expect(text.indexOf("Locuri libere acum")).toBeLessThan(text.indexOf("Ocupate"));
    expect(text).toContain("Ocupate 5, toate confirmate.");
    expect(text).toContain("Așteaptă un loc: 7 — pe lista oficială 4, pe lista internă 3.");
    expect(text).toContain("Locurile libere merg întâi la lista oficială («Trimite-i oferta»), apoi la cea internă («Oferă-i un loc acum»).");
    expect(text).toContain("Ca să intre toți cei care așteaptă, capacitatea ar trebui să ajungă la 12 (+2)");
    expect(text).toContain("Invitați speciali: 1 (nu ocupă loc). Oameni la start dacă intră toți: 13.");
    expect(text).not.toContain("inclusiv");
  });

  it("counts the separate elite list among the people at the start, each count in its form (the owner, 2026-11-04)", async () => {
    const race = await createRace(db, { capacity: 10 });
    await runners(race.id, 5);
    await runners(race.id, 4, { status: "WAITLISTED" });
    await internalLines(race.id, 3);
    await runners(race.id, 1, { outsideCapacity: true });

    // The places are the allocator's: the free ones and the ones to add do not move.
    const one = await drawn(race.id, 1);
    expect(one).toContain("Locuri libere acum: 5 din 10");
    expect(one).toContain("capacitatea ar trebui să ajungă la 12 (+2)");
    expect(one).toContain("Invitați speciali: 1 (nu ocupă loc). Oameni la start dacă intră toți: 14, inclusiv 1 elită din lista separată.");
    expect(await drawn(race.id, 2)).toContain("Oameni la start dacă intră toți: 15, inclusiv 2 elite din lista separată.");
    expect(await drawn(race.id, 20)).toContain("Oameni la start dacă intră toți: 33, inclusiv 20 de elite din lista separată.");
  });

  it("counts every invitation still open among the people at the start, a special guest's too (the owner, 2026-11-10: «Are we even counting the invitations??»)", async () => {
    const race = await createRace(db, { capacity: 10 });
    await runners(race.id, 5);
    await runners(race.id, 1, { outsideCapacity: true });
    const later = new Date(NOW.getTime() + 86_400_000);
    // One holding a counted place, two «Pe lista de invitați speciali» holding none.
    await invite(race.id, later);
    await invite(race.id, later, { outsideCapacity: true });
    await invite(race.id, later, { outsideCapacity: true });
    // Nobody comes from a special guest's invitation past its deadline, withdrawn, or answered.
    await invite(race.id, new Date(NOW.getTime() - 1000), { outsideCapacity: true });
    await invite(race.id, later, { outsideCapacity: true, withdrawnAt: NOW });
    await invite(race.id, later, { outsideCapacity: true, acceptedAt: NOW });

    const outlook = await readPlaceOutlook(db, race.id, NOW);
    // The places are the allocator's: a special guest's invitation takes none.
    expect(outlook).toMatchObject({ occupied: 6, invited: 1, outside: 1, invitedOutside: 2, free: 4, totalIfAll: 9 });
    // The same open invitations «Kituri de pregătit» packs for.
    expect((await countKits(db, race.id, NOW)).invitations).toBe(3);
    expect(await drawn(race.id)).toContain("Invitați speciali: 1 (nu ocupă loc). Oameni la start dacă intră toți: 9, inclusiv 3 invitații fără răspuns.");
    expect(await drawn(race.id, 1)).toContain("Oameni la start dacă intră toți: 10, inclusiv 1 elită din lista separată și 3 invitații fără răspuns.");
  });

  it("says when no place is free, and when nobody waits", async () => {
    const full = await createRace(db, { capacity: 2 });
    await runners(full.id, 2);
    await runners(full.id, 1, { status: "WAITLISTED" });
    const fullText = await drawn(full.id);
    expect(fullText).toContain("Locuri libere acum: 0 din 2");
    expect(fullText).toContain("capacitatea ar trebui să ajungă la 3 (+1)");
    expect(fullText).not.toContain("Locurile libere merg");

    const calm = await createRace(db, { capacity: 5 });
    await runners(calm.id, 1);
    expect(await drawn(calm.id)).toContain("Nu așteaptă nimeni pe liste.");
    expect(await drawn(calm.id)).not.toContain("ar trebui să ajungă");
  });

  it("has nothing to say for an event with no capacity", async () => {
    const race = await createRace(db, { capacity: null });
    await runners(race.id, 3);
    expect(await readPlaceOutlook(db, race.id, NOW)).toBeNull();
  });
});
