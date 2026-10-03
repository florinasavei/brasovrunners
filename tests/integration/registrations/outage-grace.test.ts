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
import { applyOutageGrace, type OutageGraceDeps } from "@/modules/registrations/outage-grace";
import type { NameProbeStatus } from "@/modules/resilience/domain/name-probe";
import { runRegistrationMaintenance } from "@/modules/registrations/maintenance";
import { countOccupied, expireStaleHolds, expireStalePendingEmailConfirmations, lockEventForCapacity } from "@/modules/registrations/repository";
import { countNotRevivedWaiting, readUnreachableWindows } from "@/modules/jobs/unreachable-windows";
import { nextMaintenanceWork } from "@/modules/jobs/next-work";
import { type EventForRegistration, submitRegistration } from "@/modules/registrations/service";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";

/**
 * §NNN — the clock stops while the door is shut (the outage grace). On 2026-10-03 a registrar hold for
 * the contact verification took the club's domain away for about seven hours: the pingers call the
 * public name, so no job ran, while every deadline kept running. Here the platform is unreachable two
 * ways — the pings fall silent (a window seen once it is over), and the job, reached by another
 * address, finds the name gone on two probes ten minutes apart (a window held open until it answers) —
 * and the maintenance run must move what was running, never what had passed before, never past the
 * close or the start, never onto a place somebody else holds: a lapsed claim whose place was given
 * meanwhile is not revived — it lapses as it would have, audited and named to the Administrators — and
 * the job seats nobody: no row marked outside the places, no capacity raised, the counted places within
 * the capacity.
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

/** Both pingers' calls at the same instants, as the cache returns them: by job. */
const byJob = (instants: Date[]) => ({ "registration-maintenance": instants, "email-outbox": instants });

/** The pings the cache remembers: the 08:00 run's, then every quarter of an hour to 09:00, then nothing — of both jobs. */
const silentAfterNine: OutageGraceDeps["readPings"] = async () => byJob([0, 15, 30, 45, 60].map((minutes) => new Date(ANCHOR.getTime() + minutes * MINUTE)));

function deps(probe: NameProbeStatus, readPings: OutageGraceDeps["readPings"] = silentAfterNine): OutageGraceDeps {
  return {
    probe: async () => ({ status: probe, host: "club.example.com", checkedAt: NOW.toISOString() }),
    readPings,
    recordReading: async () => undefined,
    dayCadence: 15,
    pinger: true,
  };
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
      .values({ eventId: event.id, participantId: own.participantId, registrationId: reservation, locale: "ro", heldUntil: ANCHOR, expiresAt: new Date("2026-10-03T11:00:00.000Z"), actionTokenId: sittingToken.id, createdAt: ANCHOR })
      .returning();
    const [placeHold] = await db
      .insert(familyPlaceHolds)
      .values({ eventId: event.id, sittingKey: randomUUID(), slot: "1", expiresAt: new Date("2026-10-03T12:30:00.000Z"), createdAt: ANCHOR })
      .returning();
    const formToken = await token({ participantId: own.participantId, registrationId: reservation, purpose: "REGISTER_ANOTHER_PERSON", expiresAt: new Date("2026-10-03T11:15:00.000Z") });
    const [form] = await db
      .insert(pendingFamilyEntries)
      .values({ eventId: event.id, participantId: own.participantId, registrationId: reservation, locale: "ro", fields: {}, expiresAt: new Date("2026-10-03T11:15:00.000Z"), actionTokenId: formToken.id, createdAt: ANCHOR })
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

  it("moves a legacy link's live token by the same amount, though it ends at the send's instant, not the submission's", async () => {
    const event = await createEvent();
    const id = await register(event, { status: "PENDING_EMAIL_CONFIRMATION", emailLinkExpiresAt: null, submittedAt: new Date("2026-10-01T12:00:00.000Z") });
    const participantId = (await rowOf(id)).participantId;
    // Minted when the email left, two minutes after the submission: never the row's instant, moved all the same.
    const live = await token({ participantId, registrationId: id, purpose: "VERIFY_REGISTRATION_EMAIL", expiresAt: new Date("2026-10-03T12:02:00.000Z") });
    await runRegistrationMaintenance(db, NOW, deps("resolves"));
    expect((await rowOf(id)).emailLinkExpiresAt).toEqual(after("2026-10-03T12:00:00.000Z"));
    expect((await tokenOf(live.id)).expiresAt).toEqual(after("2026-10-03T12:02:00.000Z"));
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

  it("does not revive an offer whose place was given meanwhile: it lapses as it would have, audited and named, and the job seats nobody", async () => {
    const event = await createEvent({ capacity: 1 });
    // The offer lapsed at 10:00, in the window; on the next read its place was free, and it was given.
    const offered = await register(event, { status: "WAITLIST_OFFERED", holdExpiresAt: new Date("2026-10-03T10:00:00.000Z"), waitlistedAt: ANCHOR });
    const offerToken = await token({ participantId: (await rowOf(offered)).participantId, registrationId: offered, purpose: "WAITLIST_OFFER", expiresAt: new Date("2026-10-03T10:00:00.000Z") });
    await register(event, { status: "CONFIRMED", confirmedAt: new Date("2026-10-03T15:30:00.000Z") });

    const result = await runRegistrationMaintenance(db, NOW, deps("resolves"));

    const row = await rowOf(offered);
    // Lapsed by the run's own sweep, from its own deadline: never revived, never seated outside, the capacity untouched.
    expect(row.status).toBe("EXPIRED");
    expect(row.expiryReason).toBe("WAITLIST_OFFER_LAPSED");
    expect(row.holdExpiresAt).toEqual(new Date("2026-10-03T10:00:00.000Z"));
    expect(row.outsideCapacity).toBe(false);
    expect((await tokenOf(offerToken.id)).expiresAt).toEqual(new Date("2026-10-03T10:00:00.000Z"));
    expect((await db.select().from(events).where(eq(events.id, event.id)))[0].capacity).toBe(1);
    expect(computeOccupied(await countOccupied(db, event.id, NOW))).toBe(1);
    expect(result.outageGrace.notRevived).toBe(1);

    const left = await db.select().from(auditLogs).where(and(eq(auditLogs.action, "registration.not_revived_for_outage"), eq(auditLogs.entityId, offered)));
    expect(left).toHaveLength(1);
    expect(left[0].actorStaffUserId).toBeNull();
    const [window] = await windows();
    expect(left[0].metadataJson).toEqual({ kind: "offer", windowId: window.id, deadline: "2026-10-03T10:00:00.000Z" });
    expect(await db.select().from(auditLogs).where(and(eq(auditLogs.action, "registration.deadline_moved_for_outage"), eq(auditLogs.entityId, offered)))).toHaveLength(0);
    expect(window.claimsNotRevived).toBe(1);
    expect(window.notRevived).toEqual([{ kind: "offer", id: offered, eventId: event.id }]);
    // The closed email carries the claim by id; the send names the person.
    const [closed] = await outbox("UNREACHABLE_WINDOW_CLOSED");
    expect(closed.payloadJson).toMatchObject({ notRevived: 1, claims: [{ kind: "offer", id: offered, eventId: event.id }] });
    expect(JSON.stringify(closed.payloadJson)).not.toContain("Pop");
  });

  it("puts a not-revived claim back exactly as it was, its updated_at too, when the sweep will not lapse it this run", async () => {
    // A family's reservation: its lapse clears the deadline, so put back first and then cleared.
    const event = await createEvent({ capacity: 1 });
    // Its link passed before the window: only the reservation is the grace's to look at.
    const reservation = await register(event, { status: "PENDING_EMAIL_CONFIRMATION", holdExpiresAt: new Date("2026-10-03T10:00:00.000Z"), emailLinkExpiresAt: new Date("2026-10-03T09:00:00.000Z") });
    await db.update(registrations).set({ updatedAt: new Date("2026-10-03T08:05:00.000Z") }).where(eq(registrations.id, reservation));
    await register(event, { status: "CONFIRMED", confirmedAt: new Date("2026-10-03T15:30:00.000Z") });
    const { applyOutageGrace } = await import("@/modules/registrations/outage-grace");
    // The grace alone, without the sweep: the claim is as it was before the run.
    await applyOutageGrace(db, NOW, DEFAULT_DEADLINES, deps("resolves"));
    const row = await rowOf(reservation);
    expect(row.holdExpiresAt).toEqual(new Date("2026-10-03T10:00:00.000Z"));
    expect(row.updatedAt).toEqual(new Date("2026-10-03T08:05:00.000Z"));
    expect(row.outsideCapacity).toBe(false);
  });

  it("does not revive an invitation whose place was given meanwhile: it lapses, audited on the event, and the free count never counts a place twice", async () => {
    const event = await createEvent({ capacity: 1 });
    const lapsedAt = new Date("2026-10-03T10:00:00.000Z");
    const invitation = await invite(event, lapsedAt);
    await register(event, { status: "CONFIRMED", confirmedAt: new Date("2026-10-03T15:30:00.000Z") });

    await runRegistrationMaintenance(db, NOW, deps("resolves"));

    const [later] = await db.select().from(eventInvitations).where(eq(eventInvitations.id, invitation.id));
    expect(later.expiresAt).toEqual(lapsedAt);
    expect(later.expiredAt).not.toBeNull();
    expect(later.outsideCapacity).toBe(false);
    expect(computeOccupied(await countOccupied(db, event.id, NOW))).toBe(1);
    const [left] = await db.select().from(auditLogs).where(eq(auditLogs.action, "event.invitation_not_revived_for_outage"));
    expect(left.metadataJson).toMatchObject({ invitationId: invitation.id, deadline: lapsedAt.toISOString() });
    expect(left.entityId).toBe(event.id);
    const [window] = await windows();
    expect(window.notRevived).toEqual([{ kind: "invitation", id: invitation.id, eventId: event.id }]);
  });

  it("does not revive a family's reservation or held place whose place was given meanwhile — and never marks or raises anything", async () => {
    const event = await createEvent({ capacity: 1 });
    const reservation = await register(event, { status: "PENDING_EMAIL_CONFIRMATION", holdExpiresAt: new Date("2026-10-03T10:00:00.000Z"), emailLinkExpiresAt: new Date(NOW.getTime() + DAY) });
    const [placeHold] = await db
      .insert(familyPlaceHolds)
      .values({ eventId: event.id, sittingKey: randomUUID(), slot: "1", expiresAt: new Date("2026-10-03T10:30:00.000Z"), createdAt: ANCHOR })
      .returning();
    await register(event, { status: "CONFIRMED", confirmedAt: new Date("2026-10-03T15:30:00.000Z") });

    const result = await runRegistrationMaintenance(db, NOW, deps("resolves"));

    const row = await rowOf(reservation);
    expect(row.outsideCapacity).toBe(false);
    // Put back as it was (or already cleared by the sweep): lapsed from its own deadline, never moved — the address, once confirmed, joins the line.
    expect([null, Date.parse("2026-10-03T10:00:00.000Z")]).toContain(row.holdExpiresAt?.getTime() ?? null);
    expect(row.status).toBe("PENDING_EMAIL_CONFIRMATION");
    const [held] = await db.select().from(familyPlaceHolds).where(eq(familyPlaceHolds.id, placeHold.id));
    expect(held === undefined || held.expiresAt.getTime() === Date.parse("2026-10-03T10:30:00.000Z")).toBe(true);
    expect(await db.select().from(auditLogs).where(and(eq(auditLogs.action, "registration.not_revived_for_outage"), eq(auditLogs.entityId, reservation)))).toHaveLength(1);
    expect(result.outageGrace.notRevived).toBe(2);
    expect(computeOccupied(await countOccupied(db, event.id, NOW))).toBe(1);
    expect((await db.select().from(events).where(eq(events.id, event.id)))[0].capacity).toBe(1);
    const [window] = await windows();
    expect(window.notRevived.map((claim) => claim.kind).sort()).toEqual(["familyReservation", "placeHold"]);
  });

  it("revives the oldest claim into the one place left, and leaves the next one lapsed", async () => {
    const event = await createEvent({ capacity: 2 });
    await register(event, { status: "CONFIRMED", confirmedAt: ANCHOR });
    const first = await register(event, { status: "WAITLIST_OFFERED", holdExpiresAt: new Date("2026-10-03T10:00:00.000Z"), waitlistedAt: ANCHOR });
    const second = await register(event, { status: "WAITLIST_OFFERED", holdExpiresAt: new Date("2026-10-03T11:00:00.000Z"), waitlistedAt: ANCHOR });
    await runRegistrationMaintenance(db, NOW, deps("resolves"));
    expect((await rowOf(first)).status).toBe("WAITLIST_OFFERED");
    expect((await rowOf(first)).holdExpiresAt).toEqual(after("2026-10-03T10:00:00.000Z"));
    expect((await rowOf(second)).status).toBe("EXPIRED");
    expect(computeOccupied(await countOccupied(db, event.id, NOW))).toBe(2);
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
    const second = await runRegistrationMaintenance(db, new Date(NOW.getTime() + 15 * MINUTE), deps("resolves", async () => byJob([ANCHOR, NOW])));
    expect(second.outageGrace.moved).toBe(0);
    expect((await rowOf(id)).holdExpiresAt).toEqual(movedOnce);
    const notices = await outbox("UNREACHABLE_WINDOW_CLOSED");
    expect(notices.map((row) => row.recipientEmail)).toEqual(["admin@club.test"]);
    expect(notices[0].participantId).toBeNull();
    expect(notices[0].idempotencyKey).toMatch(/^unreachable:[0-9a-f-]+:closed:[0-9a-f-]+$/);
    expect(notices[0].payloadJson).toMatchObject({ source: "pings", moved: 1, notRevived: 0, claims: [], grantedMinutes: STOP / MINUTE });
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
    expect(window).toMatchObject({ source: "pings", startedAt: WINDOW_START, endedAt: NOW, grantedMs: 0, appliedMs: 0, rowsMoved: 0, claimsNotRevived: 0 });
    expect(window.appliedAt).not.toBeNull();
    expect((await rowOf(offered)).status).toBe("EXPIRED");
    expect((await rowOf(ahead)).holdExpiresAt).toEqual(new Date(NOW.getTime() + DAY));
    await runRegistrationMaintenance(db, new Date(NOW.getTime() + 15 * MINUTE), deps("resolves", async () => byJob([ANCHOR, NOW])));
    const closed = await outbox("UNREACHABLE_WINDOW_CLOSED");
    expect(closed).toHaveLength(1);
    expect(closed[0].payloadJson).toMatchObject({ grantedMinutes: 0, maxHours: 0, moved: 0 });
  });

  it("reads no silence where the outbox's calls went on while the maintenance's slots were lost: both must be missing together", async () => {
    const quarters: Date[] = [];
    for (let at = ANCHOR.getTime(); at < NOW.getTime(); at += 15 * MINUTE) quarters.push(new Date(at));
    await runRegistrationMaintenance(db, NOW, deps("resolves", async () => ({ "registration-maintenance": quarters.slice(0, 5), "email-outbox": quarters })));
    expect(await windows()).toHaveLength(0);
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
    await runRegistrationMaintenance(db, NOW, deps("resolves", async () => byJob([ANCHOR, new Date("2026-10-03T08:30:00.000Z"), LAST_PING, new Date("2026-10-03T09:30:00.000Z"), new Date("2026-10-03T10:00:00.000Z"), new Date("2026-10-03T10:30:00.000Z"), new Date("2026-10-03T11:00:00.000Z"), new Date("2026-10-03T11:30:00.000Z"), new Date("2026-10-03T12:00:00.000Z"), new Date("2026-10-03T13:30:00.000Z"), new Date("2026-10-03T14:00:00.000Z"), new Date("2026-10-03T14:30:00.000Z"), new Date("2026-10-03T15:00:00.000Z"), new Date("2026-10-03T15:30:00.000Z")])));
    expect(await windows()).toHaveLength(0);
  });
});

describe("§NNN the name does not resolve: two probes ten minutes apart, the window stays open, nothing lapses, then everything moves", () => {
  // Every call arrives (by another address); only the name is gone.
  const everyQuarter: OutageGraceDeps["readPings"] = async (_anchor, now) => {
    const pings: Date[] = [];
    for (let at = ANCHOR.getTime(); at <= now.getTime(); at += 15 * MINUTE) pings.push(new Date(at));
    return byJob(pings);
  };
  const at = (iso: string) => new Date(`2026-10-03T${iso}:00.000Z`);

  it("moves the running deadlines on every run while the window is open: nothing lapses, no place is freed, the grant adds up", async () => {
    const event = await createEvent({ capacity: 1 });
    const offered = await register(event, { status: "WAITLIST_OFFERED", holdExpiresAt: at("10:30"), waitlistedAt: ANCHOR });
    const link = await register(event, { status: "PENDING_EMAIL_CONFIRMATION", emailLinkExpiresAt: at("10:45") });
    const waiting = await register(event, { status: "WAITLISTED", waitlistedAt: new Date(ANCHOR.getTime() + MINUTE) });

    await runRegistrationMaintenance(db, at("10:00"), deps("unresolved", everyQuarter));
    for (const [run, granted] of [["10:12", 12], ["10:35", 35], ["11:00", 60]] as const) {
      const result = await runRegistrationMaintenance(db, at(run), deps("unresolved", everyQuarter));
      expect(result.outageGrace.holding).toBe(true);
      const [open] = await windows();
      expect(open.endedAt).toBeNull();
      expect(open.grantedMs).toBe(granted * MINUTE);
      expect(open.appliedMs).toBe(granted * MINUTE);
      expect(open.stepMs).toBeNull();
      // Each deadline as far ahead of this run as it was of the window's start: the clock stood still for it.
      expect((await rowOf(offered)).holdExpiresAt).toEqual(new Date(at("10:30").getTime() + granted * MINUTE));
      expect((await rowOf(link)).emailLinkExpiresAt).toEqual(new Date(at("10:45").getTime() + granted * MINUTE));
      expect((await rowOf(offered)).status).toBe("WAITLIST_OFFERED");
      // Just before the next run, the offer still holds its place: nothing freed, nobody waiting offered it.
      expect(computeOccupied(await countOccupied(db, event.id, new Date(at(run).getTime() + 20 * MINUTE)))).toBe(1);
      expect((await rowOf(waiting)).status).toBe("WAITLISTED");
    }
    // Moved on three runs, counted once each.
    const [window] = await windows();
    expect(window.rowsMoved).toBe(2);
    expect(await db.select().from(auditLogs).where(and(eq(auditLogs.action, "registration.deadline_moved_for_outage"), eq(auditLogs.entityId, offered)))).toHaveLength(3);

    // The name is back at 11:20: twenty more minutes, and the window is over and announced once.
    await runRegistrationMaintenance(db, at("11:20"), deps("resolves", everyQuarter));
    const [closed] = await windows();
    expect(closed.endedAt).toEqual(at("11:20"));
    expect(closed.grantedMs).toBe(80 * MINUTE);
    expect(closed.appliedMs).toBe(80 * MINUTE);
    expect((await rowOf(offered)).holdExpiresAt).toEqual(at("11:50"));
    expect((await outbox("UNREACHABLE_WINDOW_CLOSED"))[0].payloadJson).toMatchObject({ moved: 2, notRevived: 0 });
  });

  it("stops giving back at the club's cap while the window stays open: the clock runs again, as the cap says", async () => {
    await setOutageCap(1);
    const event = await createEvent();
    const offered = await register(event, { status: "WAITLIST_OFFERED", holdExpiresAt: at("10:30"), waitlistedAt: ANCHOR });
    for (const run of ["10:00", "10:12", "10:40"]) await runRegistrationMaintenance(db, at(run), deps("unresolved", everyQuarter));
    expect((await rowOf(offered)).holdExpiresAt).toEqual(at("11:10"));
    const capped = await runRegistrationMaintenance(db, at("11:30"), deps("unresolved", everyQuarter));
    expect(capped.outageGrace.holding).toBe(false);
    const [open] = await windows();
    expect(open.grantedMs).toBe(HOUR);
    expect(open.appliedMs).toBe(HOUR);
    // An hour given, no more: the offer's deadline, 11:30 at most, is behind this run, and the sweep ends it.
    expect((await rowOf(offered)).status).toBe("EXPIRED");
    // Past the cap a real run would move nothing, so the plan asks for none: the window stays open and recorded, the ordinary quiet holds.
    expect((await windows())[0].endedAt).toBeNull();
    expect(await nextMaintenanceWork(db, at("11:30"))).toBeNull();
  });

  it("plans the job's next real run ten minutes after a suspicion, and at the next ping while a window is open — and nothing for a closed one", async () => {
    await runRegistrationMaintenance(db, at("10:00"), deps("unresolved", everyQuarter));
    const afterSuspicion = await nextMaintenanceWork(db, at("10:00"));
    expect(afterSuspicion).toEqual(at("10:10"));
    // A probe at 10:05 that said nothing: still ten minutes after the first.
    expect(await nextMaintenanceWork(db, at("10:05"))).toEqual(at("10:10"));
    // The ten minutes are behind and the suspicion stands: the next ping.
    expect((await nextMaintenanceWork(db, at("10:20")))?.getTime()).toBeLessThanOrEqual(at("10:20").getTime() + 15 * MINUTE);

    await runRegistrationMaintenance(db, at("10:12"), deps("unresolved", everyQuarter));
    const whileOpen = await nextMaintenanceWork(db, at("10:12"));
    expect(whileOpen).not.toBeNull();
    expect(whileOpen?.getTime() ?? 0).toBeGreaterThan(at("10:12").getTime());
    expect(whileOpen?.getTime() ?? Infinity).toBeLessThanOrEqual(at("10:12").getTime() + 15 * MINUTE);

    await runRegistrationMaintenance(db, at("10:30"), deps("resolves", everyQuarter));
    expect((await windows())[0].endedAt).toEqual(at("10:30"));
    expect(await nextMaintenanceWork(db, at("10:30"))).toBeNull();
  });

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

describe("§NNN a window seen late moves only what was running inside it, and is recorded once", () => {
  // Brașov's 11:19 to 18:30: the last call at 11:04, the first back at 18:30, answered from the cache until this 19:30 run.
  const at = (iso: string) => new Date(`2026-10-03T${iso}:00.000Z`);
  const SHUT = at("08:19");
  const OPEN = at("15:30");
  const RUN = at("16:30");
  const GAP = OPEN.getTime() - SHUT.getTime();
  const lateRecord: OutageGraceDeps["readPings"] = async () => byJob([ANCHOR, at("08:04"), OPEN, at("15:45"), at("16:00"), at("16:15")]);

  it("moves a hold running at the window's start by its length, one written inside it by what was left, and none written after it — reviving nothing", async () => {
    const event = await createEvent();
    const running = await register(event, { status: "PENDING_DECLARATION", holdExpiresAt: at("10:00") });
    const inside = await register(event, { status: "WAITLIST_OFFERED", waitlistedAt: ANCHOR, offerCreatedAt: at("12:00"), holdExpiresAt: at("14:00") });
    const offeredAfter = await register(event, { status: "WAITLIST_OFFERED", waitlistedAt: ANCHOR, offerCreatedAt: at("16:00"), holdExpiresAt: new Date(at("16:00").getTime() + DAY) });
    const linkAfter = await register(event, { status: "PENDING_EMAIL_CONFIRMATION", submittedAt: at("16:10"), emailLinkExpiresAt: new Date(at("16:10").getTime() + 2 * DAY) });
    // Held by a family's sitting at 19:05 in Brașov, lapsed at 19:20: nothing the door took from it.
    const [lapsedAfter] = await db
      .insert(familyPlaceHolds)
      .values({ eventId: event.id, sittingKey: randomUUID(), slot: "1", expiresAt: at("16:20"), createdAt: at("16:05") })
      .returning();
    const invitedAfter = await invite(event, new Date(at("15:50").getTime() + DAY));
    await db.update(eventInvitations).set({ lastSentAt: at("15:50") }).where(eq(eventInvitations.id, invitedAfter.id));
    const occupiedBefore = computeOccupied(await countOccupied(db, event.id, RUN));

    await runRegistrationMaintenance(db, RUN, deps("resolves", lateRecord));

    const [window] = await windows();
    expect(window.endedAt).toEqual(OPEN);
    expect(window.grantedMs).toBe(GAP);
    expect((await rowOf(running)).holdExpiresAt).toEqual(new Date(at("10:00").getTime() + GAP));
    // Written at 15:00 in Brașov, three and a half hours before the door opened: moved by those, not by seven.
    expect((await rowOf(inside)).holdExpiresAt).toEqual(new Date(at("14:00").getTime() + (OPEN.getTime() - at("12:00").getTime())));
    expect((await rowOf(offeredAfter)).holdExpiresAt).toEqual(new Date(at("16:00").getTime() + DAY));
    expect((await rowOf(linkAfter)).emailLinkExpiresAt).toEqual(new Date(at("16:10").getTime() + 2 * DAY));
    expect((await db.select().from(eventInvitations).where(eq(eventInvitations.id, invitedAfter.id)))[0].expiresAt).toEqual(new Date(at("15:50").getTime() + DAY));
    // Not revived: its deadline as it was, and the place it held still free — the one place more counted is the offer written inside the window, revived.
    expect((await db.select().from(familyPlaceHolds).where(eq(familyPlaceHolds.id, lapsedAfter.id)))[0]?.expiresAt ?? at("16:20")).toEqual(at("16:20"));
    expect(computeOccupied(await countOccupied(db, event.id, RUN))).toBe(occupiedBefore + 1);
    const trail = await db.select().from(auditLogs).where(eq(auditLogs.action, "registration.deadline_moved_for_outage"));
    expect(trail.map((row) => row.entityId).sort()).toEqual([running, inside].sort());
  });

  it("records a silence once when two runs read it at the same moment, and moves its deadlines once", async () => {
    const event = await createEvent();
    const hold = await register(event, { status: "PENDING_DECLARATION", holdExpiresAt: at("12:00") });
    const settings = { ...DEFAULT_DEADLINES };

    // Both read the windows before either writes: the unique index lets one row in.
    const [first, second] = await Promise.all([applyOutageGrace(db, NOW, settings, deps("resolves")), applyOutageGrace(db, NOW, settings, deps("resolves"))]);

    expect(await windows()).toHaveLength(1);
    expect(first.windowsOpened + second.windowsOpened).toBe(1);
    expect((await rowOf(hold)).holdExpiresAt).toEqual(after("2026-10-03T12:00:00.000Z"));
    expect(await db.select().from(auditLogs).where(and(eq(auditLogs.action, "registration.deadline_moved_for_outage"), eq(auditLogs.entityId, hold)))).toHaveLength(1);
  });

  it("refuses a second row for the same silence, whoever writes it", async () => {
    const row = { source: "pings" as const, startedAt: SHUT, endedAt: OPEN, confirmedAt: RUN, grantedMs: GAP };
    await db.insert(unreachableWindows).values(row);
    await expect(db.insert(unreachableWindows).values(row)).rejects.toThrow();
    expect(await db.insert(unreachableWindows).values(row).onConflictDoNothing().returning()).toHaveLength(0);
    expect(await windows()).toHaveLength(1);
  });
});

describe("§NNN a claim the allocator already lapsed inside the window: recorded as not revived, never revived", () => {
  // Inside the pings window (09:15–16:00): a newcomer's transaction at 15:30, while the name answered a visitor, lapses what was past its deadline first.
  const NEWCOMER = new Date("2026-10-03T15:30:00.000Z");

  /** What every capacity-changing transaction does first, under the event lock (`placeForNewcomer` → `expireStaleHolds`). */
  async function allocatorLapsesAt(event: EventForRegistration, at: Date, wanting = 0) {
    await db.transaction(async (tx) => {
      const locked = await lockEventForCapacity(tx, event.id);
      await expireStaleHolds(tx, locked, at, { wanting });
    });
  }

  const notRevivedAudit = (action: "registration.not_revived_for_outage" | "event.invitation_not_revived_for_outage") =>
    db.select().from(auditLogs).where(eq(auditLogs.action, action));

  it("an offer lapsed by a newcomer's registration: still EXPIRED after the run, audited, named in the closed email, counted on the window and on «Sarcini»", async () => {
    const event = await createEvent({ capacity: 1 });
    const offered = await register(event, { status: "WAITLIST_OFFERED", holdExpiresAt: new Date("2026-10-03T10:00:00.000Z"), waitlistedAt: ANCHOR, offerCreatedAt: ANCHOR });
    await allocatorLapsesAt(event, NEWCOMER);
    expect((await rowOf(offered)).status).toBe("EXPIRED");
    await register(event, { status: "CONFIRMED", confirmedAt: NEWCOMER });

    const result = await runRegistrationMaintenance(db, NOW, deps("resolves"));

    const row = await rowOf(offered);
    expect(row.status).toBe("EXPIRED");
    expect(row.expiryReason).toBe("WAITLIST_OFFER_LAPSED");
    expect(row.expiredAt).toEqual(NEWCOMER);
    expect(row.holdExpiresAt).toEqual(new Date("2026-10-03T10:00:00.000Z"));
    expect(row.outsideCapacity).toBe(false);
    expect((await db.select().from(events).where(eq(events.id, event.id)))[0].capacity).toBe(1);
    expect(computeOccupied(await countOccupied(db, event.id, NOW))).toBe(1);

    const [window] = await windows();
    const [audit] = await notRevivedAudit("registration.not_revived_for_outage");
    expect(audit.entityId).toBe(offered);
    expect(audit.actorStaffUserId).toBeNull();
    expect(audit.metadataJson).toEqual({ kind: "offer", windowId: window.id, deadline: "2026-10-03T10:00:00.000Z", lapsedBy: "allocator" });
    expect(window.notRevived).toEqual([{ kind: "offer", id: offered, eventId: event.id }]);
    expect(window.claimsNotRevived).toBe(1);
    expect(result.outageGrace.notRevived).toBe(1);
    const [closed] = await outbox("UNREACHABLE_WINDOW_CLOSED");
    expect(closed.payloadJson).toMatchObject({ notRevived: 1, claims: [{ kind: "offer", id: offered, eventId: event.id }] });
    expect(await countNotRevivedWaiting(db, await readUnreachableWindows(db), NOW)).toBe(1);

    // A second run records nothing twice.
    await runRegistrationMaintenance(db, new Date(NOW.getTime() + 15 * MINUTE), deps("resolves", async () => byJob([ANCHOR, NOW])));
    expect(await notRevivedAudit("registration.not_revived_for_outage")).toHaveLength(1);
    expect((await windows())[0].claimsNotRevived).toBe(1);
  });

  it("a declaration hold released for somebody who wanted the place: still EXPIRED, recorded as a declaration hold", async () => {
    const event = await createEvent({ capacity: 1 });
    const hold = await register(event, { status: "PENDING_DECLARATION", holdExpiresAt: new Date("2026-10-03T11:00:00.000Z") });
    await allocatorLapsesAt(event, NEWCOMER, 1);
    expect((await rowOf(hold)).expiryReason).toBe("DECLARATION_HOLD_LAPSED");
    await register(event, { status: "CONFIRMED", confirmedAt: NEWCOMER });

    await runRegistrationMaintenance(db, NOW, deps("resolves"));

    const row = await rowOf(hold);
    expect(row.status).toBe("EXPIRED");
    expect(row.holdExpiresAt).toEqual(new Date("2026-10-03T11:00:00.000Z"));
    const [window] = await windows();
    expect(window.notRevived).toEqual([{ kind: "declarationHold", id: hold, eventId: event.id }]);
    const [audit] = await notRevivedAudit("registration.not_revived_for_outage");
    expect(audit.metadataJson).toEqual({ kind: "declarationHold", windowId: window.id, deadline: "2026-10-03T11:00:00.000Z", lapsedBy: "allocator" });
    expect(await db.select().from(auditLogs).where(and(eq(auditLogs.action, "registration.deadline_moved_for_outage"), eq(auditLogs.entityId, hold)))).toHaveLength(0);
  });

  it("an invitation stamped expired: its deadline and its stamp as they were, audited on the event, named", async () => {
    const event = await createEvent({ capacity: 1 });
    const invitation = await invite(event, new Date("2026-10-03T10:30:00.000Z"));
    await allocatorLapsesAt(event, NEWCOMER);
    await register(event, { status: "CONFIRMED", confirmedAt: NEWCOMER });

    await runRegistrationMaintenance(db, NOW, deps("resolves"));

    const [later] = await db.select().from(eventInvitations).where(eq(eventInvitations.id, invitation.id));
    expect(later.expiresAt).toEqual(new Date("2026-10-03T10:30:00.000Z"));
    expect(later.expiredAt).toEqual(NEWCOMER);
    const [window] = await windows();
    const [audit] = await notRevivedAudit("event.invitation_not_revived_for_outage");
    expect(audit.entityId).toBe(event.id);
    expect(audit.metadataJson).toEqual({ invitationId: invitation.id, windowId: window.id, deadline: "2026-10-03T10:30:00.000Z", lapsedBy: "allocator" });
    expect(window.notRevived).toEqual([{ kind: "invitation", id: invitation.id, eventId: event.id }]);
    expect(computeOccupied(await countOccupied(db, event.id, NOW))).toBe(1);
  });

  it("a family's reservation cleared to null: left cleared, recorded from its sitting's deadline", async () => {
    const event = await createEvent({ capacity: 1 });
    const reservedUntil = new Date("2026-10-03T10:00:00.000Z");
    const reservation = await register(event, { status: "PENDING_EMAIL_CONFIRMATION", holdExpiresAt: reservedUntil, emailLinkExpiresAt: new Date(NOW.getTime() + DAY) });
    const own = await rowOf(reservation);
    await db.insert(familySittings).values({
      eventId: event.id,
      participantId: own.participantId,
      registrationId: reservation,
      registrationIds: [reservation],
      locale: "ro",
      heldUntil: ANCHOR,
      expiresAt: new Date(NOW.getTime() + DAY),
      reservedUntil,
      createdAt: ANCHOR,
    });
    await allocatorLapsesAt(event, NEWCOMER);
    expect((await rowOf(reservation)).holdExpiresAt).toBeNull();
    await register(event, { status: "CONFIRMED", confirmedAt: NEWCOMER });

    await runRegistrationMaintenance(db, NOW, deps("resolves"));

    const row = await rowOf(reservation);
    expect(row.status).toBe("PENDING_EMAIL_CONFIRMATION");
    expect(row.holdExpiresAt).toBeNull();
    const [window] = await windows();
    expect(window.notRevived).toEqual([{ kind: "familyReservation", id: reservation, eventId: event.id }]);
    const [audit] = await notRevivedAudit("registration.not_revived_for_outage");
    expect(audit.metadataJson).toEqual({ kind: "familyReservation", windowId: window.id, deadline: reservedUntil.toISOString(), lapsedBy: "allocator" });
    expect(computeOccupied(await countOccupied(db, event.id, NOW))).toBe(1);
  });

  it("an address link the sweep ended inside the window: recorded, left EXPIRED", async () => {
    const event = await createEvent();
    const link = await register(event, { status: "PENDING_EMAIL_CONFIRMATION", emailLinkExpiresAt: new Date("2026-10-03T11:00:00.000Z") });
    await expireStalePendingEmailConfirmations(db, NEWCOMER, DEFAULT_DEADLINES);
    expect((await rowOf(link)).status).toBe("EXPIRED");

    await runRegistrationMaintenance(db, NOW, deps("resolves"));

    expect((await rowOf(link)).status).toBe("EXPIRED");
    expect((await rowOf(link)).emailLinkExpiresAt).toEqual(new Date("2026-10-03T11:00:00.000Z"));
    const [window] = await windows();
    expect(window.notRevived).toEqual([{ kind: "emailLink", id: link, eventId: event.id }]);
  });

  it("never records what lapsed before the window, nor a claim the move would not have revived", async () => {
    const event = await createEvent({ capacity: 1 });
    // Lapsed before the window began: not the outage's.
    const before = await register(event, { status: "WAITLIST_OFFERED", holdExpiresAt: new Date("2026-10-03T08:30:00.000Z"), waitlistedAt: ANCHOR, offerCreatedAt: ANCHOR });
    await allocatorLapsesAt(event, new Date("2026-10-03T08:45:00.000Z"));
    expect((await rowOf(before)).status).toBe("EXPIRED");
    await runRegistrationMaintenance(db, NOW, deps("resolves"));
    expect((await windows())[0].notRevived).toEqual([]);
    expect(await notRevivedAudit("registration.not_revived_for_outage")).toHaveLength(0);
  });

  it("never records a claim lapsed inside the window that the move would not have revived: capped by the close before the run", async () => {
    // Registration closed at 18:00 in Brașov, inside the window: the offer's move (10:00 + 6¾ hours) is capped there, behind the run.
    const event = await createEvent({ capacity: 1, registrationClosesAt: new Date("2026-10-03T15:00:00.000Z") });
    const offered = await register(event, { status: "WAITLIST_OFFERED", holdExpiresAt: new Date("2026-10-03T10:00:00.000Z"), waitlistedAt: ANCHOR, offerCreatedAt: ANCHOR });
    await allocatorLapsesAt(event, NEWCOMER);
    expect((await rowOf(offered)).status).toBe("EXPIRED");
    await register(event, { status: "CONFIRMED", confirmedAt: NEWCOMER });

    await runRegistrationMaintenance(db, NOW, deps("resolves"));

    expect((await windows())[0].notRevived).toEqual([]);
    expect((await windows())[0].claimsNotRevived).toBe(0);
    expect(await notRevivedAudit("registration.not_revived_for_outage")).toHaveLength(0);
    expect((await rowOf(offered)).status).toBe("EXPIRED");
  });

  it("names a family's reservation the allocator cleared once, and never a family form sent while the event was full, whose link the run moved", async () => {
    const event = await createEvent({ capacity: 1 });
    const reservedUntil = new Date("2026-10-03T10:00:00.000Z");
    const sitting = async (registrationId: string) => {
      const own = await rowOf(registrationId);
      await db.insert(familySittings).values({
        eventId: event.id,
        participantId: own.participantId,
        registrationId,
        registrationIds: [registrationId],
        locale: "ro",
        heldUntil: ANCHOR,
        expiresAt: new Date(NOW.getTime() + DAY),
        reservedUntil,
        createdAt: ANCHOR,
      });
    };
    // Sent while no place was free (`reserveFamilyPlace` wrote nothing): no reservation from the start; its address link runs inside the window and is moved.
    const neverHeld = await register(event, { status: "PENDING_EMAIL_CONFIRMATION", holdExpiresAt: null, emailLinkExpiresAt: new Date("2026-10-03T12:00:00.000Z") });
    await sitting(neverHeld);
    const reservation = await register(event, { status: "PENDING_EMAIL_CONFIRMATION", holdExpiresAt: reservedUntil, emailLinkExpiresAt: new Date(NOW.getTime() + DAY) });
    await sitting(reservation);
    await allocatorLapsesAt(event, NEWCOMER);
    // The allocator keeps the instant it cleared the reservation, and nothing else writes it.
    expect((await rowOf(reservation)).reservationLapsedAt).toEqual(NEWCOMER);
    expect((await rowOf(neverHeld)).reservationLapsedAt).toBeNull();
    await register(event, { status: "CONFIRMED", confirmedAt: NEWCOMER });

    await runRegistrationMaintenance(db, NOW, deps("resolves"));

    // The form's link moved — its `updated_at` is this run's — and it is not named: it never held a place.
    const moved = await rowOf(neverHeld);
    expect(moved.emailLinkExpiresAt).toEqual(after("2026-10-03T12:00:00.000Z"));
    expect(moved.updatedAt).toEqual(NOW);
    const [window] = await windows();
    expect(window.notRevived).toEqual([{ kind: "familyReservation", id: reservation, eventId: event.id }]);
    expect(window.claimsNotRevived).toBe(1);
    expect((await notRevivedAudit("registration.not_revived_for_outage")).map((row) => row.entityId)).toEqual([reservation]);

    // A second run records nothing twice.
    await runRegistrationMaintenance(db, new Date(NOW.getTime() + 15 * MINUTE), deps("resolves", async () => byJob([ANCHOR, NOW])));
    expect(await notRevivedAudit("registration.not_revived_for_outage")).toHaveLength(1);
    expect((await windows())[0].claimsNotRevived).toBe(1);
  });

  it("counts a claim not revived on «Sarcini» only until the facts show it handled: registered again, the invitation sent again or accepted, the reservation placed", async () => {
    const event = await createEvent({ capacity: 3 });
    const offered = await register(event, { status: "WAITLIST_OFFERED", holdExpiresAt: new Date("2026-10-03T10:00:00.000Z"), waitlistedAt: ANCHOR, offerCreatedAt: ANCHOR });
    const invitation = await invite(event, new Date("2026-10-03T10:30:00.000Z"));
    const reservedUntil = new Date("2026-10-03T11:00:00.000Z");
    const reservation = await register(event, { status: "PENDING_EMAIL_CONFIRMATION", holdExpiresAt: reservedUntil, emailLinkExpiresAt: new Date(NOW.getTime() + DAY) });
    await db.insert(familySittings).values({
      eventId: event.id,
      participantId: (await rowOf(reservation)).participantId,
      registrationId: reservation,
      registrationIds: [reservation],
      locale: "ro",
      heldUntil: ANCHOR,
      expiresAt: new Date(NOW.getTime() + DAY),
      reservedUntil,
      createdAt: ANCHOR,
    });
    await allocatorLapsesAt(event, NEWCOMER);
    // Three newcomers took the three places meanwhile.
    for (let i = 0; i < 3; i += 1) await register(event, { status: "CONFIRMED", confirmedAt: NEWCOMER });

    await runRegistrationMaintenance(db, NOW, deps("resolves"));
    const waiting = async () => countNotRevivedWaiting(db, await readUnreachableWindows(db), NOW);
    expect((await windows())[0].claimsNotRevived).toBe(3);
    expect(await waiting()).toBe(3);

    // The person whose offer lapsed registers again (the same address and name): handled.
    const lapsed = await rowOf(offered);
    const again = await register(event, { status: "WAITLISTED", waitlistedAt: NOW });
    await db.update(registrations).set({ participantId: lapsed.participantId, registeredName: lapsed.registeredName, submittedAt: NOW }).where(eq(registrations.id, again));
    expect(await waiting()).toBe(2);

    // The invitation's guest is sent a new one to the same address: handled; accepting it would be too.
    const [guest] = await db.select().from(eventInvitations).where(eq(eventInvitations.id, invitation.id));
    await db.insert(eventInvitations).values({ eventId: event.id, participantId: guest.participantId, name: guest.name, email: guest.email, canonicalEmail: guest.canonicalEmail, sentAt: NOW, lastSentAt: NOW, expiresAt: new Date(NOW.getTime() + DAY), createdAt: NOW });
    expect(await waiting()).toBe(1);

    // The family's address still unconfirmed with no reservation: waiting; given a place again: handled.
    await db.update(registrations).set({ holdExpiresAt: new Date(NOW.getTime() + HOUR) }).where(eq(registrations.id, reservation));
    expect(await waiting()).toBe(0);
    await db.update(registrations).set({ holdExpiresAt: null }).where(eq(registrations.id, reservation));
    expect(await waiting()).toBe(1);
    await db.update(registrations).set({ status: "CONFIRMED", confirmedAt: NOW, emailConfirmedAt: NOW }).where(eq(registrations.id, reservation));
    expect(await waiting()).toBe(0);

    // Once the event has started, nothing waits.
    await db.update(registrations).set({ status: "PENDING_EMAIL_CONFIRMATION", confirmedAt: null, emailConfirmedAt: null }).where(eq(registrations.id, reservation));
    expect(await waiting()).toBe(1);
    expect(await countNotRevivedWaiting(db, await readUnreachableWindows(db), new Date(event.startsAt.getTime() + MINUTE))).toBe(0);
  });

  it("records a claim whose deadline fell between a closed window's end and the run, lapsed by the allocator in that interval", async () => {
    // A window seen late: shut 11:19 to 18:30 in Brașov, the run at 19:30 (as in the case above).
    const at = (iso: string) => new Date(`2026-10-03T${iso}:00.000Z`);
    const OPEN = at("15:30");
    const RUN = at("16:30");
    const lateRecord: OutageGraceDeps["readPings"] = async () => byJob([ANCHOR, at("08:04"), OPEN, at("15:45"), at("16:00"), at("16:15")]);
    const event = await createEvent({ capacity: 1 });
    // Written before the window, due at 18:50 in Brașov: running, it would have been moved by the whole window.
    const offered = await register(event, { status: "WAITLIST_OFFERED", holdExpiresAt: at("15:50"), waitlistedAt: ANCHOR, offerCreatedAt: ANCHOR });
    await allocatorLapsesAt(event, at("16:00"));
    expect((await rowOf(offered)).status).toBe("EXPIRED");
    await register(event, { status: "CONFIRMED", confirmedAt: at("16:00") });

    await runRegistrationMaintenance(db, RUN, deps("resolves", lateRecord));

    const [window] = await windows();
    expect(window.endedAt).toEqual(OPEN);
    expect(window.notRevived).toEqual([{ kind: "offer", id: offered, eventId: event.id }]);
    const [audit] = await notRevivedAudit("registration.not_revived_for_outage");
    expect(audit.metadataJson).toEqual({ kind: "offer", windowId: window.id, deadline: at("15:50").toISOString(), lapsedBy: "allocator" });
    expect((await rowOf(offered)).status).toBe("EXPIRED");
  });
});
