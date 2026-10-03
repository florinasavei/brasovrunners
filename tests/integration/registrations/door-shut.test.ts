import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { auditLogs } from "@/db/schema/audit-logs";
import { doorShutWindows } from "@/db/schema/door-shut-windows";
import { emailActionTokens } from "@/db/schema/email-action-tokens";
import { emailOutbox } from "@/db/schema/email-outbox";
import { eventInvitations } from "@/db/schema/event-invitations";
import { events } from "@/db/schema/events";
import { jobRuns } from "@/db/schema/job-runs";
import { participants } from "@/db/schema/participants";
import { platformSettings } from "@/db/schema/platform-settings";
import { registrations } from "@/db/schema/registrations";
import { staffUsers } from "@/db/schema/staff-users";
import { DEFAULT_DEADLINES } from "@/modules/deadlines/domain/deadlines";
import { forgetCachedDeadlines } from "@/modules/deadlines/memo";
import type { NameProbeStatus } from "@/modules/jobs/domain/door-shut";
import { computeContentHash, type LegalDocumentTranslationInput } from "@/modules/legal-documents/domain/content-hash";
import { insertLegalDocumentVersion } from "@/modules/legal-documents/repository";
import { computeOccupied } from "@/modules/registrations/domain/capacity";
import type { DoorShutDeps } from "@/modules/registrations/door-shut";
import { runRegistrationMaintenance } from "@/modules/registrations/maintenance";
import { countOccupied } from "@/modules/registrations/repository";
import { type EventForRegistration, submitRegistration } from "@/modules/registrations/service";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";

/**
 * §NNN — the clock stops while the door is shut. On 2026-10-03 the registrar held the club's domain
 * for about seven hours: the pingers call the public name, so no job ran, while every deadline kept
 * running. Here the door is shut two ways — the pings fall silent (a window seen once it is over), and
 * the job, reached by another address, finds the name gone (a window held open until it answers) — and
 * the maintenance run must move what was running, never what had passed before, never past the close,
 * never onto a place somebody else holds: a revived claim whose place was given meanwhile is seated
 * outside the places, audited, and the counted places stay within the capacity.
 */
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
// 19:00 in Brașov, a Saturday: the day's cadence (fifteen minutes) and the day's threshold (35).
const NOW = new Date("2026-10-03T16:00:00.000Z");
const ANCHOR = new Date("2026-10-03T08:00:00.000Z");
const LAST_PING = new Date("2026-10-03T09:00:00.000Z");
// The silence from the 09:00 call to this run, less the one call not yet due: 09:15 to 16:00.
const WINDOW_START = new Date(LAST_PING.getTime() + 15 * MINUTE);
const STOP = NOW.getTime() - WINDOW_START.getTime();

let db: TestDatabase;
let close: () => Promise<void>;

beforeAll(async () => {
  ({ db, close } = await createTestDatabase());
});
afterAll(async () => close());

async function approveTexts() {
  const translations: LegalDocumentTranslationInput[] = [
    { locale: "ro", title: "Text", body: { sections: [{ paragraphs: ["p"] }] } },
    { locale: "en", title: "Text", body: { sections: [{ paragraphs: ["p"] }] } },
  ];
  for (const key of ["TERMS", "PRIVACY_NOTICE", "EVENT_DECLARATION"] as const) {
    await insertLegalDocumentVersion(db, {
      key,
      version: 1,
      effectiveAt: new Date("2026-01-01T00:00:00.000Z"),
      isApproved: true,
      contentSha256: computeContentHash(translations),
      translations,
      now: ANCHOR,
    });
  }
}

beforeEach(async () => {
  await resetTables(db);
  await approveTexts();
  await db.insert(jobRuns).values({ jobName: "registration-maintenance", startedAt: ANCHOR, finishedAt: new Date(ANCHOR.getTime() + 1000) });
  await db.insert(staffUsers).values([
    { email: "admin@club.test", displayName: "Ana Admin", role: "ADMIN" },
    { email: "voluntar@club.test", displayName: "Vlad Voluntar", role: "CONTRIBUTOR" },
  ]);
});

async function createEvent(overrides: Partial<typeof events.$inferInsert> = {}): Promise<EventForRegistration> {
  const [event] = await db
    .insert(events)
    .values({
      type: "GROUP_RUN",
      startsAt: new Date(NOW.getTime() + 10 * DAY),
      registrationMode: "INTERNAL",
      capacity: 10,
      confirmationOpensDaysBefore: 0,
      ...overrides,
    })
    .returning();
  return {
    id: event.id,
    eventStatus: event.eventStatus,
    registrationMode: "INTERNAL",
    startsAt: event.startsAt,
    registrationOpensAt: event.registrationOpensAt,
    registrationClosesAt: event.registrationClosesAt,
    capacity: event.capacity,
    raceId: null,
    publishedAt: new Date(ANCHOR.getTime() - 30 * DAY),
  };
}

let serial = 0;
function submission(email: string, at: Date) {
  return {
    firstName: "Ana",
    lastName: `Pop${serial}`,
    birthDate: "1990-05-17",
    sex: "FEMALE",
    nationality: "RO",
    country: "RO",
    city: "Brașov",
    phone: "+40711111111",
    emergencyContactName: "Contact Urgență",
    emergencyContactPhone: "+40722222222",
    email,
    locale: "ro",
    privacyAcknowledged: true,
    fitnessDeclared: true,
    termsAccepted: true,
    rulesAcknowledged: true,
    resultsNameConsent: true,
    listOptOut: false,
    honeypot: "",
    renderedAt: new Date(at.getTime() - 10_000).toISOString(),
  };
}

/** One registration on the event, submitted before the window, then put in the state the case needs. */
async function register(event: EventForRegistration, changes: Partial<typeof registrations.$inferInsert>): Promise<string> {
  serial += 1;
  const email = `runner-${serial}@example.ro`;
  await submitRegistration(db, event, submission(email, ANCHOR), ANCHOR);
  const all = await db.select().from(registrations).where(eq(registrations.eventId, event.id));
  const mine = all.find((item) => item.registeredName.endsWith(` Pop${serial}`));
  if (!mine) throw new Error("the registration was not written");
  await db.update(registrations).set(changes).where(eq(registrations.id, mine.id));
  return mine.id;
}

const rowOf = async (id: string) => (await db.select().from(registrations).where(eq(registrations.id, id)))[0];

/** The pings the cache remembers: the 08:00 run's, then every quarter of an hour to 09:00, then nothing. */
const silentAfterNine: DoorShutDeps["readPings"] = async () =>
  [0, 15, 30, 45, 60].map((minutes) => new Date(ANCHOR.getTime() + minutes * MINUTE));

function deps(probe: NameProbeStatus, readPings: DoorShutDeps["readPings"] = silentAfterNine): DoorShutDeps {
  return { probe: async () => ({ status: probe, checkedAt: NOW.toISOString() }), readPings, dayCadence: 15, pinger: true };
}

async function setDoorCap(hours: number) {
  forgetCachedDeadlines();
  await db.insert(platformSettings).values({ key: "deadlines", value: { ...DEFAULT_DEADLINES, doorShutMaxHours: hours }, updatedAt: ANCHOR });
}

describe("§NNN the pings fall silent: the window is seen once it is over, and the deadlines move", () => {
  it("moves every deadline running at the window's start by its length, and none that passed before it", async () => {
    const event = await createEvent();
    const link = await register(event, { status: "PENDING_EMAIL_CONFIRMATION", emailLinkExpiresAt: new Date("2026-10-03T11:00:00.000Z") });
    const hold = await register(event, { status: "PENDING_DECLARATION", holdExpiresAt: new Date("2026-10-03T12:00:00.000Z") });
    const later = await register(event, { status: "PENDING_DECLARATION", holdExpiresAt: new Date(NOW.getTime() + 2 * DAY) });
    const before = await register(event, { status: "WAITLIST_OFFERED", holdExpiresAt: new Date("2026-10-03T08:30:00.000Z") });

    const result = await runRegistrationMaintenance(db, NOW, deps("resolves"));

    expect(result.door.shut).toBe(false);
    const [window] = await db.select().from(doorShutWindows);
    expect(window.source).toBe("pings");
    expect(window.startedAt).toEqual(WINDOW_START);
    expect(window.endedAt).toEqual(NOW);
    expect(window.stoppedMinutes).toBe(STOP / MINUTE);
    expect(window.appliedAt).not.toBeNull();

    // The address link that lapsed in the window: alive again, not swept by the lapse that follows.
    const linked = await rowOf(link);
    expect(linked.status).toBe("PENDING_EMAIL_CONFIRMATION");
    expect(linked.emailLinkExpiresAt).toEqual(new Date(Date.parse("2026-10-03T11:00:00.000Z") + STOP));
    expect((await rowOf(hold)).holdExpiresAt).toEqual(new Date(Date.parse("2026-10-03T12:00:00.000Z") + STOP));
    // A deadline still ahead moves too: the clock stopped for it as well.
    expect((await rowOf(later)).holdExpiresAt).toEqual(new Date(NOW.getTime() + 2 * DAY + STOP));
    // An offer that lapsed before the window started is not revived; the sweep ends it as before.
    const lapsed = await rowOf(before);
    expect(lapsed.status).toBe("EXPIRED");
    expect(lapsed.holdExpiresAt).toEqual(new Date("2026-10-03T08:30:00.000Z"));

    // One audit row per moved registration, no actor, the instants and the window — never a name.
    const trail = await db.select().from(auditLogs).where(eq(auditLogs.action, "registration.deadline_moved_while_shut"));
    expect(trail.map((row) => row.entityId).sort()).toEqual([link, hold, later].sort());
    for (const row of trail) {
      expect(row.actorStaffUserId).toBeNull();
      expect((row.metadataJson as { windowId?: string }).windowId).toBe(window.id);
    }
    expect(window.movedCount).toBe(3);
  });

  it("moves the link's token with it, so the email's button still opens what the move kept", async () => {
    const event = await createEvent();
    const id = await register(event, { status: "PENDING_EMAIL_CONFIRMATION", emailLinkExpiresAt: new Date("2026-10-03T11:00:00.000Z") });
    const [row] = await db.select().from(registrations).where(eq(registrations.id, id));
    await db.insert(emailActionTokens).values({
      participantId: row.participantId,
      registrationId: id,
      purpose: "VERIFY_REGISTRATION_EMAIL",
      tokenHash: "a".repeat(64),
      expiresAt: new Date("2026-10-03T11:00:00.000Z"),
      createdAt: ANCHOR,
    });
    await runRegistrationMaintenance(db, NOW, deps("resolves"));
    const [token] = await db.select().from(emailActionTokens).where(eq(emailActionTokens.registrationId, id));
    expect(token.expiresAt).toEqual(new Date(Date.parse("2026-10-03T11:00:00.000Z") + STOP));
  });

  it("never moves a hold past the registration's close", async () => {
    const closesAt = new Date("2026-10-03T17:00:00.000Z");
    const event = await createEvent({ registrationClosesAt: closesAt });
    const id = await register(event, { status: "PENDING_DECLARATION", holdExpiresAt: new Date("2026-10-03T14:00:00.000Z") });
    await runRegistrationMaintenance(db, NOW, deps("resolves"));
    expect((await rowOf(id)).holdExpiresAt).toEqual(closesAt);
  });

  it("seats a revived offer outside the places when its place was given meanwhile, and overbooks nothing", async () => {
    const event = await createEvent({ capacity: 1 });
    // The offer lapsed at 10:00, in the window; on the next read its place was free, and it was given.
    const offered = await register(event, { status: "WAITLIST_OFFERED", holdExpiresAt: new Date("2026-10-03T10:00:00.000Z"), waitlistedAt: ANCHOR });
    await register(event, { status: "CONFIRMED", confirmedAt: new Date("2026-10-03T15:30:00.000Z") });

    const result = await runRegistrationMaintenance(db, NOW, deps("resolves"));

    const row = await rowOf(offered);
    expect(row.status).toBe("WAITLIST_OFFERED");
    expect(row.holdExpiresAt).toEqual(new Date(Date.parse("2026-10-03T10:00:00.000Z") + STOP));
    expect(row.outsideCapacity).toBe(true);
    expect(result.door.outside).toBe(1);
    expect(computeOccupied(await countOccupied(db, event.id, NOW))).toBeLessThanOrEqual(1);
    const marks = await db.select().from(auditLogs).where(and(eq(auditLogs.action, "registration.outside_capacity_changed"), eq(auditLogs.entityId, offered)));
    expect(marks).toHaveLength(1);
    expect(marks[0].actorStaffUserId).toBeNull();
    expect(marks[0].metadataJson).toMatchObject({ from: false, to: true });
    const [window] = await db.select().from(doorShutWindows);
    expect(window.outsideCount).toBe(1);
  });

  it("seats a revived invitation outside the places when its place was given meanwhile", async () => {
    const event = await createEvent({ capacity: 1 });
    const [guest] = await db
      .insert(participants)
      .values({ deliveryEmail: "oaspete@example.ro", normalizedEmail: "oaspete@example.ro", canonicalEmail: "oaspete@example.ro", canonicalizationVersion: 1, defaultName: "Oaspete" })
      .returning();
    const lapsedAt = new Date("2026-10-03T10:00:00.000Z");
    const [invitation] = await db
      .insert(eventInvitations)
      .values({
        eventId: event.id,
        participantId: guest.id,
        name: "Oaspete",
        email: "oaspete@example.ro",
        canonicalEmail: "oaspete@example.ro",
        sentAt: ANCHOR,
        lastSentAt: ANCHOR,
        expiresAt: lapsedAt,
        createdAt: ANCHOR,
      })
      .returning();
    await register(event, { status: "CONFIRMED", confirmedAt: new Date("2026-10-03T15:30:00.000Z") });

    await runRegistrationMaintenance(db, NOW, deps("resolves"));

    const [after] = await db.select().from(eventInvitations).where(eq(eventInvitations.id, invitation.id));
    expect(after.expiredAt).toBeNull();
    expect(after.expiresAt).toEqual(new Date(lapsedAt.getTime() + STOP));
    expect(after.outsideCapacity).toBe(true);
    expect(computeOccupied(await countOccupied(db, event.id, NOW))).toBe(1);
    const [moved] = await db.select().from(auditLogs).where(eq(auditLogs.action, "event.invitation_deadline_moved_while_shut"));
    expect(moved.metadataJson).toMatchObject({ invitationId: invitation.id, outsideCapacity: true });
  });

  it("revives an offer into its own place when nobody took it, counted as before", async () => {
    const event = await createEvent({ capacity: 1 });
    const offered = await register(event, { status: "WAITLIST_OFFERED", holdExpiresAt: new Date("2026-10-03T10:00:00.000Z"), waitlistedAt: ANCHOR });
    await runRegistrationMaintenance(db, NOW, deps("resolves"));
    const row = await rowOf(offered);
    expect(row.status).toBe("WAITLIST_OFFERED");
    expect(row.outsideCapacity).toBe(false);
    expect(computeOccupied(await countOccupied(db, event.id, NOW))).toBe(1);
  });

  it("tells every Administrator once what moved, on the club's road, and nobody below the role", async () => {
    const event = await createEvent();
    await register(event, { status: "PENDING_DECLARATION", holdExpiresAt: new Date("2026-10-03T12:00:00.000Z") });
    await runRegistrationMaintenance(db, NOW, deps("resolves"));
    // A second run a quarter of an hour on: the window is done, nothing moves twice, nobody is told twice.
    const second = await runRegistrationMaintenance(db, new Date(NOW.getTime() + 15 * MINUTE), deps("resolves", async () => [ANCHOR, NOW]));
    expect(second.door.moved).toBe(0);
    const notices = await db.select().from(emailOutbox).where(eq(emailOutbox.messageType, "DOOR_SHUT_DEADLINES_MOVED"));
    expect(notices.map((row) => row.recipientEmail)).toEqual(["admin@club.test"]);
    expect(notices[0].participantId).toBeNull();
    expect(notices[0].payloadJson).toMatchObject({ source: "pings", moved: 1, outside: 0, stoppedMinutes: STOP / MINUTE });
    expect(await db.select().from(doorShutWindows)).toHaveLength(1);
    expect((await db.select().from(emailOutbox).where(eq(emailOutbox.messageType, "DOOR_SHUT"))).length).toBe(0);
  });

  it("caps the stop at the club's «Termene» number", async () => {
    await setDoorCap(2);
    const event = await createEvent();
    const id = await register(event, { status: "PENDING_DECLARATION", holdExpiresAt: new Date("2026-10-03T15:30:00.000Z") });
    // A deadline the capped stop would still leave behind this run is not written at all: it changes no answer.
    const behind = await register(event, { status: "PENDING_DECLARATION", holdExpiresAt: new Date("2026-10-03T12:00:00.000Z") });
    await runRegistrationMaintenance(db, NOW, deps("resolves"));
    expect((await rowOf(id)).holdExpiresAt).toEqual(new Date(Date.parse("2026-10-03T15:30:00.000Z") + 2 * HOUR));
    expect((await rowOf(behind)).holdExpiresAt).toEqual(new Date("2026-10-03T12:00:00.000Z"));
    const [window] = await db.select().from(doorShutWindows);
    expect(window.stoppedMinutes).toBe(120);
  });

  it("does nothing when switched off (0), and the sweeps run as they always did", async () => {
    await setDoorCap(0);
    const event = await createEvent();
    const offered = await register(event, { status: "WAITLIST_OFFERED", holdExpiresAt: new Date("2026-10-03T10:00:00.000Z"), waitlistedAt: ANCHOR });
    await runRegistrationMaintenance(db, NOW, deps("resolves"));
    expect(await db.select().from(doorShutWindows)).toHaveLength(0);
    expect((await rowOf(offered)).status).toBe("EXPIRED");
  });

  it("reads no silence from a cache that has forgotten the last run's own ping", async () => {
    const event = await createEvent();
    const offered = await register(event, { status: "WAITLIST_OFFERED", holdExpiresAt: new Date("2026-10-03T10:00:00.000Z"), waitlistedAt: ANCHOR });
    await runRegistrationMaintenance(db, NOW, deps("resolves", async () => null));
    expect(await db.select().from(doorShutWindows)).toHaveLength(0);
    expect((await rowOf(offered)).status).toBe("EXPIRED");
  });

  it("reads no silence where a real run of either job happened in it", async () => {
    await db.insert(jobRuns).values({ jobName: "email-outbox", startedAt: new Date("2026-10-03T12:30:00.000Z"), finishedAt: new Date("2026-10-03T12:30:01.000Z") });
    await db.insert(jobRuns).values({ jobName: "email-outbox", startedAt: new Date("2026-10-03T13:00:00.000Z"), finishedAt: new Date("2026-10-03T13:00:01.000Z") });
    await runRegistrationMaintenance(db, NOW, deps("resolves", async () => [ANCHOR, new Date("2026-10-03T08:30:00.000Z"), LAST_PING, new Date("2026-10-03T09:30:00.000Z"), new Date("2026-10-03T10:00:00.000Z"), new Date("2026-10-03T10:30:00.000Z"), new Date("2026-10-03T11:00:00.000Z"), new Date("2026-10-03T11:30:00.000Z"), new Date("2026-10-03T12:00:00.000Z"), new Date("2026-10-03T13:30:00.000Z"), new Date("2026-10-03T14:00:00.000Z"), new Date("2026-10-03T14:30:00.000Z"), new Date("2026-10-03T15:00:00.000Z"), new Date("2026-10-03T15:30:00.000Z")]));
    expect(await db.select().from(doorShutWindows)).toHaveLength(0);
  });
});

describe("§NNN the name does not resolve: the window stays open, nothing lapses, then everything moves", () => {
  it("holds every lapse while the name is gone, tells the Administrators once, and moves on its return", async () => {
    const event = await createEvent();
    // Every call arrives (another address); only the name is gone.
    const everyQuarter: DoorShutDeps["readPings"] = async (_anchor, now) => {
      const pings: Date[] = [];
      for (let at = ANCHOR.getTime(); at <= now.getTime(); at += 15 * MINUTE) pings.push(new Date(at));
      return pings;
    };
    const shutAt = new Date("2026-10-03T10:00:00.000Z");
    const offered = await register(event, { status: "WAITLIST_OFFERED", holdExpiresAt: new Date("2026-10-03T10:30:00.000Z"), waitlistedAt: ANCHOR });
    const link = await register(event, { status: "PENDING_EMAIL_CONFIRMATION", emailLinkExpiresAt: new Date("2026-10-03T11:00:00.000Z") });

    const first = await runRegistrationMaintenance(db, shutAt, deps("unresolved", everyQuarter));
    expect(first.door.shut).toBe(true);
    const [open] = await db.select().from(doorShutWindows);
    expect(open.source).toBe("name");
    expect(open.endedAt).toBeNull();
    expect((await db.select().from(emailOutbox).where(eq(emailOutbox.messageType, "DOOR_SHUT"))).map((row) => row.recipientEmail)).toEqual(["admin@club.test"]);

    // An hour later, still gone: the offer and the link are past their deadlines and nothing ends them.
    const still = await runRegistrationMaintenance(db, new Date("2026-10-03T11:30:00.000Z"), deps("unresolved", everyQuarter));
    expect(still.door.shut).toBe(true);
    expect((await rowOf(offered)).status).toBe("WAITLIST_OFFERED");
    expect((await rowOf(link)).status).toBe("PENDING_EMAIL_CONFIRMATION");
    expect((await db.select().from(emailOutbox).where(eq(emailOutbox.messageType, "DOOR_SHUT"))).length).toBe(1);

    // The name is back at 13:00: the window closes and three hours are given back.
    const back = new Date("2026-10-03T13:00:00.000Z");
    const reopened = await runRegistrationMaintenance(db, back, deps("resolves", everyQuarter));
    expect(reopened.door.shut).toBe(false);
    const [closed] = await db.select().from(doorShutWindows);
    expect(closed.endedAt).toEqual(back);
    expect(closed.stoppedMinutes).toBe(180);
    expect((await rowOf(offered)).holdExpiresAt).toEqual(new Date("2026-10-03T13:30:00.000Z"));
    expect((await rowOf(offered)).status).toBe("WAITLIST_OFFERED");
    expect((await rowOf(link)).emailLinkExpiresAt).toEqual(new Date("2026-10-03T14:00:00.000Z"));
    expect((await db.select().from(emailOutbox).where(eq(emailOutbox.messageType, "DOOR_SHUT_DEADLINES_MOVED"))).length).toBe(1);
  });

  it("answers nothing on a resolver that does not answer: no window opens, the sweeps run", async () => {
    const event = await createEvent();
    const offered = await register(event, { status: "WAITLIST_OFFERED", holdExpiresAt: new Date("2026-10-03T10:00:00.000Z"), waitlistedAt: ANCHOR });
    const at = new Date("2026-10-03T10:30:00.000Z");
    await runRegistrationMaintenance(db, at, deps("unknown", async () => [ANCHOR, new Date("2026-10-03T09:45:00.000Z"), new Date("2026-10-03T10:00:00.000Z"), new Date("2026-10-03T10:15:00.000Z"), new Date("2026-10-03T08:15:00.000Z"), new Date("2026-10-03T08:30:00.000Z"), new Date("2026-10-03T08:45:00.000Z"), new Date("2026-10-03T09:00:00.000Z"), new Date("2026-10-03T09:15:00.000Z"), new Date("2026-10-03T09:30:00.000Z")]));
    expect(await db.select().from(doorShutWindows)).toHaveLength(0);
    expect((await rowOf(offered)).status).toBe("EXPIRED");
  });
});
