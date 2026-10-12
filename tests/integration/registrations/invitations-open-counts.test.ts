import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eventInvitations } from "@/db/schema/event-invitations";
import { events } from "@/db/schema/events";
import { participants } from "@/db/schema/participants";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";

/**
 * §NNN — the registrations list on «toate evenimentele» names, per event, the invitations nobody has
 * answered (`listOpenInvitationCountsByEvent`): sent and still before their deadline, or past it
 * without an answer; an accepted or withdrawn one is not in it. A display read: it never touches the
 * capacity formula, whose own invitation count (§647, `invitationHoldsCount`) is tested with the send.
 */
const NOW = new Date("2026-10-12T10:00:00.000Z");
const DAY = 24 * 3_600_000;

let db: TestDatabase;
let close: () => Promise<void>;

vi.mock("@/db/client", () => ({ getDb: () => db }));

const { listOpenInvitationCountsByEvent, invitationHoldsCount } = await import("@/modules/registrations/invitation-repository");
const { listEventsTakingInvitations } = await import("@/modules/registrations/admin-repository");

beforeAll(async () => {
  ({ db, close } = await createTestDatabase());
});
afterAll(async () => close());
beforeEach(async () => {
  await resetTables(db);
});

async function event(patch: Partial<typeof events.$inferInsert> = {}): Promise<string> {
  const [row] = await db
    .insert(events)
    .values({ type: "RACE", startsAt: new Date(NOW.getTime() + 30 * DAY), registrationMode: "INTERNAL", capacity: 10, eventStatus: "SCHEDULED", locationName: "Parcul", editorialStatus: "PUBLISHED", publishedAt: NOW, ...patch })
    .returning({ id: events.id });
  return row.id;
}

let counter = 0;
async function invite(eventId: string, patch: Partial<typeof eventInvitations.$inferInsert> = {}) {
  counter += 1;
  const email = `ana.test.${counter}@example.invalid`;
  const [person] = await db
    .insert(participants)
    .values({ deliveryEmail: email, normalizedEmail: email, canonicalEmail: email, canonicalizationVersion: 2, defaultName: "Ana Test", preferredLocale: "ro" })
    .returning({ id: participants.id });
  await db.insert(eventInvitations).values({
    eventId,
    participantId: person.id,
    name: "Ana Test",
    email,
    canonicalEmail: email,
    locale: "ro",
    sentAt: NOW,
    lastSentAt: NOW,
    expiresAt: new Date(NOW.getTime() + 7 * DAY),
    ...patch,
  });
}

describe("§NNN the open invitations per event", () => {
  it("counts sent and unanswered-expired ones apart, per event, and leaves accepted and withdrawn out", async () => {
    const first = await event();
    const second = await event();
    await invite(first);
    await invite(first);
    // Past its deadline, whether the sweep stamped it yet or not.
    await invite(first, { expiresAt: new Date(NOW.getTime() - DAY) });
    await invite(first, { expiredAt: new Date(NOW.getTime() - DAY), expiresAt: new Date(NOW.getTime() - 2 * DAY) });
    await invite(first, { withdrawnAt: NOW });
    await invite(first, { acceptedAt: NOW });
    await invite(second);

    const counts = await listOpenInvitationCountsByEvent(db, NOW);
    expect(counts.find((row) => row.eventId === first)).toEqual({ eventId: first, sent: 2, expired: 2 });
    expect(counts.find((row) => row.eventId === second)).toEqual({ eventId: second, sent: 1, expired: 0 });
    expect(counts).toHaveLength(2);
  });

  it("leaves out an event that has started or been cancelled: its unanswered invitations are history", async () => {
    const past = await event({ startsAt: new Date(NOW.getTime() - DAY) });
    const cancelled = await event({ eventStatus: "CANCELLED" });
    await invite(past);
    await invite(cancelled, { expiresAt: new Date(NOW.getTime() - DAY) });
    expect(await listOpenInvitationCountsByEvent(db, NOW)).toEqual([]);
  });

  it("offers «Invită pe email» only the events the send accepts: published, announced, scheduled, still to come", async () => {
    const open = await event();
    await event({ editorialStatus: "DRAFT", publishedAt: null });
    await event({ dateToBeAnnounced: true });
    await event({ timeToBeAnnounced: true });
    await event({ startsAt: new Date(NOW.getTime() - DAY) });
    await event({ eventStatus: "CANCELLED" });
    await event({ registrationMode: "NONE", capacity: null });
    const listed = await listEventsTakingInvitations(db, "ro", NOW);
    expect(listed.map((row) => row.id)).toEqual([open]);
  });

  it("is a display read: the places an event's invitations hold are still only the live, counted ones", async () => {
    const id = await event();
    await invite(id);
    await invite(id, { expiresAt: new Date(NOW.getTime() - DAY) });
    await invite(id, { outsideCapacity: true });
    const [held] = await db.select({ held: invitationHoldsCount(id, NOW) }).from(sql`(select 1) as one`);
    // One live counted invitation; the expired and the «În afara locurilor» one hold nothing.
    expect(Number(held.held)).toBe(1);
  });
});
