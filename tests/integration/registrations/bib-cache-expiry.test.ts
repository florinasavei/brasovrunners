import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { events } from "@/db/schema/events";
import { participants } from "@/db/schema/participants";
import { registrations } from "@/db/schema/registrations";
import { type StaffUser, staffUsers } from "@/db/schema/staff-users";
import { setBibNumberByStaff } from "@/modules/registrations/admin-service";
import { assignBibNumbers } from "@/modules/registrations/bibs";
import { runRegistrationMaintenance } from "@/modules/registrations/maintenance";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";

/**
 * BR-REQ-039-01, `DECISIONS.md` §613 (with §549's static pages) — the public list may show a race
 * number, so every write of one expires the cached "places" pages: a hand-typed number, «Alocă
 * numerele» when it assigns at least one, and the one-off step that keeps a legacy number. Nothing
 * expires when nothing was written.
 */
const cache = vi.hoisted(() => ({ revalidatePublicContent: vi.fn() }));
vi.mock("@/modules/public-cache/cache", () => cache);

describe("BR-REQ-039-01 race-number writes expire the public list", () => {
  let db: TestDatabase;
  let close: () => Promise<void>;
  let admin: StaffUser;
  let eventId: string;
  let counter = 0;

  beforeAll(async () => {
    ({ db, close } = await createTestDatabase());
  });
  afterAll(async () => close());
  beforeEach(async () => {
    await resetTables(db);
    cache.revalidatePublicContent.mockClear();
    counter = 0;
    [admin] = await db.insert(staffUsers).values({ email: "admin@dev.test", displayName: "Admin", role: "ADMIN" }).returning();
    const [event] = await db
      .insert(events)
      .values({ type: "RACE", startsAt: new Date("2026-10-11T07:00:00Z"), registrationMode: "INTERNAL", locationName: "Start" })
      .returning();
    eventId = event.id;
  });

  async function register(name: string, options: { bibNumber?: number; provisional?: number } = {}) {
    counter += 1;
    const email = `${counter}@example.test`;
    const [participant] = await db
      .insert(participants)
      .values({ deliveryEmail: email, normalizedEmail: email, canonicalEmail: email, canonicalizationVersion: 1, defaultName: name })
      .returning();
    const [row] = await db
      .insert(registrations)
      .values({
        eventId,
        participantId: participant.id,
        status: "CONFIRMED",
        kind: "REAL",
        locale: "ro",
        registeredName: name,
        displayName: name,
        bibNumber: options.bibNumber ?? null,
        provisionalBibNumber: options.provisional ?? null,
        privacyNoticeVersion: 1,
        privacyAcknowledgedAt: new Date("2026-09-01T00:00:00Z"),
        resultsNameConsent: false,
        resultsConsentVersion: 1,
        submittedAt: new Date("2026-09-01T00:00:00Z"),
        confirmedAt: new Date(Date.UTC(2026, 8, 1, 10, counter)),
      })
      .returning();
    return row;
  }

  it("expires «places» after a hand-typed number", async () => {
    const ana = await register("Ana", { bibNumber: 1 });
    await setBibNumberByStaff(db, admin, ana.id, 9, new Date("2026-09-21T09:00:00Z"));
    expect(cache.revalidatePublicContent).toHaveBeenCalledWith("places");
  });

  it("expires «places» when «Alocă numerele» assigns at least one number, and not when it assigns none", async () => {
    await register("Ana");
    expect((await assignBibNumbers(db, { actor: admin, eventId })).assigned).toBe(1);
    expect(cache.revalidatePublicContent).toHaveBeenCalledWith("places");

    cache.revalidatePublicContent.mockClear();
    expect((await assignBibNumbers(db, { actor: admin, eventId })).assigned).toBe(0);
    expect(cache.revalidatePublicContent).not.toHaveBeenCalled();
  });

  it("expires «places» when the maintenance run's one-off step keeps a legacy number, and not when it keeps none", async () => {
    await register("Ana", { provisional: 7 });
    await runRegistrationMaintenance(db, new Date("2026-09-21T09:00:00Z"));
    expect(cache.revalidatePublicContent).toHaveBeenCalledWith("places");
    expect((await db.select().from(registrations))[0].bibNumber).toBe(7);

    cache.revalidatePublicContent.mockClear();
    await runRegistrationMaintenance(db, new Date("2026-09-21T10:00:00Z"));
    expect(cache.revalidatePublicContent).not.toHaveBeenCalledWith("places");
  });

  it("does not expire anything for a number that was never written", async () => {
    const ana = await register("Ana");
    await expect(setBibNumberByStaff(db, admin, ana.id, 0, new Date())).rejects.toBeTruthy();
    expect(cache.revalidatePublicContent).not.toHaveBeenCalled();
    expect((await db.select().from(registrations).where(eq(registrations.id, ana.id)))[0].bibNumber).toBeNull();
  });
});
