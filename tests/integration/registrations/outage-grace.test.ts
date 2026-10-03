import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { auditLogs } from "@/db/schema/audit-logs";
import { emailActionTokens } from "@/db/schema/email-action-tokens";
import { emailOutbox } from "@/db/schema/email-outbox";
import { eventInvitations } from "@/db/schema/event-invitations";
import { events } from "@/db/schema/events";
import { familyPlaceHolds, familySittings, pendingFamilyEntries } from "@/db/schema/family-entries";
import { jobRuns } from "@/db/schema/job-runs";
import { participants } from "@/db/schema/participants";
import { platformSettings } from "@/db/schema/platform-settings";
import { registrations } from "@/db/schema/registrations";
import { staffUsers } from "@/db/schema/staff-users";
import { unreachableWindows } from "@/db/schema/unreachable-windows";
import { DEFAULT_DEADLINES } from "@/modules/deadlines/domain/deadlines";
import { forgetCachedDeadlines } from "@/modules/deadlines/memo";
import { computeContentHash, type LegalDocumentTranslationInput } from "@/modules/legal-documents/domain/content-hash";
import { insertLegalDocumentVersion } from "@/modules/legal-documents/repository";
import { computeOccupied } from "@/modules/registrations/domain/capacity";
import type { OutageGraceDeps } from "@/modules/registrations/outage-grace";
import type { NameProbeStatus } from "@/modules/resilience/domain/name-probe";
import { runRegistrationMaintenance } from "@/modules/registrations/maintenance";
import { countOccupied } from "@/modules/registrations/repository";
import { type EventForRegistration, submitRegistration } from "@/modules/registrations/service";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";

/**
 * §NNN — the clock stops while the door is shut (the outage grace). On 2026-10-03 a registrar hold for
 * the contact verification took the club's domain away for about seven hours: the pingers call the
 * public name, so no job ran, while every deadline kept running. Here the platform is unreachable two
 * ways — the pings fall silent (a window seen once it is over), and the job, reached by another
 * address, finds the name gone on two probes ten minutes apart (a window held open until it answers) —
 * and the maintenance run must move what was running, never what had passed before, never past the
 * close or the start, never onto a place somebody else holds: a revived offer or invitation whose place
 * was given meanwhile is seated outside the places, audited, a family's claim is left to lapse, and the
 * counted places stay within the capacity.
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
const silentAfterNine: OutageGraceDeps["readPings"] = async () =>
  [0, 15, 30, 45, 60].map((minutes) => new Date(ANCHOR.getTime() + minutes * MINUTE));

function deps(probe: NameProbeStatus, readPings: OutageGraceDeps["readPings"] = silentAfterNine): OutageGraceDeps {
  return { probe: async () => ({ status: probe, host: "club.example.com", checkedAt: NOW.toISOString() }), readPings, dayCadence: 15, pinger: true };
}

async function setOutageCap(hours: number) {
  forgetCachedDeadlines();
  await db.insert(platformSettings).values({ key: "deadlines", value: { ...DEFAULT_DEADLINES, outageGraceMaxHours: hours }, updatedAt: ANCHOR });
}

const after = (iso: string) => new Date(Date.parse(iso) + STOP);

let hashSerial = 0;
/** One live token, as the renderer mints them: its own hash, its scope, its expiry. */
async function token(values: { participantId: string; registrationId: string | null; invitationId?: string | null; purpose: typeof emailActionTokens.$inferInsert.purpose; expiresAt: Date }) {
  hashSerial += 1;
  const [row] = await db
    .insert(emailActionTokens)
    .values({ ...values, tokenHash: hashSerial.toString(16).padStart(64, "0"), createdAt: ANCHOR })
    .returning();
  return row;
}
const tokenOf = async (id: string) => (await db.select().from(emailActionTokens).where(eq(emailActionTokens.id, id)))[0];

async function invite(event: EventForRegistration, expiresAt: Date) {
  serial += 1;
  const email = `oaspete-${serial}@example.ro`;
  const [guest] = await db
    .insert(participants)
    .values({ deliveryEmail: email, normalizedEmail: email, canonicalEmail: email, canonicalizationVersion: 1, defaultName: "Oaspete" })
    .returning();
  const [invitation] = await db
    .insert(eventInvitations)
    .values({ eventId: event.id, participantId: guest.id, name: "Oaspete", email, canonicalEmail: email, sentAt: ANCHOR, lastSentAt: ANCHOR, expiresAt, createdAt: ANCHOR })
    .returning();
  return invitation;
}

const windows = () => db.select().from(unreachableWindows);
const outbox = (type: "UNREACHABLE_WINDOW_OPENED" | "UNREACHABLE_WINDOW_CLOSED") => db.select().from(emailOutbox).where(eq(emailOutbox.messageType, type));

describe("§NNN the pings fall silent: the window is seen once it is over, and the deadlines move", () => {
  it("moves every deadline running at the window's start by its length, and none that passed before it", async () => {
    const event = await createEvent();
    const link = await register(event, { status: "PENDING_EMAIL_CONFIRMATION", emailLinkExpiresAt: new Date("2026-10-03T11:00:00.000Z") });
    const hold = await register(event, { status: "PENDING_DECLARATION", holdExpiresAt: new Date("2026-10-03T12:00:00.000Z") });
    const later = await register(event, { status: "PENDING_DECLARATION", holdExpiresAt: new Date(NOW.getTime() + 2 * DAY) });
    const before = await register(event, { status: "WAITLIST_OFFERED", holdExpiresAt: new Date("2026-10-03T08:30:00.000Z") });

    const result = await runRegistrationMaintenance(db, NOW, deps("resolves"));

    expect(result.outageGrace.holding).toBe(false);
    const [window] = await windows();
    expect(window.source).toBe("pings");
    expect(window.startedAt).toEqual(WINDOW_START);
    expect(window.endedAt).toEqual(NOW);
    expect(window.confirmedAt).not.toBeNull();
    expect(window.grantedMs).toBe(STOP);
    expect(window.appliedAt).not.toBeNull();

    // The address link that lapsed in the window: alive again, not swept by the lapse that follows.
    const linked = await rowOf(link);
    expect(linked.status).toBe("PENDING_EMAIL_CONFIRMATION");
    expect(linked.emailLinkExpiresAt).toEqual(after("2026-10-03T11:00:00.000Z"));
    expect((await rowOf(hold)).holdExpiresAt).toEqual(after("2026-10-03T12:00:00.000Z"));
    // A deadline still ahead moves too: the clock stopped for it as well.
    expect((await rowOf(later)).holdExpiresAt).toEqual(new Date(NOW.getTime() + 2 * DAY + STOP));
    // An offer that lapsed before the window started is not revived; the sweep ends it as before.
    const lapsed = await rowOf(before);
    expect(lapsed.status).toBe("EXPIRED");
    expect(lapsed.holdExpiresAt).toEqual(new Date("2026-10-03T08:30:00.000Z"));

    // One audit row per moved registration, no actor, the instants, the window and its source — never a name.
    const trail = await db.select().from(auditLogs).where(eq(auditLogs.action, "registration.deadline_moved_for_outage"));
    expect(trail.map((row) => row.entityId).sort()).toEqual([link, hold, later].sort());
    for (const row of trail) {
      expect(row.actorStaffUserId).toBeNull();
      expect(row.metadataJson).toMatchObject({ windowId: window.id, source: "pings" });
    }
    expect(window.rowsMoved).toBe(3);
  });

  it("moves a family's reservation, its sitting's link, its held place and its kept form, and an open invitation", async () => {
    const event = await createEvent();
    const reservation = await register(event, {
      status: "PENDING_EMAIL_CONFIRMATION",
      holdExpiresAt: new Date("2026-10-03T12:00:00.000Z"),
      emailLinkExpiresAt: new Date("2026-10-03T11:30:00.000Z"),
    });
    const own = await rowOf(reservation);
    const sittingToken = await token({ participantId: own.participantId, registrationId: reservation, purpose: "REGISTER_ANOTHER_PERSON", expiresAt: new Date("2026-10-03T11:00:00.000Z") });
    const [sitting] = await db
      .insert(familySittings)
      .values({ eventId: event.id, participantId: own.participantId, registrationId: reservation, locale: "ro", heldUntil: ANCHOR, expiresAt: new Date("2026-10-03T11:00:00.000Z"), actionTokenId: sittingToken.id })
      .returning();
    const [placeHold] = await db
      .insert(familyPlaceHolds)
      .values({ eventId: event.id, sittingKey: randomUUID(), slot: "1", expiresAt: new Date("2026-10-03T12:30:00.000Z") })
      .returning();
    const formToken = await token({ participantId: own.participantId, registrationId: reservation, purpose: "REGISTER_ANOTHER_PERSON", expiresAt: new Date("2026-10-03T11:15:00.000Z") });
    const [form] = await db
      .insert(pendingFamilyEntries)
      .values({ eventId: event.id, participantId: own.participantId, registrationId: reservation, locale: "ro", fields: {}, expiresAt: new Date("2026-10-03T11:15:00.000Z"), actionTokenId: formToken.id })
      .returning();
    const invitation = await invite(event, new Date("2026-10-03T13:00:00.000Z"));

    await runRegistrationMaintenance(db, NOW, deps("resolves"));

    const moved = await rowOf(reservation);
    expect(moved.holdExpiresAt).toEqual(after("2026-10-03T12:00:00.000Z"));
    expect(moved.emailLinkExpiresAt).toEqual(after("2026-10-03T11:30:00.000Z"));
    expect(moved.outsideCapacity).toBe(false);
    expect((await db.select().from(familySittings).where(eq(familySittings.id, sitting.id)))[0].expiresAt).toEqual(after("2026-10-03T11:00:00.000Z"));
    expect((await db.select().from(familyPlaceHolds).where(eq(familyPlaceHolds.id, placeHold.id)))[0].expiresAt).toEqual(after("2026-10-03T12:30:00.000Z"));
    expect((await db.select().from(pendingFamilyEntries).where(eq(pendingFamilyEntries.id, form.id)))[0].expiresAt).toEqual(after("2026-10-03T11:15:00.000Z"));
    expect((await db.select().from(eventInvitations).where(eq(eventInvitations.id, invitation.id)))[0].expiresAt).toEqual(after("2026-10-03T13:00:00.000Z"));
    // Each link's token with its row.
    expect((await tokenOf(sittingToken.id)).expiresAt).toEqual(after("2026-10-03T11:00:00.000Z"));
    expect((await tokenOf(formToken.id)).expiresAt).toEqual(after("2026-10-03T11:15:00.000Z"));
    const trail = await db.select().from(auditLogs).where(and(eq(auditLogs.action, "registration.deadline_moved_for_outage"), eq(auditLogs.entityId, reservation)));
    expect(trail.map((row) => (row.metadataJson as { kind: string }).kind).sort()).toEqual(["emailLink", "familyReservation"]);
  });

  it("moves each link's token in lockstep with its row, and no token whose row did not move", async () => {
    const event = await createEvent();
    const cancelled = await createEvent();
    const linkId = await register(event, { status: "PENDING_EMAIL_CONFIRMATION", emailLinkExpiresAt: new Date("2026-10-03T11:00:00.000Z") });
    const offerId = await register(event, { status: "WAITLIST_OFFERED", holdExpiresAt: new Date("2026-10-03T14:00:00.000Z"), waitlistedAt: ANCHOR });
    const elsewhere = await register(cancelled, { status: "WAITLIST_OFFERED", holdExpiresAt: new Date("2026-10-03T14:00:00.000Z"), waitlistedAt: ANCHOR });
    await db.update(events).set({ eventStatus: "CANCELLED" }).where(eq(events.id, cancelled.id));
    // A token that does not end with its row's deadline (another instant): never this move's to touch.
    const drifted = await register(event, { status: "PENDING_EMAIL_CONFIRMATION", emailLinkExpiresAt: new Date("2026-10-03T12:00:00.000Z") });
    const invitation = await invite(event, new Date("2026-10-03T13:00:00.000Z"));
    const grace = 30 * DAY;

    const verify = await token({ participantId: (await rowOf(linkId)).participantId, registrationId: linkId, purpose: "VERIFY_REGISTRATION_EMAIL", expiresAt: new Date("2026-10-03T11:00:00.000Z") });
    const offer = await token({ participantId: (await rowOf(offerId)).participantId, registrationId: offerId, purpose: "WAITLIST_OFFER", expiresAt: new Date("2026-10-03T14:00:00.000Z") });
    const still = await token({ participantId: (await rowOf(elsewhere)).participantId, registrationId: elsewhere, purpose: "WAITLIST_OFFER", expiresAt: new Date("2026-10-03T14:00:00.000Z") });
    const other = await token({ participantId: (await rowOf(drifted)).participantId, registrationId: drifted, purpose: "VERIFY_REGISTRATION_EMAIL", expiresAt: new Date("2026-10-03T12:30:00.000Z") });
    const accept = await token({ participantId: invitation.participantId, registrationId: null, invitationId: invitation.id, purpose: "ACCEPT_INVITATION", expiresAt: new Date(Date.parse("2026-10-03T13:00:00.000Z") + grace) });

    await runRegistrationMaintenance(db, NOW, deps("resolves"));

    expect((await tokenOf(verify.id)).expiresAt).toEqual(after("2026-10-03T11:00:00.000Z"));
    expect((await tokenOf(offer.id)).expiresAt).toEqual(after("2026-10-03T14:00:00.000Z"));
    expect((await rowOf(offerId)).holdExpiresAt).toEqual(after("2026-10-03T14:00:00.000Z"));
    expect((await tokenOf(accept.id)).expiresAt).toEqual(new Date(after("2026-10-03T13:00:00.000Z").getTime() + grace));
    // A cancelled event moves nothing, and so its offer's token stays; a token not ending with its row stays.
    expect((await rowOf(elsewhere)).holdExpiresAt).toEqual(new Date("2026-10-03T14:00:00.000Z"));
    expect((await tokenOf(still.id)).expiresAt).toEqual(new Date("2026-10-03T14:00:00.000Z"));
    expect((await rowOf(drifted)).emailLinkExpiresAt).toEqual(after("2026-10-03T12:00:00.000Z"));
    expect((await tokenOf(other.id)).expiresAt).toEqual(new Date("2026-10-03T12:30:00.000Z"));
  });

  it("materialises a link written before the column, from the submission plus the club's hours, and moves it", async () => {
    const event = await createEvent();
    const id = await register(event, { status: "PENDING_EMAIL_CONFIRMATION", emailLinkExpiresAt: null, submittedAt: new Date("2026-10-01T12:00:00.000Z") });
    await runRegistrationMaintenance(db, NOW, deps("resolves"));
    // 48 hours after the submission is 12:00 on the 3rd, in the window: moved by the window's length.
    expect((await rowOf(id)).emailLinkExpiresAt).toEqual(after("2026-10-03T12:00:00.000Z"));
  });

  it("moves a test registration exactly like a real one", async () => {
    const event = await createEvent();
    const real = await register(event, { status: "PENDING_DECLARATION", holdExpiresAt: new Date("2026-10-03T12:00:00.000Z") });
    const test = await register(event, { status: "PENDING_DECLARATION", holdExpiresAt: new Date("2026-10-03T12:00:00.000Z"), kind: "TEST" });
    await runRegistrationMaintenance(db, NOW, deps("resolves"));
    expect((await rowOf(test)).holdExpiresAt).toEqual((await rowOf(real)).holdExpiresAt);
    expect((await rowOf(test)).holdExpiresAt).toEqual(after("2026-10-03T12:00:00.000Z"));
  });

  it("never moves a hold past the registration's close", async () => {
    const closesAt = new Date("2026-10-03T17:00:00.000Z");
    const event = await createEvent({ registrationClosesAt: closesAt });
    const id = await register(event, { status: "PENDING_DECLARATION", holdExpiresAt: new Date("2026-10-03T14:00:00.000Z") });
    await runRegistrationMaintenance(db, NOW, deps("resolves"));
    expect((await rowOf(id)).holdExpiresAt).toEqual(closesAt);
  });

  it("never moves a hold, an offer or an invitation past the event's start", async () => {
    const startsAt = new Date("2026-10-03T18:00:00.000Z");
    const event = await createEvent({ startsAt });
    const hold = await register(event, { status: "PENDING_DECLARATION", holdExpiresAt: new Date("2026-10-03T14:00:00.000Z") });
    const offer = await register(event, { status: "WAITLIST_OFFERED", holdExpiresAt: new Date("2026-10-03T15:00:00.000Z"), waitlistedAt: ANCHOR });
    const invitation = await invite(event, new Date("2026-10-03T15:30:00.000Z"));
    await runRegistrationMaintenance(db, NOW, deps("resolves"));
    expect((await rowOf(hold)).holdExpiresAt).toEqual(startsAt);
    expect((await rowOf(offer)).holdExpiresAt).toEqual(startsAt);
    expect((await db.select().from(eventInvitations).where(eq(eventInvitations.id, invitation.id)))[0].expiresAt).toEqual(startsAt);
  });

  it("seats a revived offer outside the places when its place was given meanwhile, and overbooks nothing", async () => {
    const event = await createEvent({ capacity: 1 });
    // The offer lapsed at 10:00, in the window; on the next read its place was free, and it was given.
    const offered = await register(event, { status: "WAITLIST_OFFERED", holdExpiresAt: new Date("2026-10-03T10:00:00.000Z"), waitlistedAt: ANCHOR });
    await register(event, { status: "CONFIRMED", confirmedAt: new Date("2026-10-03T15:30:00.000Z") });

    const result = await runRegistrationMaintenance(db, NOW, deps("resolves"));

    const row = await rowOf(offered);
    expect(row.status).toBe("WAITLIST_OFFERED");
    expect(row.holdExpiresAt).toEqual(after("2026-10-03T10:00:00.000Z"));
    expect(row.outsideCapacity).toBe(true);
    expect(result.outageGrace.outside).toBe(1);
    expect(computeOccupied(await countOccupied(db, event.id, NOW))).toBeLessThanOrEqual(1);
    const marks = await db.select().from(auditLogs).where(and(eq(auditLogs.action, "registration.seated_outside_for_outage_grace"), eq(auditLogs.entityId, offered)));
    expect(marks).toHaveLength(1);
    expect(marks[0].actorStaffUserId).toBeNull();
    expect(marks[0].metadataJson).toMatchObject({ from: false, to: true });
    const [window] = await windows();
    expect(window.placesOutside).toBe(1);
    // The closed email counts it, and its paragraphs say to look at the list.
    const [closed] = await outbox("UNREACHABLE_WINDOW_CLOSED");
    expect(closed.payloadJson).toMatchObject({ outside: 1, moved: 1 });
  });

  it("seats a revived invitation outside the places when its place was given meanwhile", async () => {
    const event = await createEvent({ capacity: 1 });
    const lapsedAt = new Date("2026-10-03T10:00:00.000Z");
    const invitation = await invite(event, lapsedAt);
    await register(event, { status: "CONFIRMED", confirmedAt: new Date("2026-10-03T15:30:00.000Z") });

    await runRegistrationMaintenance(db, NOW, deps("resolves"));

    const [later] = await db.select().from(eventInvitations).where(eq(eventInvitations.id, invitation.id));
    expect(later.expiredAt).toBeNull();
    expect(later.expiresAt).toEqual(new Date(lapsedAt.getTime() + STOP));
    expect(later.outsideCapacity).toBe(true);
    expect(computeOccupied(await countOccupied(db, event.id, NOW))).toBe(1);
    const [moved] = await db.select().from(auditLogs).where(eq(auditLogs.action, "event.invitation_deadline_moved_for_outage"));
    expect(moved.metadataJson).toMatchObject({ invitationId: invitation.id, outsideCapacity: true });
  });

  it("leaves a family's reservation and held place to lapse when their place was given meanwhile — never seated outside", async () => {
    const event = await createEvent({ capacity: 1 });
    const reservation = await register(event, { status: "PENDING_EMAIL_CONFIRMATION", holdExpiresAt: new Date("2026-10-03T10:00:00.000Z"), emailLinkExpiresAt: new Date(NOW.getTime() + DAY) });
    const [placeHold] = await db
      .insert(familyPlaceHolds)
      .values({ eventId: event.id, sittingKey: randomUUID(), slot: "1", expiresAt: new Date("2026-10-03T10:30:00.000Z") })
      .returning();
    await register(event, { status: "CONFIRMED", confirmedAt: new Date("2026-10-03T15:30:00.000Z") });

    const result = await runRegistrationMaintenance(db, NOW, deps("resolves"));

    const row = await rowOf(reservation);
    expect(row.outsideCapacity).toBe(false);
    // Put back as it was (or already cleared by the sweep): lapsed, never moved — the address, once confirmed, joins the line.
    expect([null, Date.parse("2026-10-03T10:00:00.000Z")]).toContain(row.holdExpiresAt?.getTime() ?? null);
    expect(row.status).toBe("PENDING_EMAIL_CONFIRMATION");
    const [held] = await db.select().from(familyPlaceHolds).where(eq(familyPlaceHolds.id, placeHold.id));
    expect(held === undefined || held.expiresAt.getTime() === Date.parse("2026-10-03T10:30:00.000Z")).toBe(true);
    expect(await db.select().from(auditLogs).where(and(eq(auditLogs.action, "registration.deadline_moved_for_outage"), eq(auditLogs.entityId, reservation)))).toHaveLength(1);
    expect(result.outageGrace.outside).toBe(0);
    expect(computeOccupied(await countOccupied(db, event.id, NOW))).toBe(1);
    expect(await db.select().from(auditLogs).where(eq(auditLogs.action, "registration.seated_outside_for_outage_grace"))).toHaveLength(0);
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

  it("tells every Administrator once what moved, on the club's road, and a second run moves nothing more", async () => {
    const event = await createEvent();
    const id = await register(event, { status: "PENDING_DECLARATION", holdExpiresAt: new Date("2026-10-03T12:00:00.000Z") });
    await runRegistrationMaintenance(db, NOW, deps("resolves"));
    const movedOnce = (await rowOf(id)).holdExpiresAt;
    // A second run a quarter of an hour on: the window is done, nothing moves twice, nobody is told twice.
    const second = await runRegistrationMaintenance(db, new Date(NOW.getTime() + 15 * MINUTE), deps("resolves", async () => [ANCHOR, NOW]));
    expect(second.outageGrace.moved).toBe(0);
    expect((await rowOf(id)).holdExpiresAt).toEqual(movedOnce);
    const notices = await outbox("UNREACHABLE_WINDOW_CLOSED");
    expect(notices.map((row) => row.recipientEmail)).toEqual(["admin@club.test"]);
    expect(notices[0].participantId).toBeNull();
    expect(notices[0].idempotencyKey).toMatch(/^unreachable:[0-9a-f-]+:closed:[0-9a-f-]+$/);
    expect(notices[0].payloadJson).toMatchObject({ source: "pings", moved: 1, outside: 0, grantedMinutes: STOP / MINUTE });
    expect(await windows()).toHaveLength(1);
    expect(await db.select().from(auditLogs).where(eq(auditLogs.action, "registration.deadline_moved_for_outage"))).toHaveLength(1);
    expect(await outbox("UNREACHABLE_WINDOW_OPENED")).toHaveLength(0);
  });

  it("caps what is given back at the club's «Termene» number", async () => {
    await setOutageCap(2);
    const event = await createEvent();
    const id = await register(event, { status: "PENDING_DECLARATION", holdExpiresAt: new Date("2026-10-03T15:30:00.000Z") });
    // A deadline the capped move would still leave behind this run is not written at all: it changes no answer.
    const behind = await register(event, { status: "PENDING_DECLARATION", holdExpiresAt: new Date("2026-10-03T12:00:00.000Z") });
    await runRegistrationMaintenance(db, NOW, deps("resolves"));
    expect((await rowOf(id)).holdExpiresAt).toEqual(new Date(Date.parse("2026-10-03T15:30:00.000Z") + 2 * HOUR));
    expect((await rowOf(behind)).holdExpiresAt).toEqual(new Date("2026-10-03T12:00:00.000Z"));
    const [window] = await windows();
    expect(window.grantedMs).toBe(2 * HOUR);
  });

  it("at 0 still records the window and sends the closed email once, but moves nothing and holds no sweep", async () => {
    await setOutageCap(0);
    const event = await createEvent();
    const offered = await register(event, { status: "WAITLIST_OFFERED", holdExpiresAt: new Date("2026-10-03T10:00:00.000Z"), waitlistedAt: ANCHOR });
    const ahead = await register(event, { status: "PENDING_DECLARATION", holdExpiresAt: new Date(NOW.getTime() + DAY) });
    await runRegistrationMaintenance(db, NOW, deps("resolves"));
    const [window] = await windows();
    expect(window).toMatchObject({ source: "pings", startedAt: WINDOW_START, endedAt: NOW, grantedMs: 0, rowsMoved: 0, placesOutside: 0 });
    expect(window.appliedAt).not.toBeNull();
    expect((await rowOf(offered)).status).toBe("EXPIRED");
    expect((await rowOf(ahead)).holdExpiresAt).toEqual(new Date(NOW.getTime() + DAY));
    await runRegistrationMaintenance(db, new Date(NOW.getTime() + 15 * MINUTE), deps("resolves", async () => [ANCHOR, NOW]));
    const closed = await outbox("UNREACHABLE_WINDOW_CLOSED");
    expect(closed).toHaveLength(1);
    expect(closed[0].payloadJson).toMatchObject({ grantedMinutes: 0, maxHours: 0, moved: 0 });
  });

  it("reads no silence from a cache that has forgotten the last run's own ping", async () => {
    const event = await createEvent();
    const offered = await register(event, { status: "WAITLIST_OFFERED", holdExpiresAt: new Date("2026-10-03T10:00:00.000Z"), waitlistedAt: ANCHOR });
    await runRegistrationMaintenance(db, NOW, deps("resolves", async () => null));
    expect(await windows()).toHaveLength(0);
    expect((await rowOf(offered)).status).toBe("EXPIRED");
  });

  it("reads no silence where a real run of either job happened in it", async () => {
    await db.insert(jobRuns).values({ jobName: "email-outbox", startedAt: new Date("2026-10-03T12:30:00.000Z"), finishedAt: new Date("2026-10-03T12:30:01.000Z") });
    await db.insert(jobRuns).values({ jobName: "email-outbox", startedAt: new Date("2026-10-03T13:00:00.000Z"), finishedAt: new Date("2026-10-03T13:00:01.000Z") });
    await runRegistrationMaintenance(db, NOW, deps("resolves", async () => [ANCHOR, new Date("2026-10-03T08:30:00.000Z"), LAST_PING, new Date("2026-10-03T09:30:00.000Z"), new Date("2026-10-03T10:00:00.000Z"), new Date("2026-10-03T10:30:00.000Z"), new Date("2026-10-03T11:00:00.000Z"), new Date("2026-10-03T11:30:00.000Z"), new Date("2026-10-03T12:00:00.000Z"), new Date("2026-10-03T13:30:00.000Z"), new Date("2026-10-03T14:00:00.000Z"), new Date("2026-10-03T14:30:00.000Z"), new Date("2026-10-03T15:00:00.000Z"), new Date("2026-10-03T15:30:00.000Z")]));
    expect(await windows()).toHaveLength(0);
  });
});

describe("§NNN the name does not resolve: two probes ten minutes apart, the window stays open, nothing lapses, then everything moves", () => {
  // Every call arrives (by another address); only the name is gone.
  const everyQuarter: OutageGraceDeps["readPings"] = async (_anchor, now) => {
    const pings: Date[] = [];
    for (let at = ANCHOR.getTime(); at <= now.getTime(); at += 15 * MINUTE) pings.push(new Date(at));
    return pings;
  };

  it("opens nothing on the first «no such name»: the sweeps run, nobody is told", async () => {
    const event = await createEvent();
    const offered = await register(event, { status: "WAITLIST_OFFERED", holdExpiresAt: new Date("2026-10-03T09:50:00.000Z"), waitlistedAt: ANCHOR });
    const first = await runRegistrationMaintenance(db, new Date("2026-10-03T10:00:00.000Z"), deps("unresolved", everyQuarter));
    expect(first.outageGrace.holding).toBe(false);
    expect((await rowOf(offered)).status).toBe("EXPIRED");
    const [suspicion] = await windows();
    expect(suspicion).toMatchObject({ source: "dns", startedAt: new Date("2026-10-03T10:00:00.000Z"), endedAt: null, confirmedAt: null });
    expect(await outbox("UNREACHABLE_WINDOW_OPENED")).toHaveLength(0);
    // The name answers at the next run: the suspicion is gone, as if nothing had happened.
    await runRegistrationMaintenance(db, new Date("2026-10-03T10:15:00.000Z"), deps("resolves", everyQuarter));
    expect(await windows()).toHaveLength(0);
    expect(await outbox("UNREACHABLE_WINDOW_CLOSED")).toHaveLength(0);
  });

  it("opens the window at the first probe's instant on a second one ten minutes on, holds every lapse, and moves on the name's return", async () => {
    const event = await createEvent();
    const offered = await register(event, { status: "WAITLIST_OFFERED", holdExpiresAt: new Date("2026-10-03T10:30:00.000Z"), waitlistedAt: ANCHOR });
    const link = await register(event, { status: "PENDING_EMAIL_CONFIRMATION", emailLinkExpiresAt: new Date("2026-10-03T11:00:00.000Z") });

    await runRegistrationMaintenance(db, new Date("2026-10-03T10:00:00.000Z"), deps("unresolved", everyQuarter));
    // Five minutes on: not ten yet, still only suspected.
    const early = await runRegistrationMaintenance(db, new Date("2026-10-03T10:05:00.000Z"), deps("unresolved", everyQuarter));
    expect(early.outageGrace.holding).toBe(false);
    expect((await windows())[0].confirmedAt).toBeNull();

    const confirmed = await runRegistrationMaintenance(db, new Date("2026-10-03T10:12:00.000Z"), deps("unresolved", everyQuarter));
    expect(confirmed.outageGrace.holding).toBe(true);
    const [open] = await windows();
    expect(open).toMatchObject({ source: "dns", startedAt: new Date("2026-10-03T10:00:00.000Z"), endedAt: null });
    expect(open.confirmedAt).not.toBeNull();
    const opened = await outbox("UNREACHABLE_WINDOW_OPENED");
    expect(opened.map((row) => row.recipientEmail)).toEqual(["admin@club.test"]);
    expect(opened[0].idempotencyKey).toBe(`unreachable:${open.id}:opened:${opened[0].idempotencyKey.split(":").at(-1)}`);

    // Later, still gone: the offer and the link are past their deadlines and nothing ends them.
    const still = await runRegistrationMaintenance(db, new Date("2026-10-03T11:30:00.000Z"), deps("unresolved", everyQuarter));
    expect(still.outageGrace.holding).toBe(true);
    expect((await rowOf(offered)).status).toBe("WAITLIST_OFFERED");
    expect((await rowOf(link)).status).toBe("PENDING_EMAIL_CONFIRMATION");
    expect(await outbox("UNREACHABLE_WINDOW_OPENED")).toHaveLength(1);

    // The name is back at 13:00: the window closes and three hours are given back.
    const back = new Date("2026-10-03T13:00:00.000Z");
    const reopened = await runRegistrationMaintenance(db, back, deps("resolves", everyQuarter));
    expect(reopened.outageGrace.holding).toBe(false);
    const [closed] = await windows();
    expect(closed.endedAt).toEqual(back);
    expect(closed.grantedMs).toBe(3 * HOUR);
    expect((await rowOf(offered)).holdExpiresAt).toEqual(new Date("2026-10-03T13:30:00.000Z"));
    expect((await rowOf(offered)).status).toBe("WAITLIST_OFFERED");
    expect((await rowOf(link)).emailLinkExpiresAt).toEqual(new Date("2026-10-03T14:00:00.000Z"));
    const trail = await db.select().from(auditLogs).where(eq(auditLogs.action, "registration.deadline_moved_for_outage"));
    expect(trail.every((row) => (row.metadataJson as { source?: string }).source === "dns")).toBe(true);

    // Once each, whatever runs after.
    await runRegistrationMaintenance(db, new Date("2026-10-03T13:15:00.000Z"), deps("resolves", everyQuarter));
    expect(await outbox("UNREACHABLE_WINDOW_CLOSED")).toHaveLength(1);
    expect(await outbox("UNREACHABLE_WINDOW_OPENED")).toHaveLength(1);
    expect((await rowOf(offered)).holdExpiresAt).toEqual(new Date("2026-10-03T13:30:00.000Z"));
  });

  it("at 0 still opens, announces and closes the window, but holds no sweep and moves nothing", async () => {
    await setOutageCap(0);
    const event = await createEvent();
    const offered = await register(event, { status: "WAITLIST_OFFERED", holdExpiresAt: new Date("2026-10-03T10:30:00.000Z"), waitlistedAt: ANCHOR });
    await runRegistrationMaintenance(db, new Date("2026-10-03T10:00:00.000Z"), deps("unresolved", everyQuarter));
    const confirmed = await runRegistrationMaintenance(db, new Date("2026-10-03T10:45:00.000Z"), deps("unresolved", everyQuarter));
    expect(confirmed.outageGrace.holding).toBe(false);
    expect((await rowOf(offered)).status).toBe("EXPIRED");
    expect(await outbox("UNREACHABLE_WINDOW_OPENED")).toHaveLength(1);
    await runRegistrationMaintenance(db, new Date("2026-10-03T12:00:00.000Z"), deps("resolves", everyQuarter));
    const [window] = await windows();
    expect(window).toMatchObject({ endedAt: new Date("2026-10-03T12:00:00.000Z"), grantedMs: 0, rowsMoved: 0 });
    expect(await outbox("UNREACHABLE_WINDOW_CLOSED")).toHaveLength(1);
  });

  it("answers nothing on a resolver that does not answer: no window opens, the sweeps run", async () => {
    const event = await createEvent();
    const offered = await register(event, { status: "WAITLIST_OFFERED", holdExpiresAt: new Date("2026-10-03T10:00:00.000Z"), waitlistedAt: ANCHOR });
    const at = new Date("2026-10-03T10:30:00.000Z");
    await runRegistrationMaintenance(db, at, deps("unknown", everyQuarter));
    expect(await windows()).toHaveLength(0);
    expect((await rowOf(offered)).status).toBe("EXPIRED");
  });
});
