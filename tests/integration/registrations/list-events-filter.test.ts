import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { events, eventTranslations } from "@/db/schema/events";
import { participants } from "@/db/schema/participants";
import { registrations } from "@/db/schema/registrations";
import { listEventsWithRegistrations } from "@/modules/registrations/admin-repository";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";

/**
 * BR-REQ-037-07, `DECISIONS.md` §NNN (amending §647) — the registrations list's event filter offers
 * an event that takes registrations here before its first registration, so its «Invitații» can be
 * reached; an event registered elsewhere or not at all, with nobody registered here, stays out.
 */
describe("§NNN the events the registrations list offers", () => {
  let db: TestDatabase;
  let close: () => Promise<void>;

  beforeAll(async () => {
    ({ db, close } = await createTestDatabase());
  });
  afterAll(async () => close());
  beforeEach(async () => {
    await resetTables(db);
  });

  async function event(title: string, registrationMode: "INTERNAL" | "EXTERNAL" | "NONE") {
    const [row] = await db
      .insert(events)
      .values({ type: "RACE", startsAt: new Date("2026-11-21T07:00:00Z"), registrationMode, locationName: "Start" })
      .returning();
    await db.insert(eventTranslations).values([
      { eventId: row.id, locale: "ro", title, slug: `ro-${row.id.slice(0, 8)}` },
      { eventId: row.id, locale: "en", title: `${title} (en)`, slug: `en-${row.id.slice(0, 8)}` },
    ]);
    return row.id;
  }

  it("offers a race that takes registrations here before anybody registered, and leaves out one that does not", async () => {
    const fresh = await event("Crosul nou", "INTERNAL");
    const elsewhere = await event("Maraton altundeva", "EXTERNAL");
    const nowhere = await event("Alergare de grup", "NONE");

    const offered = await listEventsWithRegistrations(db);
    expect(offered.map((row) => row.id)).toContain(fresh);
    // In Romanian while nobody registered, the language of the registrations otherwise.
    expect(offered.find((row) => row.id === fresh)?.title).toBe("Crosul nou");
    expect(offered.map((row) => row.id)).not.toContain(elsewhere);
    expect(offered.map((row) => row.id)).not.toContain(nowhere);
    // Offered once, not once per language.
    expect(offered.filter((row) => row.id === fresh)).toHaveLength(1);
  });

  it("still offers an event that has registrations, whatever it takes now", async () => {
    const past = await event("Crosul de anul trecut", "NONE");
    const email = "a@example.test";
    const [participant] = await db
      .insert(participants)
      .values({ deliveryEmail: email, normalizedEmail: email, canonicalEmail: email, canonicalizationVersion: 1, defaultName: "Ana" })
      .returning();
    await db.insert(registrations).values({
      eventId: past,
      participantId: participant.id,
      status: "CANCELLED",
      cancelledAt: new Date("2026-10-12T10:00:00Z"),
      cancellationSource: "PARTICIPANT",
      kind: "REAL",
      locale: "ro",
      registeredName: "Ana",
      displayName: "Ana",
      privacyNoticeVersion: 1,
      privacyAcknowledgedAt: new Date("2026-09-01T00:00:00Z"),
      resultsNameConsent: false,
      resultsConsentVersion: 1,
      submittedAt: new Date("2026-09-01T00:00:00Z"),
    });
    expect((await listEventsWithRegistrations(db)).map((row) => row.id)).toContain(past);
  });
});
