import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { declarationAcceptances } from "@/db/schema/declaration-acceptances";
import { emailOutbox } from "@/db/schema/email-outbox";
import { events } from "@/db/schema/events";
import { participants } from "@/db/schema/participants";
import { type RegistrationKind, registrations } from "@/db/schema/registrations";
import { type StaffUser, staffUsers } from "@/db/schema/staff-users";
import { computeContentHash, type LegalDocumentTranslationInput } from "@/modules/legal-documents/domain/content-hash";
import { insertLegalDocumentVersion } from "@/modules/legal-documents/repository";
import {
  confirmRegistrationByStaff,
  createRegistrationByStaff,
  promoteRegistrationByStaff,
} from "@/modules/registrations/admin-service";
import { NO_WAITLIST, WAITLIST_FULL, waitlistRefusalOf } from "@/modules/registrations/domain/waitlist";
import { listPlaceCountInstants } from "@/modules/registrations/repository";
import {
  confirmEmail,
  type EventForRegistration,
  readPublicPlaces,
  signDeclaration,
  submitRegistration,
  unregister,
} from "@/modules/registrations/service";
import { addTestRegistrations } from "@/modules/registrations/test-registrations";
import { signingInput } from "../../helpers/declaration-signing";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";

/**
 * BR-REQ-035-01 (§348) — an event may cap its waiting list.
 *
 * The line is `WAITLISTED` plus the offers still open; null is no limit, 0 is no waiting list.
 * When a registration would join a full line it is refused, at every door — the public form, the
 * email confirmation, a restart, a staff entry, the desk, a batch of test rows — and the refusal
 * writes nothing. Nothing already waiting is removed when the limit is lowered. A `TEST` row
 * stands in the line like a real one (`AGENTS.md` §12.6).
 *
 * PGlite is one connection, so this proves the rule and not the race: two registrations taking
 * the last slot at once is `tests/concurrency/capacity.test.ts`, against real PostgreSQL.
 */
const NOW = new Date("2026-09-05T10:00:00.000Z");

let db: TestDatabase;
let close: () => Promise<void>;
let admin: StaffUser;

beforeAll(async () => {
  ({ db, close } = await createTestDatabase());
});
afterAll(async () => {
  await close();
});

beforeEach(async () => {
  await resetTables(db);
  const body = { sections: [{ paragraphs: ["p"] }] };
  const pair: LegalDocumentTranslationInput[] = [
    { locale: "ro", title: "Document", body },
    { locale: "en", title: "Document", body },
  ];
  for (const key of ["PRIVACY_NOTICE", "EVENT_DECLARATION"] as const) {
    await insertLegalDocumentVersion(db, {
      key,
      version: 1,
      effectiveAt: new Date("2026-01-01T00:00:00.000Z"),
      isApproved: true,
      contentSha256: computeContentHash(pair),
      translations: pair,
      now: NOW,
    });
  }
  [admin] = await db
    .insert(staffUsers)
    .values({ email: "superadmin@dev.test", displayName: "Admin", role: "ADMIN" })
    .returning();
});

async function createInternalEvent(capacity: number | null, waitlistCapacity: number | null): Promise<EventForRegistration> {
  const [event] = await db
    .insert(events)
    .values({
      type: "RACE",
      startsAt: new Date("2026-10-01T09:00:00.000Z"),
      registrationMode: "INTERNAL",
      capacity,
      waitlistCapacity,
    })
    .returning();

  // Deliberately without the limit: the allocator reads it off the locked row, never the caller's.
  return {
    id: event.id,
    eventStatus: event.eventStatus,
    registrationMode: "INTERNAL",
    startsAt: event.startsAt,
    registrationOpensAt: null,
    registrationClosesAt: null,
    capacity,
    raceId: null,
    publishedAt: NOW,
  };
}

function submission(email: string, at: Date) {
  return {
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
    resultsNameConsent: false,
    listOptOut: false,
    honeypot: "",
    renderedAt: new Date(at.getTime() - 10_000).toISOString(),
  };
}

/** The form, and nothing after it: the registration as it stands, unconfirmed. */
async function submitOnly(event: EventForRegistration, email: string, kind: RegistrationKind = "REAL", at: Date = NOW) {
  await submitRegistration(db, event, submission(email, at), at, kind);
  const [participant] = await db.select().from(participants).where(eq(participants.canonicalEmail, email.toLowerCase()));
  const [registration] = await db.select().from(registrations).where(eq(registrations.participantId, participant.id));
  return registration;
}

/** The form and the email link: where the allocator decides. */
async function registerAndConfirm(event: EventForRegistration, email: string, kind: RegistrationKind = "REAL", at: Date = NOW) {
  const pending = await submitOnly(event, email, kind, at);
  return confirmEmail(db, event, pending.id, at);
}

/** Which of the two refusals an operation met, or "no refusal". Any other error fails the test. */
async function refusalOf(operation: Promise<unknown>): Promise<string> {
  try {
    await operation;
    return "no refusal";
  } catch (error) {
    const refusal = waitlistRefusalOf(error);
    if (refusal) return refusal;
    throw error;
  }
}

async function statusCounts(eventId: string) {
  const rows = await db.select({ status: registrations.status }).from(registrations).where(eq(registrations.eventId, eventId));
  const count = (status: string) => rows.filter((row) => row.status === status).length;
  return {
    held: count("PENDING_DECLARATION"),
    waitlisted: count("WAITLISTED"),
    offered: count("WAITLIST_OFFERED"),
    confirmed: count("CONFIRMED"),
    pending: count("PENDING_EMAIL_CONFIRMATION"),
    total: rows.length,
  };
}

describe("BR-REQ-035-01 a waiting list with a limit (§348)", () => {
  it("queues two behind the one place and refuses the third, writing nothing for it", async () => {
    const event = await createInternalEvent(1, 2);
    expect((await registerAndConfirm(event, "place@example.test")).status).toBe("PENDING_DECLARATION");
    expect((await registerAndConfirm(event, "first@example.test")).status).toBe("WAITLISTED");
    expect((await registerAndConfirm(event, "second@example.test")).status).toBe("WAITLISTED");

    expect(await refusalOf(submitRegistration(db, event, submission("third@example.test", NOW), NOW))).toBe(WAITLIST_FULL);

    // Refused before anybody was looked up or written: no participant, no row, no email.
    expect(await db.select().from(participants).where(eq(participants.canonicalEmail, "third@example.test"))).toHaveLength(0);
    expect(await db.select().from(emailOutbox).where(eq(emailOutbox.recipientEmail, "third@example.test"))).toHaveLength(0);
    expect(await statusCounts(event.id)).toMatchObject({ held: 1, waitlisted: 2, total: 3 });
  });

  it("with a limit of 0 has no waiting list: once the place is gone, registration is refused", async () => {
    const event = await createInternalEvent(1, 0);
    await registerAndConfirm(event, "place@example.test");

    expect(await refusalOf(submitRegistration(db, event, submission("late@example.test", NOW), NOW))).toBe(NO_WAITLIST);
    expect(await statusCounts(event.id)).toMatchObject({ held: 1, waitlisted: 0, total: 1 });
  });

  it("with no limit queues everybody, exactly as before", async () => {
    const event = await createInternalEvent(1, null);
    await registerAndConfirm(event, "place@example.test");
    for (const index of [1, 2, 3, 4, 5]) {
      expect((await registerAndConfirm(event, `wait-${index}@example.test`)).status).toBe("WAITLISTED");
    }
    expect(await statusCounts(event.id)).toMatchObject({ held: 1, waitlisted: 5 });
  });

  it("an uncapped event never waitlists, so its limit never refuses", async () => {
    const event = await createInternalEvent(null, 0);
    for (const index of [1, 2, 3]) {
      expect((await registerAndConfirm(event, `open-${index}@example.test`)).status).toBe("PENDING_DECLARATION");
    }
  });

  it("refuses at the confirmation when the line filled between the form and the link, and writes nothing", async () => {
    const event = await createInternalEvent(1, 1);
    await registerAndConfirm(event, "place@example.test");
    // The form while the line had room…
    const slow = await submitOnly(event, "slow@example.test");
    // …and somebody else takes the last slot before the link is pressed.
    await registerAndConfirm(event, "quick@example.test");

    expect(await refusalOf(confirmEmail(db, event, slow.id, NOW))).toBe(WAITLIST_FULL);

    const [after] = await db.select().from(registrations).where(eq(registrations.id, slow.id));
    expect(after.status).toBe("PENDING_EMAIL_CONFIRMATION");
    expect(after.waitlistedAt).toBeNull();
    const [person] = await db.select().from(participants).where(eq(participants.id, slow.participantId));
    // The refusal took the verification back with it: the same link works when a slot opens.
    expect(person.emailVerifiedAt).toBeNull();
    const joined = await db
      .select()
      .from(emailOutbox)
      .where(and(eq(emailOutbox.registrationId, slow.id), eq(emailOutbox.messageType, "WAITLIST_JOINED")));
    expect(joined).toHaveLength(0);
  });

  it("lowering the limit removes nobody already waiting, and refuses the next until the line is shorter", async () => {
    const event = await createInternalEvent(1, 3);
    await registerAndConfirm(event, "place@example.test");
    const waiting = [];
    for (const index of [1, 2, 3]) waiting.push(await registerAndConfirm(event, `wait-${index}@example.test`));

    await db.update(events).set({ waitlistCapacity: 1 }).where(eq(events.id, event.id));
    expect(await statusCounts(event.id)).toMatchObject({ waitlisted: 3 });
    expect(await refusalOf(submitRegistration(db, event, submission("new@example.test", NOW), NOW))).toBe(WAITLIST_FULL);

    // Two leave: one still waits, which is the new limit — still full.
    await unregister(db, event, waiting[0].id, "PARTICIPANT", NOW);
    await unregister(db, event, waiting[1].id, "PARTICIPANT", NOW);
    expect(await refusalOf(submitRegistration(db, event, submission("new@example.test", NOW), NOW))).toBe(WAITLIST_FULL);

    // The last leaves: a slot opens.
    await unregister(db, event, waiting[2].id, "PARTICIPANT", NOW);
    expect((await registerAndConfirm(event, "new@example.test")).status).toBe("WAITLISTED");
  });

  it("counts TEST rows in the line like real ones, so a real registrant behind them is refused", async () => {
    const event = await createInternalEvent(1, 1);
    await registerAndConfirm(event, "demo-1@test.invalid", "TEST");
    expect((await registerAndConfirm(event, "demo-2@test.invalid", "TEST")).status).toBe("WAITLISTED");

    expect(await refusalOf(submitRegistration(db, event, submission("real@example.test", NOW), NOW, "REAL"))).toBe(WAITLIST_FULL);
  });

  it("keeps an open offer in the line: the slot opens when the offer is accepted, not when it is made", async () => {
    const event = await createInternalEvent(1, 1);
    const holder = await registerAndConfirm(event, "holder@example.test");
    await signDeclaration(db, event, holder.id, await signingInput(db, NOW), NOW);
    const next = await registerAndConfirm(event, "next@example.test");
    expect(next.status).toBe("WAITLISTED");
    expect(await refusalOf(submitRegistration(db, event, submission("after@example.test", NOW), NOW))).toBe(WAITLIST_FULL);

    // The holder withdraws: the first in line is offered the place — and still stands in the line.
    const later = new Date(NOW.getTime() + 60_000);
    await unregister(db, event, holder.id, "PARTICIPANT", later);
    const [offered] = await db.select().from(registrations).where(eq(registrations.id, next.id));
    expect(offered.status).toBe("WAITLIST_OFFERED");
    expect(await refusalOf(submitRegistration(db, event, submission("after@example.test", later), later))).toBe(WAITLIST_FULL);

    // Accepted: the line is empty, and the next person may join it.
    await signDeclaration(db, event, next.id, await signingInput(db, later), later);
    expect((await registerAndConfirm(event, "after@example.test", "REAL", later)).status).toBe("WAITLISTED");
  });

  it("refuses a verified participant's restart when the line is full, and leaves the row cancelled", async () => {
    const event = await createInternalEvent(1, 1);
    const returning = await registerAndConfirm(event, "again@example.test");
    await unregister(db, event, returning.id, "PARTICIPANT", NOW);
    await registerAndConfirm(event, "place@example.test");
    await registerAndConfirm(event, "wait@example.test");

    expect(await refusalOf(submitRegistration(db, event, submission("again@example.test", NOW), NOW))).toBe(WAITLIST_FULL);
    const [after] = await db.select().from(registrations).where(eq(registrations.id, returning.id));
    expect(after.status).toBe("CANCELLED");
  });

  it("refuses a late signature whose place went down the line when the line is full, and records nothing", async () => {
    const event = await createInternalEvent(1, 1);
    const late = await registerAndConfirm(event, "late@example.test");
    const waiting = await registerAndConfirm(event, "wait@example.test");
    expect(waiting.status).toBe("WAITLISTED");

    // Past the thirty-minute hold, with somebody waiting for the place (§160): the place goes to
    // the line, and this registration would have to join the back of it — which is full.
    const afterHold = new Date(NOW.getTime() + 31 * 60_000);
    expect(await refusalOf(signDeclaration(db, event, late.id, await signingInput(db, afterHold), afterHold))).toBe(WAITLIST_FULL);

    // Everything rolled back: no acceptance, and both rows as they were.
    expect(await db.select().from(declarationAcceptances).where(eq(declarationAcceptances.registrationId, late.id))).toHaveLength(0);
    const [lateAfter] = await db.select().from(registrations).where(eq(registrations.id, late.id));
    const [waitingAfter] = await db.select().from(registrations).where(eq(registrations.id, waiting.id));
    expect(lateAfter.status).toBe("PENDING_DECLARATION");
    expect(waitingAfter.status).toBe("WAITLISTED");
  });

  it("goes quiet on a cancelled event as before: the confirmation writes nothing and refuses nothing (§331)", async () => {
    const event = await createInternalEvent(1, 0);
    const pending = await submitOnly(event, "pending@example.test");
    await registerAndConfirm(event, "place@example.test");
    await db.update(events).set({ eventStatus: "CANCELLED" }).where(eq(events.id, event.id));

    const after = await confirmEmail(db, { ...event, eventStatus: "CANCELLED" }, pending.id, NOW);
    expect(after.status).toBe("PENDING_EMAIL_CONFIRMATION");
  });
});

/**
 * §160 keeps a declaration hold past its deadline until somebody wants the place. With a limit, a
 * newcomer the line has no room for is that somebody: one lapsed hold goes for them, the oldest
 * deadline first, and they get the place directly — rather than a runner who never signed keeping
 * it until the race while every newcomer is turned away, which on an event with no waiting list
 * nothing else would ever end.
 */
describe("§160, §348 a lapsed declaration hold goes to the newcomer the line cannot take", () => {
  const afterHold = new Date(NOW.getTime() + 31 * 60_000);

  it("with a limit of 0: the hold lapses and the newcomer gets the place — the page and the form say so first", async () => {
    const event = await createInternalEvent(1, 0);
    const lapsing = await registerAndConfirm(event, "never-signs@example.test");
    expect(lapsing.status).toBe("PENDING_DECLARATION");

    // Inside the hold: full, and closed as full, since there is no line to join.
    expect(await readPublicPlaces(db, { ...event, waitlistCapacity: 0 }, NOW)).toEqual({ availablePlaces: 0, waitlistRoom: 0 });
    expect(await refusalOf(submitRegistration(db, event, submission("early@example.test", NOW), NOW))).toBe(NO_WAITLIST);

    // Past it: the kept place is the next newcomer's — on the page, at the form, and in the allocator.
    expect(await readPublicPlaces(db, { ...event, waitlistCapacity: 0 }, afterHold)).toEqual({ availablePlaces: 1, waitlistRoom: 0 });
    const newcomer = await registerAndConfirm(event, "newcomer@example.test", "REAL", afterHold);
    expect(newcomer.status).toBe("PENDING_DECLARATION");

    const [released] = await db.select().from(registrations).where(eq(registrations.id, lapsing.id));
    expect(released.status).toBe("EXPIRED");
    expect(released.expiryReason).toBe("DECLARATION_HOLD_LAPSED");
    // One newcomer, one hold: full again, and the next one is refused.
    expect(await readPublicPlaces(db, { ...event, waitlistCapacity: 0 }, afterHold)).toEqual({ availablePlaces: 0, waitlistRoom: 0 });
    expect(await refusalOf(submitRegistration(db, event, submission("next@example.test", afterHold), afterHold))).toBe(NO_WAITLIST);
  });

  it("releases one hold per newcomer, the oldest deadline first, and the other can still sign", async () => {
    const event = await createInternalEvent(2, 0);
    const first = await registerAndConfirm(event, "first@example.test");
    const secondAt = new Date(NOW.getTime() + 5 * 60_000);
    const second = await registerAndConfirm(event, "second@example.test", "REAL", secondAt);
    const bothLapsed = new Date(NOW.getTime() + 40 * 60_000);

    expect((await readPublicPlaces(db, { ...event, waitlistCapacity: 0 }, bothLapsed)).availablePlaces).toBe(2);
    expect((await registerAndConfirm(event, "newcomer@example.test", "REAL", bothLapsed)).status).toBe("PENDING_DECLARATION");

    const [firstAfter] = await db.select().from(registrations).where(eq(registrations.id, first.id));
    const [secondAfter] = await db.select().from(registrations).where(eq(registrations.id, second.id));
    expect(firstAfter.status).toBe("EXPIRED");
    expect(secondAfter.status).toBe("PENDING_DECLARATION");

    // Nobody wants the second place yet, so the late signature is taken as §160 promises.
    const signed = await signDeclaration(db, event, second.id, await signingInput(db, bothLapsed), bothLapsed);
    expect(signed.status).toBe("CONFIRMED");
  });

  it("with a line at its limit: a lapsed hold's place goes to the newcomer instead of the refusal", async () => {
    const event = await createInternalEvent(2, 1);
    const leaving = await registerAndConfirm(event, "leaving@example.test");
    const lapsing = await registerAndConfirm(event, "lapsing@example.test");
    const queued = await registerAndConfirm(event, "queued@example.test");
    expect(queued.status).toBe("WAITLISTED");

    // A place given up: the one in line is offered it and still stands in the line, which is full.
    await unregister(db, event, leaving.id, "PARTICIPANT", NOW);
    const [offered] = await db.select().from(registrations).where(eq(registrations.id, queued.id));
    expect(offered.status).toBe("WAITLIST_OFFERED");
    expect(await refusalOf(submitRegistration(db, event, submission("early@example.test", NOW), NOW))).toBe(WAITLIST_FULL);

    // The other hold lapses. An offer is not somebody waiting, so it was kept — until a newcomer
    // the line cannot take arrives.
    expect(await readPublicPlaces(db, { ...event, waitlistCapacity: 1 }, afterHold)).toEqual({ availablePlaces: 1, waitlistRoom: 0 });
    expect((await registerAndConfirm(event, "newcomer@example.test", "REAL", afterHold)).status).toBe("PENDING_DECLARATION");

    const [lapsingAfter] = await db.select().from(registrations).where(eq(registrations.id, lapsing.id));
    const [queuedAfter] = await db.select().from(registrations).where(eq(registrations.id, queued.id));
    expect(lapsingAfter.status).toBe("EXPIRED");
    expect(queuedAfter.status).toBe("WAITLIST_OFFERED");
  });

  it("tells the public cache when a lapsing hold changes the count: on a limited line, and only there", async () => {
    const limited = await createInternalEvent(1, 0);
    const held = await registerAndConfirm(limited, "held@example.test");
    expect(await listPlaceCountInstants(db, limited.id)).toEqual([held.holdExpiresAt]);

    const unlimited = await createInternalEvent(1, null);
    await registerAndConfirm(unlimited, "other@example.test");
    expect(await listPlaceCountInstants(db, unlimited.id)).toEqual([]);
  });
});

describe("BR-REQ-037-05, BR-REQ-037-07 the staff doors meet the same limit (§348, AGENTS.md §15.11)", () => {
  const entry = (event: EventForRegistration, email: string, fastTrack = false) =>
    createRegistrationByStaff(
      db,
      admin,
      {
        eventId: event.id,
        firstName: "Desk",
        lastName: "Walkin",
        email,
        locale: "ro",
        listOptOut: false,
        relayedByParticipantRequest: true,
        fastTrack,
      },
      NOW,
    );

  it("refuses a staff entry and a desk walk-in when the places and the line are full", async () => {
    const event = await createInternalEvent(1, 1);
    await registerAndConfirm(event, "place@example.test");
    await registerAndConfirm(event, "wait@example.test");

    expect(await refusalOf(entry(event, "phone@example.test"))).toBe(WAITLIST_FULL);
    expect(await refusalOf(entry(event, "walkin@example.test", true))).toBe(WAITLIST_FULL);
    expect(await statusCounts(event.id)).toMatchObject({ total: 2 });
  });

  it("refuses the desk's paper confirmation that would queue somebody past the limit, and changes nothing", async () => {
    const event = await createInternalEvent(1, 1);
    await registerAndConfirm(event, "place@example.test");
    const pending = await submitOnly(event, "paper@example.test");
    await registerAndConfirm(event, "wait@example.test");

    expect(await refusalOf(confirmRegistrationByStaff(db, admin, pending.id, NOW))).toBe(WAITLIST_FULL);
    const [after] = await db.select().from(registrations).where(eq(registrations.id, pending.id));
    expect(after.status).toBe("PENDING_EMAIL_CONFIRMATION");
    expect(after.emailConfirmedAt).toBeNull();
  });

  it("still gives a queued person a free place at the desk: that takes one out of the line", async () => {
    const event = await createInternalEvent(1, 1);
    await registerAndConfirm(event, "place@example.test");
    const waiting = await registerAndConfirm(event, "wait@example.test");
    // A place that nobody has offered yet (a number raised by hand, not through the editor).
    await db.update(events).set({ capacity: 2 }).where(eq(events.id, event.id));

    const promoted = await promoteRegistrationByStaff(db, admin, waiting.id, NOW);
    expect(promoted.status).toBe("CONFIRMED");
    expect(await statusCounts(event.id)).toMatchObject({ waitlisted: 0 });
  });
});

describe("§30, AGENTS.md §12.6 a batch of test rows stops at the limit", () => {
  it("adds what fits, says it stopped, and refuses outright when nothing fits", async () => {
    const event = await createInternalEvent(1, 2);

    const first = await addTestRegistrations(db, admin, { eventId: event.id, count: 5, now: NOW });
    expect(first).toEqual({ created: 3, stoppedAtWaitlistLimit: true });
    expect(await statusCounts(event.id)).toMatchObject({ held: 1, waitlisted: 2, total: 3 });

    expect(await refusalOf(addTestRegistrations(db, admin, { eventId: event.id, count: 2, now: new Date(NOW.getTime() + 1000) }))).toBe(
      WAITLIST_FULL,
    );
  });
});

describe("§348 what the event page reads: the free places and the line's room", () => {
  it("counts the room from the same counts as the places, offers included", async () => {
    const event = await createInternalEvent(1, 3);
    expect(await readPublicPlaces(db, { ...event, waitlistCapacity: 3 }, NOW)).toEqual({ availablePlaces: 1, waitlistRoom: 3 });

    await registerAndConfirm(event, "place@example.test");
    await registerAndConfirm(event, "wait@example.test");
    expect(await readPublicPlaces(db, { ...event, waitlistCapacity: 3 }, NOW)).toEqual({ availablePlaces: 0, waitlistRoom: 2 });
  });

  it("has no room figure without a limit, and none for an uncapped event", async () => {
    const limited = await createInternalEvent(1, null);
    expect((await readPublicPlaces(db, { ...limited, waitlistCapacity: null }, NOW)).waitlistRoom).toBeNull();
    const open = await createInternalEvent(null, 5);
    expect(await readPublicPlaces(db, { ...open, waitlistCapacity: 5 }, NOW)).toEqual({ availablePlaces: null, waitlistRoom: null });
  });
});
