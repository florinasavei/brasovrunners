import { eq, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { auditLogs } from "@/db/schema/audit-logs";
import { emailOutbox } from "@/db/schema/email-outbox";
import { eventVolunteerRoleAssignments, eventVolunteerRoles, eventVolunteers } from "@/db/schema/event-volunteers";
import { events, eventTranslations } from "@/db/schema/events";
import { participants } from "@/db/schema/participants";
import { registrations } from "@/db/schema/registrations";
import { type StaffUser, staffUsers } from "@/db/schema/staff-users";
import { confirmVolunteerForRaffle } from "@/modules/volunteers/raffle-confirmation";
import { turnRunnerIntoVolunteer, turnVolunteerIntoRunner } from "@/modules/volunteers/transform";
import { changeVolunteer } from "@/modules/volunteers/volunteers";
import { approveNotices, removeApprovedNotices } from "./legal-fixture";

/**
 * §948, §1023 — the volunteers' V numbers and the two transforms under real connections racing (BR-REQ-050-02, BR-REQ-034-01).
 *
 * Three things only a second connection can show, which PGlite — one connection, everything in a line whether or not a
 * row is locked (`tests/helpers/db.ts`) — cannot:
 *
 * - volunteers confirmed at the same instant each draw a V number of their own: the draw is under the event row's lock,
 *   the one serialization point of every number given at an event (`AGENTS.md` §10.6), so no two read the same «next» number —
 *   and the table's own index is never what stops them;
 * - «Confirmă» and «Transformă în alergător» pressed on one person at once wait in a line, never in a circle: both take
 *   the event's row and then the person's, in that order (`changeVolunteer`, `transform.ts`) — taken the other way
 *   round by one of them, PostgreSQL would abort one press with a deadlock (40P01);
 * - runners turned into volunteers at once on a full race free their places through the one allocator: each place is
 *   offered once, nobody is left on both lists, and the volunteers' V numbers are all different;
 * - §NNN: «Confirmă pentru tombolă» draws its V number under the same lock as «Confirmă»: the two pressed at once on twenty
 *   people draw twenty different numbers, and both pressed on one person draw one, never a second.
 */
const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) throw new Error("tests/concurrency needs a real PostgreSQL: set DATABASE_URL and migrate first.");

describe("§1023 BR-REQ-050-02 the volunteers' V numbers and the transforms, pressed at once", () => {
  const pool = new pg.Pool({ connectionString: DATABASE_URL, max: 20 });
  const db = drizzle(pool);
  // The real clock: the events start a month from now, and the notices inserted here are the ones in force.
  const NOW = new Date();
  const STARTS = new Date(NOW.getTime() + 30 * 24 * 3_600_000);
  const stamp = Date.now();
  const createdEventIds: string[] = [];
  const noticeIds: string[] = [];
  let admin: StaffUser | undefined;

  beforeAll(async () => {
    noticeIds.push(...(await approveNotices(db, ["PRIVACY_NOTICE", "TERMS", "EVENT_DECLARATION"], NOW)));
    [admin] = await db.insert(staffUsers).values({ email: `numbers.admin.${stamp}@example.test`, displayName: "Admin", role: "ADMIN" }).returning();
  });

  afterAll(async () => {
    if (createdEventIds.length > 0) {
      const rows = await db.select({ id: registrations.id, participantId: registrations.participantId }).from(registrations).where(inArray(registrations.eventId, createdEventIds));
      const participantIds = [...new Set(rows.map((row) => row.participantId))];
      if (rows.length > 0) await db.delete(emailOutbox).where(inArray(emailOutbox.registrationId, rows.map((row) => row.id)));
      if (admin) await db.delete(emailOutbox).where(eq(emailOutbox.requestedByStaffUserId, admin.id));
      if (admin) await db.delete(auditLogs).where(eq(auditLogs.actorStaffUserId, admin.id));
      await db.delete(auditLogs).where(inArray(auditLogs.entityId, createdEventIds));
      await db.delete(registrations).where(inArray(registrations.eventId, createdEventIds));
      // The event's cascade takes its roles and its volunteers.
      await db.delete(events).where(inArray(events.id, createdEventIds));
      if (participantIds.length > 0) {
        await db.delete(emailOutbox).where(inArray(emailOutbox.participantId, participantIds));
        await db.delete(auditLogs).where(inArray(auditLogs.participantId, participantIds));
        await db.delete(participants).where(inArray(participants.id, participantIds));
      }
    }
    if (admin) await db.delete(staffUsers).where(eq(staffUsers.id, admin.id));
    await removeApprovedNotices(db, noticeIds);
    await pool.end();
  });

  /** A race with one volunteers' role, its runners' numbers from 1; its volunteers are numbered V001, V002, … by themselves (§1023). */
  async function race(capacity: number) {
    const [event] = await db
      .insert(events)
      .values({ type: "RACE", startsAt: STARTS, registrationMode: "INTERNAL", capacity, bibStartNumber: 1, editorialStatus: "PUBLISHED", publishedAt: NOW, locationName: "Start" })
      .returning();
    createdEventIds.push(event.id);
    await db.insert(eventTranslations).values([
      { eventId: event.id, locale: "ro", slug: `numere-${stamp}-${event.id.slice(0, 8)}`, title: "Crosul" },
      { eventId: event.id, locale: "en", slug: `numbers-${stamp}-${event.id.slice(0, 8)}`, title: "The cross" },
    ]);
    const [role] = await db.insert(eventVolunteerRoles).values({ eventId: event.id, nameRo: "Punct de apă", nameEn: "Water point", needed: 50 }).returning();
    return { eventId: event.id, roleId: role.id };
  }

  /** A volunteer as the card's hand entry leaves one before «Confirmă»: offered, with the role given. */
  async function offered(eventId: string, roleId: string, index: string): Promise<string> {
    const email = `numbers.${stamp}.${index}@example.test`;
    const [row] = await db
      .insert(eventVolunteers)
      .values({ eventId, name: `Voluntar ${index}`, email, canonicalEmail: email, canonicalizationVersion: 2, phone: "+40712345678", state: "REGISTERED", source: "STAFF", roleId })
      .returning({ id: eventVolunteers.id });
    await db.insert(eventVolunteerRoleAssignments).values({ volunteerId: row.id, roleId });
    return row.id;
  }

  /** A runner of the race, as the flow leaves one in the status given. */
  async function runner(eventId: string, index: string, status: "CONFIRMED" | "WAITLISTED", bibNumber: number | null, minute: number): Promise<string> {
    const email = `runner.${stamp}.${index}@example.test`;
    const [participant] = await db
      .insert(participants)
      .values({ deliveryEmail: email, normalizedEmail: email, canonicalEmail: email, canonicalizationVersion: 2, defaultName: `Alergător ${index}`, preferredLocale: "ro" })
      .returning({ id: participants.id });
    const at = new Date(NOW.getTime() - 3_600_000 + minute * 60_000);
    const [row] = await db
      .insert(registrations)
      .values({
        eventId,
        participantId: participant.id,
        kind: "REAL",
        locale: "ro",
        registeredName: `Alergător ${index}`,
        displayName: `Alergător ${index}`,
        firstName: "Alergător",
        lastName: index,
        privacyNoticeVersion: 1,
        privacyAcknowledgedAt: at,
        resultsNameConsent: false,
        resultsConsentVersion: 1,
        status,
        emailConfirmedAt: at,
        bibNumber,
        ...(status === "CONFIRMED" ? { confirmedAt: at } : { waitlistedAt: at }),
      })
      .returning({ id: registrations.id });
    return row.id;
  }

  const outcomes = (settled: PromiseSettledResult<unknown>[]) => settled.map((result) => (result.status === "rejected" ? String(result.reason) : "ok"));

  it("twenty volunteers confirmed at the same instant draw twenty different V numbers, V001 to V020 — nobody refused, nobody without", async () => {
    const { eventId, roleId } = await race(100);
    const people = await Promise.all(Array.from({ length: 20 }, (_, index) => offered(eventId, roleId, `at-once-${index}`)));

    const settled = await Promise.allSettled(people.map((id) => changeVolunteer(db, admin!, { kind: "setState", eventId, id, state: "CONFIRMED" }, NOW, { sendEmail: false })));

    expect(outcomes(settled)).toEqual(Array.from({ length: 20 }, () => "ok"));
    const numbers = (await db.select({ volunteerNumber: eventVolunteers.volunteerNumber }).from(eventVolunteers).where(eq(eventVolunteers.eventId, eventId))).map((row) => row.volunteerNumber);
    expect([...numbers].sort((a, b) => (a ?? 0) - (b ?? 0))).toEqual(Array.from({ length: 20 }, (_, index) => 1 + index));
  });

  it("§NNN «Confirmă pentru tombolă» and «Confirmă» pressed at the same instant draw different V numbers — on twenty people, and both on one person", async () => {
    const { eventId, roleId } = await race(100);
    await db.update(events).set({ hasRaffle: true }).where(eq(events.id, eventId));
    const people = await Promise.all(Array.from({ length: 20 }, (_, index) => offered(eventId, roleId, `raffle-${index}`)));
    const forRaffle = (id: string) => confirmVolunteerForRaffle(db, admin!, { eventId, volunteerId: id, guardianAgreed: false, guardianWay: "", accepted: false }, NOW);
    const asVolunteer = (id: string) => changeVolunteer(db, admin!, { kind: "setState", eventId, id, state: "CONFIRMED" }, NOW, { sendEmail: false });

    // Half confirmed for the raffle alone, half as volunteers: one line under the event row's lock, twenty numbers.
    const settled = await Promise.allSettled(people.map((id, index) => (index % 2 === 0 ? forRaffle(id) : asVolunteer(id))));
    expect(outcomes(settled)).toEqual(Array.from({ length: 20 }, () => "ok"));
    const numbersOf = async () => (await db.select({ volunteerNumber: eventVolunteers.volunteerNumber }).from(eventVolunteers).where(eq(eventVolunteers.eventId, eventId))).map((row) => row.volunteerNumber);
    expect([...(await numbersOf())].sort((a, b) => (a ?? 0) - (b ?? 0))).toEqual(Array.from({ length: 20 }, (_, index) => 1 + index));

    // Both presses on one person at once, round after round: a line, never a deadlock, and one number each — never a second.
    for (let round = 0; round < 8; round++) {
      const id = await offered(eventId, roleId, `raffle-both-${round}`);
      const both = await Promise.allSettled([forRaffle(id), asVolunteer(id)]);
      expect(outcomes(both), `round ${round}`).toEqual(["ok", "ok"]);
      const [row] = await db.select({ state: eventVolunteers.state, volunteerNumber: eventVolunteers.volunteerNumber }).from(eventVolunteers).where(eq(eventVolunteers.id, id));
      expect(row.state, `round ${round}`).toBe("CONFIRMED");
      expect(row.volunteerNumber, `round ${round}`).toBe(21 + round);
    }
    const drawn = (await numbersOf()).flatMap((number) => (number === null ? [] : [number]));
    expect(new Set(drawn).size).toBe(drawn.length);
  });

  it("«Confirmă» and «Transformă în alergător» pressed on one person at once both go through, round after round: a line, never a deadlock", async () => {
    const { eventId, roleId } = await race(100);
    const rounds = 12;
    for (let round = 0; round < rounds; round++) {
      const id = await offered(eventId, roleId, `both-${round}`);
      const settled = await Promise.allSettled([
        changeVolunteer(db, admin!, { kind: "setState", eventId, id, state: "CONFIRMED" }, NOW, { sendEmail: false }),
        turnVolunteerIntoRunner(db, admin!, { eventId, volunteerId: id, firstName: "Voluntar", lastName: `Ambele ${round}`, relayedByParticipantRequest: true }, NOW),
      ]);
      expect(outcomes(settled), `round ${round}`).toEqual(["ok", "ok"]);
    }
    // Every person was entered once, each on a counted free place with the declaration theirs to sign.
    const entered = await db.select({ status: registrations.status }).from(registrations).where(eq(registrations.eventId, eventId));
    expect(entered.map((row) => row.status)).toEqual(Array.from({ length: rounds }, () => "PENDING_DECLARATION"));
    // Whichever press came second, every number drawn is one person's alone.
    const drawn = (await db.select({ volunteerNumber: eventVolunteers.volunteerNumber }).from(eventVolunteers).where(eq(eventVolunteers.eventId, eventId))).flatMap((row) => (row.volunteerNumber === null ? [] : [row.volunteerNumber]));
    expect(new Set(drawn).size).toBe(drawn.length);
  });

  it("BR-REQ-034-01: five runners of a full race turned into volunteers at once free five places through the allocator — each offered once, nobody on both lists, five different V numbers", async () => {
    const { eventId, roleId } = await race(5);
    const running = await Promise.all(Array.from({ length: 5 }, (_, index) => runner(eventId, `full-${index}`, "CONFIRMED", index + 1, index)));
    const waiting = await Promise.all(Array.from({ length: 5 }, (_, index) => runner(eventId, `wait-${index}`, "WAITLISTED", null, 10 + index)));

    const settled = await Promise.allSettled(running.map((registrationId) => turnRunnerIntoVolunteer(db, admin!, { registrationId, roleId, reason: "a devenit voluntar", sendEmail: false }, NOW)));

    expect(outcomes(settled)).toEqual(Array.from({ length: 5 }, () => "ok"));
    const rows = await db.select({ id: registrations.id, status: registrations.status }).from(registrations).where(eq(registrations.eventId, eventId));
    const statusOf = (id: string) => rows.find((row) => row.id === id)?.status;
    expect(running.map(statusOf)).toEqual(Array.from({ length: 5 }, () => "CANCELLED"));
    // The five freed places went to the five who waited, one each — never more places than the race has.
    expect(waiting.map(statusOf)).toEqual(Array.from({ length: 5 }, () => "WAITLIST_OFFERED"));
    expect(rows.filter((row) => row.status === "CONFIRMED" || row.status === "PENDING_DECLARATION" || row.status === "WAITLIST_OFFERED")).toHaveLength(5);
    const volunteers = await db.select({ state: eventVolunteers.state, volunteerNumber: eventVolunteers.volunteerNumber }).from(eventVolunteers).where(eq(eventVolunteers.eventId, eventId));
    expect(volunteers.map((row) => row.state)).toEqual(Array.from({ length: 5 }, () => "CONFIRMED"));
    // V001 to V005: the runners' numbers 1 to 5 stay retired with their cancelled registrations, in their own series.
    expect(volunteers.map((row) => row.volunteerNumber).sort((a, b) => (a ?? 0) - (b ?? 0))).toEqual([1, 2, 3, 4, 5]);
  });
});
