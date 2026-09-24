import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { events } from "@/db/schema/events";
import { participants } from "@/db/schema/participants";
import { registrations } from "@/db/schema/registrations";
import { computeContentHash, type LegalDocumentTranslationInput } from "@/modules/legal-documents/domain/content-hash";
import { insertLegalDocumentVersion } from "@/modules/legal-documents/repository";
import { computeOccupied } from "@/modules/registrations/domain/capacity";
import { countOccupied } from "@/modules/registrations/repository";
import { confirmEmail, type EventForRegistration, readPublicAvailability, submitRegistration } from "@/modules/registrations/service";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";

/**
 * BR-REQ-090-03 criteria 1 and 2 — the premise §334 rests on, proven before a single maintenance
 * run is skipped: expiry is evaluated at read time, so a run that does not happen can delay a
 * message or a hand-over to the waiting list, and cannot give a place twice or keep one from the
 * queue (AGENTS.md §10.6 outranks the saving).
 *
 * No maintenance run anywhere in this file. Every deadline below passed an hour ago, and what
 * the club and the next runner see is decided by the reads and the capacity transaction alone.
 */
const NOW = new Date("2026-10-01T10:00:00.000Z");
const HOUR = 60 * 60_000;

let db: TestDatabase;
let close: () => Promise<void>;

beforeAll(async () => {
  ({ db, close } = await createTestDatabase());
});
afterAll(async () => close());
beforeEach(async () => {
  await resetTables(db);
  const translations: LegalDocumentTranslationInput[] = [
    { locale: "ro", title: "Confidențialitate", body: { sections: [{ paragraphs: ["p"] }] } },
    { locale: "en", title: "Privacy", body: { sections: [{ paragraphs: ["p"] }] } },
  ];
  await insertLegalDocumentVersion(db, {
    key: "PRIVACY_NOTICE",
    version: 1,
    effectiveAt: new Date("2026-01-01T00:00:00.000Z"),
    isApproved: true,
    contentSha256: computeContentHash(translations),
    translations,
    now: NOW,
  });
});

async function oneplaceEvent(): Promise<EventForRegistration> {
  const [event] = await db
    .insert(events)
    .values({ type: "RACE", startsAt: new Date(NOW.getTime() + 30 * 24 * HOUR), registrationMode: "INTERNAL", capacity: 1 })
    .returning();
  return {
    id: event.id,
    eventStatus: event.eventStatus,
    registrationMode: "INTERNAL",
    startsAt: event.startsAt,
    registrationOpensAt: null,
    registrationClosesAt: null,
    capacity: 1,
    raceId: null,
    publishedAt: new Date(NOW.getTime() - 24 * HOUR),
  };
}

async function submit(event: EventForRegistration, email: string): Promise<string> {
  await submitRegistration(
    db,
    event,
    {
      firstName: "Ana",
      lastName: "Pop",
      birthDate: "1990-05-17",
      sex: "UNSPECIFIED",
      nationality: "RO",
      city: "Brașov",
      phone: "+40711111111",
      emergencyContactName: "Contact Urgență",
      emergencyContactPhone: "+40722222222",
      email,
      locale: "ro",
      privacyAcknowledged: true,
      fitnessDeclared: true,
      rulesAcknowledged: true,
      resultsNameConsent: true,
      listOptOut: false,
      honeypot: "",
      renderedAt: new Date(NOW.getTime() - 10_000).toISOString(),
    },
    NOW,
  );
  const [row] = await db
    .select({ id: registrations.id })
    .from(registrations)
    .innerJoin(participants, eq(participants.id, registrations.participantId))
    .where(and(eq(registrations.eventId, event.id), eq(participants.deliveryEmail, email)));
  return row.id;
}

async function statusOf(id: string) {
  const [row] = await db.select().from(registrations).where(eq(registrations.id, id));
  return { status: row.status, expiryReason: row.expiryReason };
}

describe("BR-REQ-090-03 criteria 1 and 2 a skipped maintenance run cannot overbook", () => {
  it("counts an offer an hour past its deadline as free on every read, with no run", async () => {
    const event = await oneplaceEvent();
    const offered = await submit(event, "late-offer@example.ro");
    await db
      .update(registrations)
      .set({ status: "WAITLIST_OFFERED", offerCreatedAt: new Date(NOW.getTime() - 25 * HOUR), holdExpiresAt: new Date(NOW.getTime() - HOUR) })
      .where(eq(registrations.id, offered));

    expect(computeOccupied(await countOccupied(db, event.id, NOW))).toBe(0);
    expect(await readPublicAvailability(db, event, NOW)).toBe(1);
  });

  it("gives that place to the next registration through the capacity transaction, and expires the offer in it", async () => {
    const event = await oneplaceEvent();
    const offered = await submit(event, "late-offer@example.ro");
    await db
      .update(registrations)
      .set({ status: "WAITLIST_OFFERED", offerCreatedAt: new Date(NOW.getTime() - 25 * HOUR), holdExpiresAt: new Date(NOW.getTime() - HOUR) })
      .where(eq(registrations.id, offered));

    const newcomer = await submit(event, "newcomer@example.ro");
    const held = await confirmEmail(db, event, newcomer, NOW);

    expect(held.status).toBe("PENDING_DECLARATION");
    expect(await statusOf(offered)).toEqual({ status: "EXPIRED", expiryReason: "WAITLIST_OFFER_LAPSED" });
    // One place, one holder: never two.
    expect(computeOccupied(await countOccupied(db, event.id, NOW))).toBe(1);
  });

  it("hands a lapsed hold's place to the person already waiting, never to a newcomer, at the next capacity transaction", async () => {
    const event = await oneplaceEvent();
    const holder = await submit(event, "holder@example.ro");
    await db
      .update(registrations)
      .set({ status: "PENDING_DECLARATION", holdExpiresAt: new Date(NOW.getTime() - HOUR) })
      .where(eq(registrations.id, holder));
    const waiting = await submit(event, "waiting@example.ro");
    await db
      .update(registrations)
      .set({ status: "WAITLISTED", waitlistedAt: new Date(NOW.getTime() - 30 * 60_000) })
      .where(eq(registrations.id, waiting));

    // Until something decides, the place is the holder's (§160) and the count says so.
    expect(await readPublicAvailability(db, event, NOW)).toBe(0);

    const newcomer = await submit(event, "newcomer@example.ro");
    const queued = await confirmEmail(db, event, newcomer, NOW);

    expect(await statusOf(holder)).toEqual({ status: "EXPIRED", expiryReason: "DECLARATION_HOLD_LAPSED" });
    expect((await statusOf(waiting)).status).toBe("WAITLIST_OFFERED");
    expect(queued.status).toBe("WAITLISTED");
    expect(computeOccupied(await countOccupied(db, event.id, NOW))).toBe(1);
  });
});
