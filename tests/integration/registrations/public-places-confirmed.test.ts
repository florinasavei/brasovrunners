import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { events } from "@/db/schema/events";
import { familyPlaceHolds } from "@/db/schema/family-entries";
import { participants } from "@/db/schema/participants";
import { registrations } from "@/db/schema/registrations";
import { resolveDisplayName } from "@/modules/registrations/names";
import { readPublicPlaces } from "@/modules/registrations/service";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";

/**
 * §615 — the public line says «105 înscriși din 150 de locuri — 86 confirmați, 19 în curs de
 * confirmare»: `readPublicPlaces` returns `confirmed` beside the occupied places, and only a
 * CONFIRMED row is confirmed — a pending declaration, an open offer and a family's hold occupy a
 * place and are in progress. `kind` is in no condition (§12.6): a TEST row counts as confirmed.
 */
let db: TestDatabase;
let close: () => Promise<void>;

const NOW = new Date("2026-10-01T10:00:00.000Z");
const LATER = new Date("2026-10-02T10:00:00.000Z");

beforeAll(async () => {
  ({ db, close } = await createTestDatabase());
});
afterAll(async () => close());
beforeEach(async () => {
  await resetTables(db);
});

async function register(eventId: string, name: string, row: Partial<typeof registrations.$inferInsert>) {
  const email = `${name.toLowerCase().replace(/\s+/g, ".")}@example.org`;
  const [participant] = await db
    .insert(participants)
    .values({ deliveryEmail: email, normalizedEmail: email, canonicalEmail: email, canonicalizationVersion: 1, defaultName: name, preferredLocale: "ro" })
    .returning();
  await db.insert(registrations).values({
    eventId,
    participantId: participant.id,
    kind: "REAL",
    locale: "ro",
    registeredName: name,
    displayName: resolveDisplayName({ legalName: name }),
    privacyNoticeVersion: 1,
    privacyAcknowledgedAt: NOW,
    resultsNameConsent: false,
    resultsConsentVersion: 1,
    status: "CONFIRMED",
    ...row,
  });
}

describe("§615 readPublicPlaces returns the confirmed beside the occupied", () => {
  it("counts CONFIRMED rows alone as confirmed; holds occupy a place and are in progress", async () => {
    const [event] = await db
      .insert(events)
      .values({
        type: "RACE",
        startsAt: new Date("2026-11-21T14:00:00.000Z"),
        capacity: 10,
        registrationMode: "INTERNAL",
        editorialStatus: "PUBLISHED",
        publishedAt: NOW,
      })
      .returning();
    await register(event.id, "Ana Confirmata", { status: "CONFIRMED", confirmedAt: NOW });
    await register(event.id, "Test Confirmat", { status: "CONFIRMED", confirmedAt: NOW, kind: "TEST" });
    await register(event.id, "Ion Declaratie", { status: "PENDING_DECLARATION", holdExpiresAt: LATER });
    await register(event.id, "Maria Oferta", { status: "WAITLIST_OFFERED", waitlistedAt: NOW, holdExpiresAt: LATER });
    await register(event.id, "Radu Anulat", { status: "CANCELLED" });
    await db.insert(familyPlaceHolds).values({ eventId: event.id, sittingKey: "6f1c1a52-0f55-4b0a-9a63-2a6a1d1f4c01", slot: "slot-1", expiresAt: LATER, holdsPlace: true, createdAt: NOW });

    const places = await readPublicPlaces(db, { id: event.id, capacity: event.capacity, waitlistCapacity: null }, NOW);
    // Five places occupied (two confirmed, a declaration, an offer, a family hold); two confirmed.
    expect(places.confirmed).toBe(2);
    expect(places.availablePlaces).toBe(5);
    expect(10 - (places.availablePlaces ?? 0) - places.confirmed).toBe(3);
  });

  it("says nought for an uncapped event", async () => {
    const [event] = await db
      .insert(events)
      .values({ type: "RACE", startsAt: new Date("2026-11-21T14:00:00.000Z"), capacity: null, registrationMode: "INTERNAL", editorialStatus: "PUBLISHED", publishedAt: NOW })
      .returning();
    expect((await readPublicPlaces(db, { id: event.id, capacity: null, waitlistCapacity: null }, NOW)).confirmed).toBe(0);
  });
});
