import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { auditLogs } from "@/db/schema/audit-logs";
import { emailOutbox } from "@/db/schema/email-outbox";
import { events } from "@/db/schema/events";
import { participants } from "@/db/schema/participants";
import { registrations } from "@/db/schema/registrations";
import { type StaffUser, staffUsers } from "@/db/schema/staff-users";
import {
  clearMemberTicksByStaff,
  deleteRegistrationByStaff,
  previewMemberTickSweep,
  setClubMemberDeclared,
} from "@/modules/registrations/admin-service";
import { listMemberTickCandidates, memberCanonicalEmails } from "@/modules/registrations/member-ticks";
import { resolveDisplayName } from "@/modules/registrations/names";
import { setClubMemberDeclaredByStaff } from "@/modules/registrations/service";
import { isDomainError } from "@/shared/errors/domain-error";
import { CLUB_NAME } from "@/theme/brand";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";

/**
 * BR-REQ-037-03 criterion 12 (§NNN) — the self-declared member tick, cleared or set by an
 * Administrator, one row at a time or in one audited sweep.
 *
 * The owner, 2026-10-02: «Vreau să pot „curăța” și să debifez cei care au bifat că sunt membri Brașov
 * Runners dar nu sunt.» What these hold:
 * - the verb writes the tick and nothing else: no state, no place, no email; the club name goes only
 *   when the tick wrote it; one audit row `{ from, to }`; an unchanged value is refused;
 * - the Administrator's alone — the Organizer reads the chip and changes nothing (§289);
 * - the sweep's preview is the ticked rows whose canonical address is no live account's, any role,
 *   in the list's scope; the press clears only the rows posted that are still candidates, in one
 *   transaction, with each row's audit and one summary row.
 */
const NOW = new Date("2026-10-02T10:00:00.000Z");

let db: TestDatabase;
let close: () => Promise<void>;
let admin: StaffUser;
let organizer: StaffUser;

beforeAll(async () => {
  ({ db, close } = await createTestDatabase());
});
afterAll(async () => close());

beforeEach(async () => {
  await resetTables(db);
  [admin] = await db.insert(staffUsers).values({ email: "admin@dev.test", displayName: "Admin", role: "ADMIN" }).returning();
  [organizer] = await db.insert(staffUsers).values({ email: "organizer@dev.test", displayName: "Organizer", role: "MODERATOR" }).returning();
});

async function createEvent(startsAt: Date) {
  const [event] = await db
    .insert(events)
    .values({ type: "RACE", startsAt, capacity: 150, registrationMode: "INTERNAL" })
    .returning();
  return event;
}

let serial = 0;
/** One registration on an address of its own; the address as the participant typed it. */
async function register(eventId: string, typed: string, row: Partial<typeof registrations.$inferInsert> = {}) {
  serial += 1;
  const lower = typed.toLowerCase();
  const [participant] = await db
    .insert(participants)
    .values({ deliveryEmail: typed, normalizedEmail: lower, canonicalEmail: lower, canonicalizationVersion: 2, defaultName: `Runner ${serial}`, preferredLocale: "ro" })
    .returning();
  const [created] = await db
    .insert(registrations)
    .values({
      eventId,
      participantId: participant.id,
      kind: "REAL",
      locale: "ro",
      registeredName: `Runner ${serial}`,
      displayName: resolveDisplayName({ legalName: `Runner ${serial}` }),
      privacyNoticeVersion: 1,
      privacyAcknowledgedAt: NOW,
      resultsNameConsent: false,
      resultsConsentVersion: 1,
      status: "CONFIRMED",
      clubMemberDeclared: true,
      clubName: CLUB_NAME,
      ...row,
    })
    .returning();
  return created;
}

async function rowOf(id: string) {
  const [row] = await db.select().from(registrations).where(eq(registrations.id, id));
  return row;
}

async function codeOf(operation: Promise<unknown>): Promise<string> {
  try {
    await operation;
    return "no error";
  } catch (error) {
    if (isDomainError(error)) return error.code;
    throw error;
  }
}

async function auditOf(action: string) {
  return db.select().from(auditLogs).where(eq(auditLogs.action, action));
}

describe("BR-REQ-037-03 criterion 12: the member tick on one registration", () => {
  it("clears the tick and the club name the tick wrote — no state, no place, no email — and audits { from, to }", async () => {
    const race = await createEvent(new Date("2099-11-21T08:00:00.000Z"));
    const registration = await register(race.id, "not.member@example.org", { bibNumber: 7 });

    await setClubMemberDeclared(db, admin, registration.id, false, NOW);

    const after = await rowOf(registration.id);
    expect(after.clubMemberDeclared).toBe(false);
    expect(after.clubName).toBeNull();
    expect(after.status).toBe("CONFIRMED");
    expect(after.bibNumber).toBe(7);
    expect(await db.select().from(emailOutbox)).toHaveLength(0);
    const [audit] = await auditOf("registration.club_member_tick_changed");
    expect(audit).toMatchObject({ actorStaffUserId: admin.id, participantId: registration.participantId, entityType: "registration", entityId: registration.id });
    expect(audit.metadataJson).toEqual({ from: true, to: false });
  });

  it("keeps a club the runner typed by hand when clearing, and writes the club's name when setting, as the form does", async () => {
    const race = await createEvent(new Date("2099-11-21T08:00:00.000Z"));
    const typed = await register(race.id, "typed.club@example.org", { clubName: "CS Alt Club" });
    await setClubMemberDeclared(db, admin, typed.id, false, NOW);
    expect((await rowOf(typed.id)).clubName).toBe("CS Alt Club");

    const unticked = await register(race.id, "unticked@example.org", { clubMemberDeclared: false, clubName: null });
    await setClubMemberDeclared(db, admin, unticked.id, true, NOW);
    const after = await rowOf(unticked.id);
    expect(after.clubMemberDeclared).toBe(true);
    expect(after.clubName).toBe(CLUB_NAME);
    const rows = await auditOf("registration.club_member_tick_changed");
    expect(rows.map((row) => row.metadataJson)).toContainEqual({ from: false, to: true });
  });

  it("works on any status: a cancelled row's tick is cleared like a confirmed one's", async () => {
    const race = await createEvent(new Date("2099-11-21T08:00:00.000Z"));
    const cancelled = await register(race.id, "cancelled@example.org", { status: "CANCELLED", cancelledAt: NOW, cancellationSource: "ADMIN" });
    await setClubMemberDeclared(db, admin, cancelled.id, false, NOW);
    expect(await rowOf(cancelled.id)).toMatchObject({ clubMemberDeclared: false, status: "CANCELLED" });
  });

  it("refuses a value that would not change, and writes nothing", async () => {
    const race = await createEvent(new Date("2099-11-21T08:00:00.000Z"));
    const registration = await register(race.id, "already@example.org");
    expect(await codeOf(setClubMemberDeclared(db, admin, registration.id, true, NOW))).toBe("CONFLICT");
    expect(await auditOf("registration.club_member_tick_changed")).toHaveLength(0);
    expect((await rowOf(registration.id)).clubMemberDeclared).toBe(true);
  });

  it("answers NOT_FOUND for an erased registration", async () => {
    const race = await createEvent(new Date("2099-11-21T08:00:00.000Z"));
    const registration = await register(race.id, "erased@example.org", { status: "CANCELLED", cancelledAt: NOW, cancellationSource: "ADMIN" });
    await deleteRegistrationByStaff(db, admin, registration.id, "asked to be erased", NOW);
    expect(await codeOf(setClubMemberDeclared(db, admin, registration.id, false, NOW))).toBe("NOT_FOUND");
  });

  it("is the Administrator's alone: the Organizer and the volunteer are refused, by the wrapper and by the service", async () => {
    const race = await createEvent(new Date("2099-11-21T08:00:00.000Z"));
    const registration = await register(race.id, "refused@example.org");
    const [volunteer] = await db.insert(staffUsers).values({ email: "volunteer@dev.test", displayName: "Volunteer", role: "CONTRIBUTOR" }).returning();
    for (const actor of [organizer, volunteer]) {
      expect(await codeOf(setClubMemberDeclared(db, actor, registration.id, false, NOW)), actor.role).toBe("FORBIDDEN");
      expect(await codeOf(setClubMemberDeclaredByStaff(db, actor, registration.id, false, NOW)), actor.role).toBe("FORBIDDEN");
    }
    expect((await rowOf(registration.id)).clubMemberDeclared).toBe(true);
    expect(await auditOf("registration.club_member_tick_changed")).toHaveLength(0);
  });
});

describe("BR-REQ-037-03 criterion 12: who counts as a member", () => {
  it("every live account, whatever its role, through the canonicalizer; a revoked (deleted) account is nobody", async () => {
    await db.insert(staffUsers).values([
      { email: "club.member@example.org", displayName: "Member", role: "MEMBER" },
      { email: "gone@example.org", displayName: "Gone", role: "MEMBER" },
    ]);
    await db.delete(staffUsers).where(eq(staffUsers.email, "gone@example.org"));
    const members = await memberCanonicalEmails(db);
    expect(members.has("club.member@example.org")).toBe(true);
    expect(members.has("admin@dev.test")).toBe(true);
    expect(members.has("organizer@dev.test")).toBe(true);
    expect(members.has("gone@example.org")).toBe(false);
  });
});

describe("BR-REQ-037-03 criterion 12: the sweep «Curăță bifele celor care nu sunt membri»", () => {
  async function scene() {
    const race = await createEvent(new Date("2099-11-21T08:00:00.000Z"));
    const nextRun = await createEvent(new Date("2099-11-28T08:00:00.000Z"));
    const past = await createEvent(new Date("2020-05-01T08:00:00.000Z"));
    await db.insert(staffUsers).values({ email: "club.member@example.org", displayName: "Member", role: "MEMBER" });
    return {
      race,
      nextRun,
      past,
      // Ticked, and no account has the address: the candidates.
      stranger: await register(race.id, "Stranger.One@Example.org"),
      another: await register(race.id, "stranger.two@example.org"),
      atNextRun: await register(nextRun.id, "stranger.three@example.org"),
      // Ticked, and a member: the address typed with capitals is the same identity.
      member: await register(race.id, "Club.Member@example.org"),
      // The Organizer's own registration: a colleague is a member too.
      colleague: await register(race.id, "organizer@dev.test"),
      // Not ticked, a test row, and an event already run: never in the preview of every event.
      unticked: await register(race.id, "unticked@example.org", { clubMemberDeclared: false, clubName: null }),
      test: await register(race.id, "test.row@example.org", { kind: "TEST" }),
      ranAlready: await register(past.id, "past.runner@example.org"),
    };
  }

  it("previews, in the list's scope, every ticked real registration whose address matches no member account", async () => {
    const s = await scene();
    const byEvent = await previewMemberTickSweep(db, admin, { eventId: s.race.id }, NOW);
    expect(byEvent.map((row) => row.id).sort()).toEqual([s.stranger.id, s.another.id].sort());
    expect(byEvent.find((row) => row.id === s.stranger.id)?.participantEmail).toBe("Stranger.One@Example.org");

    const everyUpcoming = await previewMemberTickSweep(db, admin, {}, NOW);
    expect(everyUpcoming.map((row) => row.id).sort()).toEqual([s.stranger.id, s.another.id, s.atNextRun.id].sort());

    // An event already run is in the preview only when the list is scoped to it.
    expect((await listMemberTickCandidates(db, { eventId: s.past.id }, NOW)).map((row) => row.id)).toEqual([s.ranAlready.id]);
  });

  it("clears only the rows posted that are still candidates, in one transaction, with each row's audit and one summary row", async () => {
    const s = await scene();
    // The Administrator unticked `another` in the preview (a member on another address); a member's
    // id posted by hand and an unticked row are not candidates and stay as they are.
    const { cleared } = await clearMemberTicksByStaff(db, admin, { scope: { eventId: s.race.id }, registrationIds: [s.stranger.id, s.member.id, s.unticked.id] }, NOW);

    expect(cleared).toBe(1);
    expect(await rowOf(s.stranger.id)).toMatchObject({ clubMemberDeclared: false, clubName: null, status: "CONFIRMED" });
    expect((await rowOf(s.another.id)).clubMemberDeclared).toBe(true);
    expect((await rowOf(s.member.id)).clubMemberDeclared).toBe(true);
    expect(await db.select().from(emailOutbox)).toHaveLength(0);

    const perRow = await auditOf("registration.club_member_tick_changed");
    expect(perRow.map((row) => row.entityId)).toEqual([s.stranger.id]);
    const [summary] = await auditOf("registrations.member_ticks_cleared");
    expect(summary).toMatchObject({ actorStaffUserId: admin.id, participantId: null, entityType: "event", entityId: s.race.id });
    expect(summary.metadataJson).toEqual({ count: 1, eventId: s.race.id });
  });

  it("reads the candidates again at the press: an account added since the preview keeps that person's tick", async () => {
    const s = await scene();
    const preview = await previewMemberTickSweep(db, admin, { eventId: s.race.id }, NOW);
    await db.insert(staffUsers).values({ email: "stranger.two@example.org", displayName: "New member", role: "MEMBER" });

    const { cleared } = await clearMemberTicksByStaff(db, admin, { scope: { eventId: s.race.id }, registrationIds: preview.map((row) => row.id) }, NOW);
    expect(cleared).toBe(1);
    expect((await rowOf(s.another.id)).clubMemberDeclared).toBe(true);
    expect((await rowOf(s.stranger.id)).clubMemberDeclared).toBe(false);
  });

  it("over every event not started: the summary row names no event", async () => {
    const s = await scene();
    const preview = await previewMemberTickSweep(db, admin, {}, NOW);
    const { cleared } = await clearMemberTicksByStaff(db, admin, { scope: {}, registrationIds: preview.map((row) => row.id) }, NOW);
    expect(cleared).toBe(3);
    expect((await rowOf(s.ranAlready.id)).clubMemberDeclared).toBe(true);
    const [summary] = await auditOf("registrations.member_ticks_cleared");
    expect(summary.entityId).toBeNull();
    expect(summary.metadataJson).toEqual({ count: 3, eventId: null });
  });

  it("refuses an empty selection and the Organizer, and writes nothing either way", async () => {
    const s = await scene();
    expect(await codeOf(clearMemberTicksByStaff(db, admin, { scope: { eventId: s.race.id }, registrationIds: [] }, NOW))).toBe("VALIDATION_ERROR");
    expect(await codeOf(clearMemberTicksByStaff(db, organizer, { scope: { eventId: s.race.id }, registrationIds: [s.stranger.id] }, NOW))).toBe("FORBIDDEN");
    expect(await codeOf(previewMemberTickSweep(db, organizer, { eventId: s.race.id }, NOW))).toBe("FORBIDDEN");
    expect((await rowOf(s.stranger.id)).clubMemberDeclared).toBe(true);
    expect(await db.select().from(auditLogs).where(and(eq(auditLogs.action, "registrations.member_ticks_cleared")))).toHaveLength(0);
  });

  it("a sweep that finds nothing to clear writes no summary row", async () => {
    const s = await scene();
    const { cleared } = await clearMemberTicksByStaff(db, admin, { scope: { eventId: s.race.id }, registrationIds: [s.member.id] }, NOW);
    expect(cleared).toBe(0);
    expect(await auditOf("registrations.member_ticks_cleared")).toHaveLength(0);
  });
});
