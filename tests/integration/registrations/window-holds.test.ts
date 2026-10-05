import { and, asc, eq, like } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { auditLogs } from "@/db/schema/audit-logs";
import { emailActionTokens } from "@/db/schema/email-action-tokens";
import { emailOutbox } from "@/db/schema/email-outbox";
import { eventTranslations, events } from "@/db/schema/events";
import { participants } from "@/db/schema/participants";
import { registrations } from "@/db/schema/registrations";
import { type StaffUser, staffUsers } from "@/db/schema/staff-users";
import { saveEventAndTranslations, saveEventFields } from "@/modules/content/events/service";
import { toWallTimeInput } from "@/modules/events/domain/zoned-time";
import { computeContentHash, type LegalDocumentTranslationInput } from "@/modules/legal-documents/domain/content-hash";
import { insertLegalDocumentVersion } from "@/modules/legal-documents/repository";
import { previewWindowHolds } from "@/modules/registrations/window-holds";
import { DEFAULT_DEADLINES } from "@/modules/deadlines/domain/deadlines";
import { queueEventReminders } from "@/modules/notifications/event-mail";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";

/**
 * BR-REQ-033-01 (`DECISIONS.md` §NNN, amending §104 and §407) — a save that changes an event's
 * participation window moves the declaration holds that window gave, in the save's transaction:
 * the window-given holds (a test row with them), never the club's minutes or a waiting-list offer;
 * their live declaration links in lockstep; one audit row per registration and one on the event; a
 * second identical save moves nothing; inside an open window each moved row is sent the declaration
 * once more, and never twice for the same deadline.
 */
const ZONE = "Europe/Bucharest";
const START = new Date("2026-11-21T08:00:00.000Z");
const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;
const before = (days: number) => new Date(START.getTime() - days * DAY);
/** The owner's day: the window (15 days) has not opened yet. */
const NOW = new Date("2026-10-05T09:00:00.000Z");
/** Inside the window: 8 Nov, the window opened on 6 Nov. */
const OPEN = new Date("2026-11-08T09:00:00.000Z");

describe("BR-REQ-033-01 a changed confirmation window moves the holds it gave (§NNN)", () => {
  let db: TestDatabase;
  let close: () => Promise<void>;
  let admin: StaffUser;
  let declarationId: string;

  beforeAll(async () => {
    ({ db, close } = await createTestDatabase());
  });
  afterAll(async () => close());

  beforeEach(async () => {
    await resetTables(db);
    [admin] = await db.insert(staffUsers).values({ email: "admin@dev.test", displayName: "Admin", role: "ADMIN" }).returning();
    const declaration: LegalDocumentTranslationInput[] = [
      { locale: "ro", title: "Declarație", body: { sections: [{ paragraphs: ["Declar."] }] } },
      { locale: "en", title: "Declaration", body: { sections: [{ paragraphs: ["I declare."] }] } },
    ];
    declarationId = await insertLegalDocumentVersion(db, {
      key: "EVENT_DECLARATION",
      version: 1,
      effectiveAt: new Date("2026-01-01T00:00:00.000Z"),
      isApproved: true,
      contentSha256: computeContentHash(declaration),
      translations: declaration,
      now: NOW,
    });
  });

  async function seedEvent(deadlineDays: number) {
    const [row] = await db
      .insert(events)
      .values({
        type: "RACE",
        surface: "ASPHALT",
        startsAt: START,
        timezone: ZONE,
        locationName: "Parcul Tractorul",
        registrationMode: "INTERNAL",
        capacity: 50,
        confirmationOpensDaysBefore: 15,
        confirmationDeadlineDaysBefore: deadlineDays,
        declarationDocumentId: declarationId,
        publishedAt: NOW,
        editorialStatus: "PUBLISHED",
      })
      .returning();
    await db.insert(eventTranslations).values([
      { eventId: row.id, locale: "ro", slug: "cursa", title: "Cursa", excerpt: "Rapid." },
      { eventId: row.id, locale: "en", slug: "race", title: "Race", excerpt: "Fast." },
    ]);
    return row;
  }

  let serial = 0;
  async function seedRow(eventId: string, values: { status: "PENDING_DECLARATION" | "WAITLIST_OFFERED"; holdExpiresAt: Date; kind?: "REAL" | "TEST" }) {
    serial += 1;
    const email = `p${serial}@example.test`;
    const [person] = await db
      .insert(participants)
      .values({ deliveryEmail: email, normalizedEmail: email, canonicalEmail: email, canonicalizationVersion: 1, defaultName: `P${serial}` })
      .returning();
    const [row] = await db
      .insert(registrations)
      .values({
        eventId,
        participantId: person.id,
        status: values.status,
        kind: values.kind ?? "REAL",
        holdExpiresAt: values.holdExpiresAt,
        locale: "ro",
        registeredName: `P${serial}`,
        displayName: `P${serial}`,
        privacyNoticeVersion: 1,
        privacyAcknowledgedAt: NOW,
        raceId: null,
        resultsNameConsent: false,
        resultsConsentVersion: 1,
        ...(values.status === "WAITLIST_OFFERED" ? { waitlistedAt: NOW, offerCreatedAt: NOW } : {}),
      })
      .returning();
    return row;
  }

  let hashSerial = 0;
  async function token(registration: { id: string; participantId: string }, expiresAt: Date, usedAt: Date | null = null) {
    hashSerial += 1;
    const [row] = await db
      .insert(emailActionTokens)
      .values({
        participantId: registration.participantId,
        registrationId: registration.id,
        purpose: "COMPLETE_DECLARATION",
        expiresAt,
        usedAt,
        tokenHash: hashSerial.toString(16).padStart(64, "0"),
        createdAt: NOW,
      })
      .returning();
    return row;
  }

  const reload = async (id: string) => (await db.select().from(events).where(eq(events.id, id)))[0];
  const holdOf = async (id: string) => (await db.select().from(registrations).where(eq(registrations.id, id)))[0].holdExpiresAt;
  const tokenOf = async (id: string) => (await db.select().from(emailActionTokens).where(eq(emailActionTokens.id, id)))[0].expiresAt;
  const declarationEmails = () =>
    db.select().from(emailOutbox).where(eq(emailOutbox.messageType, "COMPLETE_DECLARATION")).orderBy(asc(emailOutbox.createdAt), asc(emailOutbox.id));

  /** The editor's form for the row, with the window's two numbers as given. */
  const formFor = (row: typeof events.$inferSelect, opens: number, deadline: number) => ({
    type: row.type,
    eventStatus: row.eventStatus,
    timezone: row.timezone,
    startsAtWallTime: toWallTimeInput(row.startsAt, row.timezone),
    endsAtWallTime: "",
    raceStartsAtWallTime: "",
    locationName: row.locationName ?? "",
    locationAddress: "",
    surface: row.surface,
    difficulty: null,
    costType: null,
    mapUrl: "",
    routeUrl: "",
    distanceMeters: "",
    elevationGainMeters: "",
    featured: false,
    registrationMode: row.registrationMode,
    participantListVisibility: "HIDDEN" as const,
    capacity: row.capacity === null ? "" : String(row.capacity),
    registrationOpensAtWallTime: "",
    registrationClosesAtWallTime: "",
    declarationDocumentId: row.declarationDocumentId ?? "",
    externalProvider: "",
    externalRegistrationUrl: "",
    confirmationOpensDaysBefore: String(opens),
    confirmationDeadlineDaysBefore: String(deadline),
  });

  async function saveWindow(eventId: string, opens: number, deadline: number, now: Date) {
    const row = await reload(eventId);
    return saveEventAndTranslations(db, {
      actor: admin,
      eventId,
      fields: formFor(row, opens, deadline),
      expectedVersion: row.version,
      translations: [],
      acknowledgeLiveEdit: true,
      now,
    });
  }

  it("moves the window-given holds (a test row with them) and their links, never the club's minutes or an offer, and audits it", async () => {
    const event = await seedEvent(2);
    const given = [
      await seedRow(event.id, { status: "PENDING_DECLARATION", holdExpiresAt: before(2) }),
      await seedRow(event.id, { status: "PENDING_DECLARATION", holdExpiresAt: before(2) }),
      await seedRow(event.id, { status: "PENDING_DECLARATION", holdExpiresAt: before(2) }),
    ];
    const test = await seedRow(event.id, { status: "PENDING_DECLARATION", holdExpiresAt: before(2), kind: "TEST" });
    const clubMinutes = new Date(NOW.getTime() + 20 * MINUTE);
    const minutes = await seedRow(event.id, { status: "PENDING_DECLARATION", holdExpiresAt: clubMinutes });
    const offer = await seedRow(event.id, { status: "WAITLIST_OFFERED", holdExpiresAt: before(2) });
    // A link that ended with the hold follows it; a used one and one that lives until the start (§160) keep their instant.
    const withHold = await token(given[0], before(2));
    const used = await token(given[1], before(2), NOW);
    const untilStart = await token(given[2], START);

    // The editor's card, before the save: three real places hold the window's instant, none to move yet.
    expect(await previewWindowHolds(db, await reload(event.id), NOW, 30)).toEqual({ moveNow: 0, atWindow: 3, to: before(2) });

    const result = await saveWindow(event.id, 15, 5, NOW);
    expect(result.holdsMoved).toEqual({ moved: 3, test: 1, to: before(5), queued: 0 });

    for (const row of [...given, test]) expect(await holdOf(row.id)).toEqual(before(5));
    expect(await holdOf(minutes.id)).toEqual(clubMinutes);
    expect(await holdOf(offer.id)).toEqual(before(2));
    expect(await tokenOf(withHold.id)).toEqual(before(5));
    expect(await tokenOf(used.id)).toEqual(before(2));
    expect(await tokenOf(untilStart.id)).toEqual(START);

    const moved = await db.select().from(auditLogs).where(eq(auditLogs.action, "registration.hold_moved_by_window"));
    expect(moved).toHaveLength(4);
    expect(moved.every((row) => row.actorStaffUserId === admin.id)).toBe(true);
    expect(moved.find((row) => row.entityId === given[0].id)?.metadataJson).toEqual({ from: before(2).toISOString(), to: before(5).toISOString() });
    const [onEvent] = await db.select().from(auditLogs).where(eq(auditLogs.action, "event.holds_moved_by_window"));
    expect(onEvent).toMatchObject({ entityType: "event", entityId: event.id, actorStaffUserId: admin.id });
    expect(onEvent.metadataJson).toEqual({ moved: 3, test: 1, to: before(5).toISOString(), queued: 0 });
    // Before the window opens nothing is sent: the window's own ask says the new deadline on its day (§104).
    expect(await declarationEmails()).toHaveLength(0);

    // The same save again moves nothing and writes nothing.
    const again = await saveWindow(event.id, 15, 5, new Date(NOW.getTime() + MINUTE));
    expect(again.holdsMoved).toEqual({ moved: 0, test: 0, to: null, queued: 0 });
    expect(await db.select().from(auditLogs).where(eq(auditLogs.action, "event.holds_moved_by_window"))).toHaveLength(1);
  });

  it("moves the places a deadline of 0 kept until the start to the owner's 5 days, even when the window was saved before", async () => {
    // The race as it stands: 15 / 5 saved, the places given when the deadline was still 0 hold the start.
    const event = await seedEvent(5);
    const atStart = await seedRow(event.id, { status: "PENDING_DECLARATION", holdExpiresAt: START });
    expect(await previewWindowHolds(db, await reload(event.id), NOW, 30)).toEqual({ moveNow: 1, atWindow: 0, to: before(5) });

    const result = await saveWindow(event.id, 15, 5, NOW);
    expect(result.holdsMoved).toMatchObject({ moved: 1, to: before(5) });
    expect(await holdOf(atStart.id)).toEqual(before(5));
    expect(await previewWindowHolds(db, await reload(event.id), NOW, 30)).toEqual({ moveNow: 0, atWindow: 1, to: before(5) });
  });

  it("past the new deadline, a hold moves to now plus the club's minutes, never on the spot", async () => {
    const event = await seedEvent(0);
    const atStart = await seedRow(event.id, { status: "PENDING_DECLARATION", holdExpiresAt: START });
    const late = before(3);
    await saveWindow(event.id, 15, 5, late);
    expect(await holdOf(atStart.id)).toEqual(new Date(late.getTime() + 30 * MINUTE));
  });

  it("inside an open window, sends each moved row the declaration once per new deadline, real and test alike", async () => {
    const event = await seedEvent(5);
    const real = await seedRow(event.id, { status: "PENDING_DECLARATION", holdExpiresAt: before(5) });
    const test = await seedRow(event.id, { status: "PENDING_DECLARATION", holdExpiresAt: before(5), kind: "TEST" });
    const minutes = await seedRow(event.id, { status: "PENDING_DECLARATION", holdExpiresAt: new Date(OPEN.getTime() + 20 * MINUTE) });
    const sent = () => db.update(emailOutbox).set({ status: "SENT", sentAt: OPEN });

    const first = await saveWindow(event.id, 15, 3, OPEN);
    expect(first.holdsMoved).toEqual({ moved: 1, test: 1, to: before(3), queued: 2 });
    const queued = await declarationEmails();
    expect(queued.map((row) => row.registrationId).sort()).toEqual([real.id, test.id].sort());
    expect(queued.map((row) => row.idempotencyKey).sort()).toEqual(
      [`registration:${real.id}:deadline-moved:${before(3).toISOString()}`, `registration:${test.id}:deadline-moved:${before(3).toISOString()}`].sort(),
    );
    expect(queued.every((row) => row.requestedByStaffUserId === admin.id)).toBe(true);
    expect(queued.some((row) => row.registrationId === minutes.id)).toBe(false);

    // Back to 5, then to 3 again: one more email for the deadline it had not been told, none for one it had.
    await sent();
    await saveWindow(event.id, 15, 5, new Date(OPEN.getTime() + MINUTE));
    expect(await declarationEmails()).toHaveLength(4);
    await sent();
    const third = await saveWindow(event.id, 15, 3, new Date(OPEN.getTime() + 2 * MINUTE));
    expect(third.holdsMoved).toMatchObject({ moved: 1, test: 1, queued: 0 });
    expect(await declarationEmails()).toHaveLength(4);
    expect(await db.select().from(emailOutbox).where(and(eq(emailOutbox.registrationId, real.id), like(emailOutbox.idempotencyKey, "%deadline-moved%")))).toHaveLength(2);
  });

  it("a row whose declaration email is still waiting to leave is not sent a second one: that email says the moved deadline", async () => {
    const event = await seedEvent(5);
    const real = await seedRow(event.id, { status: "PENDING_DECLARATION", holdExpiresAt: before(5) });
    await db.insert(emailOutbox).values({
      participantId: real.participantId,
      registrationId: real.id,
      messageType: "COMPLETE_DECLARATION",
      locale: "ro",
      recipientEmail: "p@example.test",
      payloadJson: {},
      idempotencyKey: `registration:${real.id}:declaration`,
      status: "PENDING",
      attemptCount: 0,
      createdAt: OPEN,
    });
    const result = await saveWindow(event.id, 15, 3, OPEN);
    expect(result.holdsMoved).toEqual({ moved: 1, test: 0, to: before(3), queued: 0 });
    expect(await declarationEmails()).toHaveLength(1);
  });

  it("switched off, the holds wait for the start (§160); the row-only save moves them as well", async () => {
    const event = await seedEvent(5);
    const row = await seedRow(event.id, { status: "PENDING_DECLARATION", holdExpiresAt: before(5) });
    const current = await reload(event.id);
    await saveEventFields(db, { actor: admin, eventId: event.id, expectedVersion: current.version, fields: formFor(current, 0, 5), now: NOW });
    expect(await holdOf(row.id)).toEqual(START);
  });

  it("the last call goes 48 hours before the window's deadline, once — once more after the deadline moved; never at the start's lead (§NNN)", async () => {
    const event = await seedEvent(5);
    await db.update(events).set({ reminderHoursBefore: 72 }).where(eq(events.id, event.id));
    const row = await seedRow(event.id, { status: "PENDING_DECLARATION", holdExpiresAt: before(5) });
    const lastCalls = async () =>
      (await declarationEmails()).filter((email) => email.registrationId === row.id && email.idempotencyKey.includes(":sign-reminder")).map((email) => email.idempotencyKey);
    const due = new Date(before(5).getTime() - 48 * 60 * MINUTE);

    expect(await queueEventReminders(db, new Date(due.getTime() - MINUTE), DEFAULT_DEADLINES)).toBe(0);
    expect(await queueEventReminders(db, due, DEFAULT_DEADLINES)).toBe(1);
    expect(await queueEventReminders(db, new Date(due.getTime() + 60 * MINUTE), DEFAULT_DEADLINES)).toBe(0);
    expect(await lastCalls()).toEqual([`registration:${row.id}:sign-reminder:${before(5).toISOString()}`]);
    // The reminder's lead before the start (three days) comes after the deadline: nothing then.
    expect(await queueEventReminders(db, before(3), DEFAULT_DEADLINES)).toBe(0);

    // The deadline moved to 4 days before: the hold follows, and its new deadline earns one more call.
    await saveWindow(event.id, 15, 4, new Date(due.getTime() + 2 * 60 * MINUTE));
    expect(await holdOf(row.id)).toEqual(before(4));
    expect(await queueEventReminders(db, new Date(before(4).getTime() - 48 * 60 * MINUTE), DEFAULT_DEADLINES)).toBe(1);
    expect(await lastCalls()).toHaveLength(2);
  });

  it("without a window, the last call keeps the reminder's lead before the start and its one key", async () => {
    const event = await seedEvent(5);
    await db.update(events).set({ reminderHoursBefore: 72, confirmationOpensDaysBefore: 0 }).where(eq(events.id, event.id));
    const row = await seedRow(event.id, { status: "PENDING_DECLARATION", holdExpiresAt: START });
    expect(await queueEventReminders(db, new Date(before(3).getTime() - MINUTE), DEFAULT_DEADLINES)).toBe(0);
    expect(await queueEventReminders(db, before(3), DEFAULT_DEADLINES)).toBe(1);
    const [email] = await declarationEmails();
    expect(email.idempotencyKey).toBe(`registration:${row.id}:sign-reminder`);
  });

  it("a series save moves each date's holds to that date's own new deadline", async () => {
    const source = await seedEvent(2);
    await db.update(events).set({ repeatRule: { cadence: "WEEKLY", weekdays: [], until: "2026-12-31", publish: false } }).where(eq(events.id, source.id));
    const nextWeek = new Date(START.getTime() + 7 * DAY);
    const [member] = await db
      .insert(events)
      .values({ ...(await reload(source.id)), id: undefined, repeatRule: null, repeatOf: source.id, startsAt: nextWeek, version: 1 })
      .returning();
    const onSource = await seedRow(source.id, { status: "PENDING_DECLARATION", holdExpiresAt: before(2) });
    const onMember = await seedRow(member.id, { status: "PENDING_DECLARATION", holdExpiresAt: new Date(nextWeek.getTime() - 2 * DAY) });

    const row = await reload(source.id);
    const result = await saveEventAndTranslations(db, {
      actor: admin,
      eventId: source.id,
      fields: formFor(row, 15, 5),
      expectedVersion: row.version,
      translations: [],
      acknowledgeLiveEdit: true,
      scope: "all",
      now: NOW,
    });
    expect(await holdOf(onSource.id)).toEqual(before(5));
    expect(await holdOf(onMember.id)).toEqual(new Date(nextWeek.getTime() - 5 * DAY));
    // Two dates, two instants: the banner counts both and names no single date.
    expect(result.holdsMoved).toEqual({ moved: 2, test: 0, to: null, queued: 0 });
  });

  it("a cancelled event's holds are left as they stood (§331)", async () => {
    const event = await seedEvent(2);
    const row = await seedRow(event.id, { status: "PENDING_DECLARATION", holdExpiresAt: before(2) });
    await db.update(events).set({ eventStatus: "CANCELLED" }).where(eq(events.id, event.id));
    await saveWindow(event.id, 15, 5, NOW);
    expect(await holdOf(row.id)).toEqual(before(2));
  });
});
