import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { events } from "@/db/schema/events";
import { participants } from "@/db/schema/participants";
import { type RegistrationKind, type RegistrationStatus, registrations } from "@/db/schema/registrations";
import { listManagedPeople } from "@/modules/registrations/manage-family";
import { listActiveRegistrationsForParticipant } from "@/modules/registrations/my-registrations";
import { findRegistrationById, readWaitlistPosition } from "@/modules/registrations/repository";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";

/**
 * BR-REQ-035-01, BR-REQ-035-02 (§NNN) — where a waiting registration stands: `readWaitlistPosition`,
 * the one reader behind the registration's own page, «Toate înscrierile mele» and the
 * `WAITLIST_JOINED` email.
 *
 * The order is `lockOldestWaitlisted`'s own — `waitlisted_at`, then `id` — so the person the allocator
 * offers a place to first reads «locul 1». An offered, cancelled or expired row is not in the line, a
 * `TEST` row is (`AGENTS.md` §12.6), and a registration that is not waiting stands nowhere.
 */
const NOW = new Date("2026-09-24T10:00:00.000Z");
const at = (minutes: number) => new Date(NOW.getTime() + minutes * 60_000);

let db: TestDatabase;
let close: () => Promise<void>;
let serial = 0;

beforeAll(async () => {
  ({ db, close } = await createTestDatabase());
});
afterAll(async () => close());
beforeEach(async () => {
  serial = 0;
  await resetTables(db);
});

async function event(autoOffer = true) {
  const [row] = await db
    .insert(events)
    .values({
      type: "RACE",
      startsAt: new Date("2026-11-21T07:00:00.000Z"),
      registrationMode: "INTERNAL",
      capacity: 2,
      waitlistAutoOffer: autoOffer,
      editorialStatus: "PUBLISHED",
      publishedAt: new Date("2026-09-01T10:00:00.000Z"),
    })
    .returning();
  return row;
}

async function person(eventId: string, status: RegistrationStatus, waitlistedAt: Date | null, extra: { kind?: RegistrationKind; id?: string; participantId?: string } = {}) {
  serial += 1;
  const email = `runner${serial}@example.org`;
  const participantId =
    extra.participantId ??
    (
      await db
        .insert(participants)
        .values({ deliveryEmail: email, normalizedEmail: email, canonicalEmail: email, canonicalizationVersion: 1, defaultName: `Runner ${serial}`, preferredLocale: "ro" })
        .returning()
    )[0].id;
  const [row] = await db
    .insert(registrations)
    .values({
      ...(extra.id ? { id: extra.id } : {}),
      eventId,
      participantId,
      status,
      kind: extra.kind ?? "REAL",
      locale: "ro",
      registeredName: `Runner ${serial}`,
      displayName: `Runner ${serial}`,
      privacyNoticeVersion: 1,
      privacyAcknowledgedAt: NOW,
      resultsNameConsent: false,
      resultsConsentVersion: 1,
      listOptOut: false,
      waitlistedAt,
    })
    .returning();
  return row;
}

describe("§NNN readWaitlistPosition — the line in queue order", () => {
  it("is 1 + the waiting rows ahead by waitlisted_at, and the line's length is every waiting row", async () => {
    const e = await event();
    // Inserted out of order, so the answer is the queue's and not the table's.
    const third = await person(e.id, "WAITLISTED", at(30));
    const first = await person(e.id, "WAITLISTED", at(10));
    const second = await person(e.id, "WAITLISTED", at(20));
    expect(await readWaitlistPosition(db, first.id)).toEqual({ position: 1, length: 3, autoOffer: true });
    expect(await readWaitlistPosition(db, second.id)).toEqual({ position: 2, length: 3, autoOffer: true });
    expect(await readWaitlistPosition(db, third.id)).toEqual({ position: 3, length: 3, autoOffer: true });
  });

  it("breaks a tie on the same instant by id, as lockOldestWaitlisted does", async () => {
    const e = await event();
    const low = await person(e.id, "WAITLISTED", at(5), { id: "00000000-0000-4000-8000-000000000001" });
    const high = await person(e.id, "WAITLISTED", at(5), { id: "00000000-0000-4000-8000-000000000002" });
    expect((await readWaitlistPosition(db, low.id))?.position).toBe(1);
    expect((await readWaitlistPosition(db, high.id))?.position).toBe(2);
  });

  it("does not count an offered, cancelled or expired row, ahead of the person or in the length", async () => {
    const e = await event();
    await person(e.id, "WAITLIST_OFFERED", at(1));
    await person(e.id, "CANCELLED", at(2));
    await person(e.id, "EXPIRED", at(3));
    const waiting = await person(e.id, "WAITLISTED", at(4));
    expect(await readWaitlistPosition(db, waiting.id)).toEqual({ position: 1, length: 1, autoOffer: true });
  });

  it("counts a TEST row in the line like a real one: kind is in no condition (§12.6)", async () => {
    const e = await event();
    await person(e.id, "WAITLISTED", at(1), { kind: "TEST" });
    const real = await person(e.id, "WAITLISTED", at(2));
    await person(e.id, "WAITLISTED", at(3), { kind: "TEST" });
    expect(await readWaitlistPosition(db, real.id)).toEqual({ position: 2, length: 3, autoOffer: true });
  });

  it("counts only its own event's line", async () => {
    const e = await event();
    const other = await event();
    await person(other.id, "WAITLISTED", at(1));
    await person(other.id, "WAITLISTED", at(2));
    const mine = await person(e.id, "WAITLISTED", at(3));
    expect(await readWaitlistPosition(db, mine.id)).toEqual({ position: 1, length: 1, autoOffer: true });
  });

  it("is null for a row that is not waiting, and for none at all", async () => {
    const e = await event();
    for (const status of ["CONFIRMED", "WAITLIST_OFFERED", "PENDING_DECLARATION", "PENDING_EMAIL_CONFIRMATION", "CANCELLED", "EXPIRED"] as const) {
      const row = await person(e.id, status, null);
      expect(await readWaitlistPosition(db, row.id), status).toBeNull();
    }
    expect(await readWaitlistPosition(db, "00000000-0000-4000-8000-0000000000ff")).toBeNull();
  });

  it("carries the event's setting for automatic offers, as it stands now (§615)", async () => {
    const e = await event(false);
    const waiting = await person(e.id, "WAITLISTED", at(1));
    expect(await readWaitlistPosition(db, waiting.id)).toEqual({ position: 1, length: 1, autoOffer: false });
    await db.update(events).set({ waitlistAutoOffer: true }).where(eq(events.id, e.id));
    expect((await readWaitlistPosition(db, waiting.id))?.autoOffer).toBe(true);
  });

  it("moves up when the person ahead leaves the line", async () => {
    const e = await event();
    const ahead = await person(e.id, "WAITLISTED", at(1));
    const me = await person(e.id, "WAITLISTED", at(2));
    expect(await readWaitlistPosition(db, me.id)).toEqual({ position: 2, length: 2, autoOffer: true });
    await db.update(registrations).set({ status: "WAITLIST_OFFERED" }).where(eq(registrations.id, ahead.id));
    expect(await readWaitlistPosition(db, me.id)).toEqual({ position: 1, length: 1, autoOffer: true });
  });
});

describe("§NNN the pages' reads carry the standing of a waiting row only", () => {
  it("«Gestionează înscrierea» lists it per person, null for a row that is not waiting", async () => {
    const e = await event();
    await person(e.id, "WAITLISTED", at(1));
    const mine = await person(e.id, "WAITLISTED", at(2));
    const confirmedToo = await person(e.id, "CONFIRMED", null, { participantId: mine.participantId });
    const own = (await findRegistrationById(db, mine.id))!;
    const people = await listManagedPeople(db, own, NOW);
    expect(people.find((one) => one.id === mine.id)?.waitlistStanding).toEqual({ position: 2, length: 2, autoOffer: true });
    expect(people.find((one) => one.id === confirmedToo.id)?.waitlistStanding).toBeNull();
  });

  it("«Toate înscrierile mele» carries it on the waiting row", async () => {
    const e = await event(false);
    await person(e.id, "WAITLISTED", at(1));
    const mine = await person(e.id, "WAITLISTED", at(2));
    const items = await listActiveRegistrationsForParticipant(db, mine.participantId, "ro", NOW);
    expect(items.map((item) => item.waitlistStanding)).toEqual([{ position: 2, length: 2, autoOffer: false }]);
  });
});
