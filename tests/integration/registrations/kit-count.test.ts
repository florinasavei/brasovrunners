import { eq } from "drizzle-orm";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eventInvitations } from "@/db/schema/event-invitations";
import { participants } from "@/db/schema/participants";
import { registrations, type RegistrationTshirtSize } from "@/db/schema/registrations";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";
import { createRace, registerRunner, type Runner } from "../../helpers/results";

/**
 * «Kituri de pregătit» (the owner, 2026-10-29): one event's real registrations holding a place now —
 * the special guests among them — by T-shirt size, plus its open invitations before their deadline.
 * Never the waiting list, a cancelled or expired row, a test row, or an answered, withdrawn or lapsed invitation.
 */
const NOW = new Date("2026-11-01T10:00:00.000Z");
const DAY = 24 * 3_600_000;

let db: TestDatabase;
let close: () => Promise<void>;

vi.mock("@/db/client", () => ({ getDb: () => db }));
vi.mock("next-intl/server", async () => (await import("../../helpers/intl-server")).intlServerMock);

const { countKits } = await import("@/modules/registrations/admin-repository");
const { default: KitCount } = await import("@/modules/registrations/ui/KitCount");

async function drawn(kits: Awaited<ReturnType<typeof countKits>>): Promise<string> {
  return renderToStaticMarkup(await KitCount({ kits })).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

beforeAll(async () => {
  ({ db, close } = await createTestDatabase());
});
afterAll(async () => close());
beforeEach(async () => {
  await resetTables(db);
});

async function runner(eventId: string, size: RegistrationTshirtSize | null, input: Omit<Runner, "name" | "bibNumber"> = {}) {
  const row = await registerRunner(db, eventId, { name: "Ana Test", bibNumber: null, ...input });
  await db.update(registrations).set({ tshirtSize: size }).where(eq(registrations.id, row.id));
}

let counter = 0;
async function invite(eventId: string, patch: Partial<typeof eventInvitations.$inferInsert> = {}) {
  counter += 1;
  const email = `kit.${counter}@example.invalid`;
  const [person] = await db
    .insert(participants)
    .values({ deliveryEmail: email, normalizedEmail: email, canonicalEmail: email, canonicalizationVersion: 2, defaultName: "Ana Test", preferredLocale: "ro" })
    .returning({ id: participants.id });
  await db.insert(eventInvitations).values({ eventId, participantId: person.id, name: "Ana Test", email, canonicalEmail: email, sentAt: NOW, lastSentAt: NOW, expiresAt: new Date(NOW.getTime() + 7 * DAY), ...patch });
}

describe("«Kituri de pregătit»", () => {
  it("counts everyone holding a place, by size, and the open invitations", async () => {
    const race = await createRace(db, { kitShirt: true });
    const other = await createRace(db, { kitShirt: true });
    await runner(race.id, "M");
    await runner(race.id, "M", { status: "PENDING_DECLARATION" });
    await runner(race.id, "L", { status: "WAITLIST_OFFERED" });
    await runner(race.id, "S", { status: "PENDING_EMAIL_CONFIRMATION" });
    await runner(race.id, "NONE", { outsideCapacity: true });
    await runner(race.id, null);
    // Not in it: the waiting list, cancelled and expired rows, a test row, another event.
    await runner(race.id, "XL", { status: "WAITLISTED" });
    await runner(race.id, "XL", { status: "CANCELLED" });
    await runner(race.id, "XL", { status: "EXPIRED" });
    await runner(race.id, "XL", { kind: "TEST" });
    await runner(other.id, "XL");
    await invite(race.id);
    await invite(race.id, { outsideCapacity: true });
    await invite(race.id, { acceptedAt: NOW });
    await invite(race.id, { withdrawnAt: NOW });
    await invite(race.id, { expiresAt: new Date(NOW.getTime() - DAY) });

    const kits = await countKits(db, race.id, NOW);
    expect(kits).toEqual({ kitShirt: true, bySize: { M: 2, L: 1, S: 1, NONE: 2 }, registrations: 6, invitations: 2 });
    const text = await drawn(kits);
    expect(text).toContain("Kituri de pregătit: 8");
    expect(text).toContain("Au acum un loc, cu invitații speciali: 6");
    expect(text).toContain("Invitații fără răspuns: 2");
    // The sizes in the form's order, then no T-shirt, then the invited whose size is not known yet.
    expect(text).toContain("Tricouri — S: 1 · M: 2 · L: 1 · fără tricou: 2 · mărime încă necunoscută (invitații): 2");
  });

  it("says the event gives no T-shirt, and counts nothing for an empty one", async () => {
    const race = await createRace(db);
    const kits = await countKits(db, race.id, NOW);
    expect(kits).toEqual({ kitShirt: false, bySize: {}, registrations: 0, invitations: 0 });
    const text = await drawn(kits);
    expect(text).toContain("Kituri de pregătit: 0");
    expect(text).not.toContain("Tricouri");
  });
});
