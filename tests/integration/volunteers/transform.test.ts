import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { auditLogs } from "@/db/schema/audit-logs";
import { emailOutbox } from "@/db/schema/email-outbox";
import { eventRaffleEntries } from "@/db/schema/event-raffle-entries";
import { eventVolunteerRoleAssignments, eventVolunteerRoleChoices, eventVolunteerRoles, eventVolunteers } from "@/db/schema/event-volunteers";
import { events, eventTranslations } from "@/db/schema/events";
import { participants } from "@/db/schema/participants";
import { registrations } from "@/db/schema/registrations";
import { type StaffUser, staffUsers } from "@/db/schema/staff-users";
import { computeContentHash, type LegalDocumentTranslationInput } from "@/modules/legal-documents/domain/content-hash";
import { insertLegalDocumentVersion } from "@/modules/legal-documents/repository";
import { ALREADY_ON_ADDRESS } from "@/modules/registrations/domain/family";
import { STAFF_ROLES, canManageRegistrations, type StaffRole } from "@/modules/staff-identity/domain/roles";
import { isDomainError } from "@/shared/errors/domain-error";
import { signingInput } from "../../helpers/declaration-signing";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";

/**
 * §948 — «Transformă în voluntar» and «Transformă în alergător» (the owner, 2026-11-15: «aș vrea să pot să „transform" un
 * alergător în voluntar și invers»). BR-REQ-037-03, BR-REQ-034-01, BR-REQ-038-01, BR-REQ-060-01.
 *
 * What is protected, on real PostgreSQL (PGlite), through the real registration flow:
 * - a runner turned volunteer is cancelled by the staff verb — the one allocator: the place offered to the first in line,
 *   never kept and never handed to the volunteer — and stands on the event's volunteers, confirmed, with the role given;
 * - the person's two emails go, or answered «… fără email» (`sendEmail` off) neither; the next in line's offer always goes;
 * - the runner's number stays retired with the registration; the volunteer draws one from the volunteers' own series;
 * - the answers the person gave travel only under a privacy notice that names the volunteers' answers; the public
 *   list's tick never;
 * - a volunteer turned runner goes through the official waiting list's own entry — a counted free place with the
 *   declaration still theirs to sign, or the back of the line, never ahead of anyone — and the volunteer is cancelled,
 *   keeping roles and number;
 * - every refusal writes nothing; both are the Administrator's and nobody else's;
 * - «Participă la tombolă» travels with the person, both ways (§953, amending §948 and §949): somebody an organizer took
 *   out of the raffle is not put back in it by a press that was about something else;
 * - «Prezent» travels one way (§983): a runner the desk had checked in is ticked present as a volunteer, in the press's own
 *   transaction, so the present-only raffle file keeps them; a volunteer turned runner carries nothing — checking a runner
 *   in is the desk's verb;
 * - a raffle sign-up travels both ways (§984): the same row, its door and its acceptance, moved to the row the person becomes
 *   in the press's own transaction and named in its trail row — a restarted registration that holds one keeps its own.
 */
const NOW = new Date("2026-11-15T10:00:00.000Z");
const STARTS = new Date("2026-12-13T08:00:00.000Z");

let db: TestDatabase;
let close: () => Promise<void>;
let admin: StaffUser;
let serial = 0;

vi.mock("@/db/client", () => ({ getDb: () => db }));
vi.mock("@/modules/notifications/drain", () => ({ drainOutboxAfterResponse: () => undefined, drainOutboxRowsAfterResponse: () => undefined }));

const { submitRegistration, confirmEmail, signDeclaration } = await import("@/modules/registrations/service");
const { pickBibNumber } = await import("@/modules/registrations/bibs");
const { changeVolunteer, setVolunteerNumbersStart } = await import("@/modules/volunteers/volunteers");
const { RUNNER_TO_VOLUNTEER_MINOR, turnRunnerIntoVolunteer, turnVolunteerIntoRunner, VOLUNTEER_TO_RUNNER_NEEDS_ADDRESS } = await import("@/modules/volunteers/transform");
const { setRegistrationInRaffle } = await import("@/modules/registrations/raffle-mark");
const { checkInByStaff } = await import("@/modules/registrations/admin-service");
const { exportRaffleList } = await import("@/modules/volunteers/raffle-list");
const { forgetCachedDeadlines } = await import("@/modules/deadlines/memo");

type EventInput = Parameters<typeof submitRegistration>[1];

beforeAll(async () => {
  ({ db, close } = await createTestDatabase());
});
afterAll(async () => close());
beforeEach(async () => {
  await resetTables(db);
  forgetCachedDeadlines();
  await approve(false);
  admin = await staff("ADMIN");
});

/** The texts in force; `profile` makes the privacy notice name the volunteers' answers (`{{volunteerProfile}}`, §765). */
async function approve(profile: boolean, version = 1) {
  const pair = (text: string): LegalDocumentTranslationInput[] => [
    { locale: "ro", title: "Document", body: { sections: [{ paragraphs: [text] }] } },
    { locale: "en", title: "Document", body: { sections: [{ paragraphs: [text] }] } },
  ];
  const notice = pair(profile ? "Voluntari ({{volunteers}}, {{volunteerAgreement}}, {{volunteerProfile}})" : "p");
  await insertLegalDocumentVersion(db, { key: "PRIVACY_NOTICE", version, effectiveAt: new Date("2026-01-01T00:00:00Z"), isApproved: true, contentSha256: computeContentHash(notice), translations: notice, now: NOW });
  if (version > 1) return;
  for (const key of ["TERMS", "EVENT_DECLARATION"] as const) {
    await insertLegalDocumentVersion(db, { key, version: 1, effectiveAt: new Date("2026-01-01T00:00:00Z"), isApproved: true, contentSha256: computeContentHash(pair("p")), translations: pair("p"), now: NOW });
  }
}

async function staff(role: StaffRole): Promise<StaffUser> {
  serial += 1;
  const [user] = await db.insert(staffUsers).values({ email: `${role.toLowerCase()}-${serial}@dev.test`, displayName: `Colleague ${role}`, role }).returning();
  return user;
}

const at = (minutes: number) => new Date(NOW.getTime() + minutes * 60_000);
const PUBLIC = { source: "PUBLIC" as const, createdByStaffUserId: null };

/** A race with its runners' numbers from 1, and one volunteers' role. */
async function createRace(capacity: number, options: { startsAt?: Date; shirts?: boolean } = {}): Promise<{ event: EventInput; roleId: string }> {
  const [event] = await db
    .insert(events)
    .values({
      type: "RACE",
      startsAt: options.startsAt ?? STARTS,
      registrationMode: "INTERNAL",
      capacity,
      bibStartNumber: 1,
      locationName: "Parcul Tractorul",
      editorialStatus: "PUBLISHED",
      publishedAt: NOW,
      volunteersShirts: options.shirts === true,
    })
    .returning();
  await db.insert(eventTranslations).values([
    { eventId: event.id, locale: "ro", title: "Crosul", slug: `crosul-${event.id.slice(0, 8)}` },
    { eventId: event.id, locale: "en", title: "The cross", slug: `cross-${event.id.slice(0, 8)}` },
  ]);
  const [role] = await db.insert(eventVolunteerRoles).values({ eventId: event.id, nameRo: "Punct de apă", nameEn: "Water point", needed: 5, position: 0 }).returning({ id: eventVolunteerRoles.id });
  return {
    event: { id: event.id, raceId: null, capacity: event.capacity, registrationMode: "INTERNAL", registrationOpensAt: null, registrationClosesAt: null, startsAt: event.startsAt, eventStatus: event.eventStatus, publishedAt: NOW },
    roleId: role.id,
  };
}

const submission = (firstName: string, sentAt: Date, more: Record<string, unknown> = {}) => ({
  firstName,
  lastName: "Munteanu",
  birthDate: "1985-03-02",
  sex: "FEMALE",
  nationality: "RO",
  country: "RO",
  city: "Brașov",
  phone: "+40711111111",
  emergencyContactName: "Ion Vecinul",
  emergencyContactPhone: "+40722222222",
  email: `${firstName.toLowerCase()}@example.ro`,
  locale: "ro",
  privacyAcknowledged: true,
  fitnessDeclared: true,
  termsAccepted: true,
  rulesAcknowledged: true,
  resultsNameConsent: false,
  listOptOut: false,
  honeypot: "",
  renderedAt: new Date(sentAt.getTime() - 30_000).toISOString(),
  ...more,
});

async function rowOf(name: string) {
  const [row] = await db.select().from(registrations).where(eq(registrations.registeredName, `${name} Munteanu`));
  return row;
}

/** One person through the address's confirmation, then — `signs` — the declaration. */
async function registered(event: EventInput, name: string, minute: number, signs: boolean, more: Record<string, unknown> = {}) {
  await submitRegistration(db, event, submission(name, at(minute), more), at(minute), "REAL", PUBLIC);
  const confirmed = await confirmEmail(db, event, (await rowOf(name)).id, at(minute));
  if (!signs) return confirmed;
  return signDeclaration(db, event, confirmed.id, await signingInput(db, at(minute + 1), `${name} Munteanu`), at(minute + 1));
}

/** The places taken, as the capacity formula counts them here: confirmed, held for a declaration, or offered. */
const placesHeld = async (eventId: string) =>
  (await db.select({ status: registrations.status }).from(registrations).where(eq(registrations.eventId, eventId))).filter((row) => ["CONFIRMED", "PENDING_DECLARATION", "WAITLIST_OFFERED"].includes(row.status)).length;
const volunteersOf = (eventId: string) => db.select().from(eventVolunteers).where(eq(eventVolunteers.eventId, eventId)).orderBy(asc(eventVolunteers.createdAt));
const mailOf = async (type: (typeof emailOutbox.$inferSelect)["messageType"]) => db.select().from(emailOutbox).where(eq(emailOutbox.messageType, type));
const trail = async (action: string) => (await db.select().from(auditLogs).where(eq(auditLogs.action, action)).orderBy(asc(auditLogs.createdAt))).map((row) => ({ entityId: row.entityId, metadata: row.metadataJson as Record<string, unknown>, actor: row.actorStaffUserId }));

async function failureOf(operation: Promise<unknown>) {
  try {
    await operation;
  } catch (error) {
    if (isDomainError(error)) return error;
    throw error;
  }
  throw new Error("expected a DomainError");
}

/** Everything a refused press must leave as it found it. */
async function snapshot() {
  return {
    registrations: (await db.select({ id: registrations.id, status: registrations.status, bib: registrations.bibNumber }).from(registrations).orderBy(asc(registrations.id))).map((row) => JSON.stringify(row)),
    volunteers: (await db.select({ id: eventVolunteers.id, state: eventVolunteers.state, bib: eventVolunteers.bibNumber }).from(eventVolunteers).orderBy(asc(eventVolunteers.id))).map((row) => JSON.stringify(row)),
    outbox: (await db.select({ id: emailOutbox.id }).from(emailOutbox)).length,
    trail: (await db.select({ id: auditLogs.id }).from(auditLogs)).length,
  };
}

const toVolunteer = (registrationId: string, roleId: string, actor: StaffUser = admin, more: { sendEmail?: boolean } = {}) =>
  turnRunnerIntoVolunteer(db, actor, { registrationId, roleId, reason: "a devenit voluntar", ...more }, at(30));

describe("§948 BR-REQ-037-03 «Transformă în voluntar»: a runner becomes a volunteer", () => {
  it("cancels the registration through the allocator — the place offered to the first in line — and enters the person on the volunteers, confirmed, with the role given", async () => {
    const { event, roleId } = await createRace(1);
    const radu = await registered(event, "Radu", 0, true);
    expect(radu.status).toBe("CONFIRMED");
    expect((await registered(event, "Elena", 3, false)).status).toBe("WAITLISTED");
    expect(await placesHeld(event.id)).toBe(1);

    const result = await toVolunteer(radu.id, roleId);

    // The registration: cancelled by the club, its place offered — never kept, never the volunteer's.
    expect(await rowOf("Radu")).toMatchObject({ status: "CANCELLED", cancellationSource: "ADMIN" });
    expect((await rowOf("Elena")).status).toBe("WAITLIST_OFFERED");
    expect(await placesHeld(event.id)).toBe(1);
    // The volunteer: the person's own name, address, telephone and language, entered by the Administrator, confirmed.
    const [volunteer, ...more] = await volunteersOf(event.id);
    expect(more).toEqual([]);
    expect(volunteer).toMatchObject({
      id: result.volunteerId,
      name: "Radu Munteanu",
      email: "radu@example.ro",
      phone: "+40711111111",
      locale: "ro",
      state: "CONFIRMED",
      source: "STAFF",
      roleId,
      createdByStaffUserId: admin.id,
      listOptIn: false,
      hasKit: false,
    });
    expect((await db.select().from(eventVolunteerRoleAssignments).where(eq(eventVolunteerRoleAssignments.volunteerId, volunteer.id))).map((row) => row.roleId)).toEqual([roleId]);
    expect((await db.select().from(eventVolunteerRoleChoices).where(eq(eventVolunteerRoleChoices.volunteerId, volunteer.id))).map((row) => row.roleId)).toEqual([roleId]);
    expect(result).toEqual({ eventId: event.id, volunteerId: volunteer.id, bibNumber: null });

    // The emails: the person's two, and the next in line's offer.
    expect((await mailOf("REGISTRATION_CANCELLED")).map((row) => row.registrationId)).toEqual([radu.id]);
    const roles = await mailOf("VOLUNTEER_ROLE_ASSIGNED");
    expect(roles.map((row) => row.recipientEmail)).toEqual(["radu@example.ro"]);
    expect((await mailOf("WAITLIST_SPOT_OFFER")).map((row) => row.registrationId)).toEqual([(await rowOf("Elena")).id]);

    // The trail: each verb's own row, and one that ties the two — ids, never a name.
    expect(await trail("registration.cancelled_by_staff")).toEqual([{ entityId: radu.id, actor: admin.id, metadata: { from: "CONFIRMED", reason: "a devenit voluntar" } }]);
    expect(await trail("registration.became_volunteer")).toEqual([{ entityId: radu.id, actor: admin.id, metadata: { volunteerId: volunteer.id, roleId, from: "CONFIRMED" } }]);
    expect((await trail("volunteer.added")).map((row) => row.metadata.volunteerId)).toEqual([volunteer.id]);
    expect((await trail("volunteer.state_changed")).map((row) => [row.metadata.from, row.metadata.to])).toEqual([["REGISTERED", "CONFIRMED"]]);
    const written = JSON.stringify(await db.select({ metadata: auditLogs.metadataJson }).from(auditLogs).where(inArray(auditLogs.action, ["registration.became_volunteer", "volunteer.added", "volunteer.state_changed"])));
    expect(written).not.toContain("Radu");
    expect(written).not.toContain("radu@");
  });

  it("answered «… fără email» (`sendEmail` off) sends the person neither email, says so in the trail, and still offers the freed place", async () => {
    const { event, roleId } = await createRace(1);
    const radu = await registered(event, "Radu", 0, true);
    await registered(event, "Elena", 3, false);

    await toVolunteer(radu.id, roleId, admin, { sendEmail: false });

    expect(await mailOf("REGISTRATION_CANCELLED")).toEqual([]);
    expect(await mailOf("VOLUNTEER_ROLE_ASSIGNED")).toEqual([]);
    expect(await mailOf("WAITLIST_SPOT_OFFER")).toHaveLength(1);
    expect((await rowOf("Radu")).status).toBe("CANCELLED");
    expect((await volunteersOf(event.id))[0].state).toBe("CONFIRMED");
    expect((await trail("registration.cancelled_by_staff"))[0].metadata).toMatchObject({ emailSkipped: true });
    expect((await trail("volunteer.added"))[0].metadata).toMatchObject({ emailSkipped: true });
  });

  it("moves a runner who was only waiting: nobody is offered anything, because no place was freed", async () => {
    const { event, roleId } = await createRace(1);
    await registered(event, "Radu", 0, true);
    const elena = await registered(event, "Elena", 3, false);
    expect(elena.status).toBe("WAITLISTED");

    await toVolunteer(elena.id, roleId);

    expect((await rowOf("Elena")).status).toBe("CANCELLED");
    expect((await rowOf("Radu")).status).toBe("CONFIRMED");
    expect(await mailOf("WAITLIST_SPOT_OFFER")).toEqual([]);
    expect((await volunteersOf(event.id)).map((row) => [row.name, row.state])).toEqual([["Elena Munteanu", "CONFIRMED"]]);
    expect((await trail("registration.became_volunteer"))[0].metadata).toMatchObject({ from: "WAITLISTED" });
  });

  it("BR-REQ-038-01: the runner's number stays retired with the registration, and the volunteer draws one from the volunteers' own series", async () => {
    const { event, roleId } = await createRace(150);
    const radu = await registered(event, "Radu", 0, true);
    expect(radu.bibNumber).toBe(1);
    await setVolunteerNumbersStart(db, admin, { eventId: event.id, start: 500 }, at(5));

    const result = await toVolunteer(radu.id, roleId);

    expect(result.bibNumber).toBe(500);
    expect((await volunteersOf(event.id))[0].bibNumber).toBe(500);
    // The registration keeps its number, cancelled: nobody else is ever handed it.
    expect((await rowOf("Radu")).bibNumber).toBe(1);
    const next = await db.transaction((tx) => pickBibNumber(tx, event.id, new Set(), undefined, "race"));
    expect(next).toBe(2);
    expect((await trail("volunteer.state_changed"))[0].metadata).toMatchObject({ bibNumber: 500 });
  });

  it("carries the answers the person gave only under a privacy notice that names the volunteers' answers — and never a place on the public list", async () => {
    const { event, roleId } = await createRace(10, { shirts: true });
    const radu = await registered(event, "Radu", 0, true, { clubMember: true });
    await toVolunteer(radu.id, roleId);
    // The notice in force names none of them: the row holds the contact alone.
    expect((await volunteersOf(event.id))[0]).toMatchObject({ dateOfBirth: null, age: null, sex: null, city: null, clubMember: false, shirtSize: null, volunteeredBefore: false, listOptIn: false });

    await approve(true, 2);
    const elena = await registered(event, "Elena", 40, true, { email: "elena@example.ro" });
    await turnRunnerIntoVolunteer(db, admin, { registrationId: elena.id, roleId, reason: "a devenit voluntar" }, at(50));
    const [, second] = await volunteersOf(event.id);
    expect(second).toMatchObject({ name: "Elena Munteanu", dateOfBirth: "1985-03-02", age: 41, sex: "FEMALE", city: "Brașov", volunteeredBefore: false, listOptIn: false, listOptInNoticeVersion: null });
    expect(second.clubMember).toBe((await rowOf("Elena")).clubMemberDeclared);
  });

  it("keeps the registration's language for the volunteer's emails", async () => {
    const { event, roleId } = await createRace(10);
    const radu = await registered(event, "Radu", 0, true, { locale: "en" });
    await toVolunteer(radu.id, roleId);
    expect((await volunteersOf(event.id))[0].locale).toBe("en");
    expect((await mailOf("VOLUNTEER_ROLE_ASSIGNED")).map((row) => row.locale)).toEqual(["en"]);
  });

  it("carries «Participă la tombolă»: a runner an organizer took out of the raffle is out of it as a volunteer too, and one who was in stays in (§953)", async () => {
    const { event, roleId } = await createRace(150);
    await setVolunteerNumbersStart(db, admin, { eventId: event.id, start: 500 }, at(0));
    const radu = await registered(event, "Radu", 1, true);
    const elena = await registered(event, "Elena", 3, true);
    // The Organizer took Radu out on the registrations list: his number is off the raffle's file.
    await setRegistrationInRaffle(db, await staff("MODERATOR"), radu.id, false, at(10));
    expect((await exportRaffleList(db, admin, event.id, at(11))).rows.map((row) => row.name)).toEqual(["Elena Munteanu"]);

    const out = await toVolunteer(radu.id, roleId);
    const stays = await toVolunteer(elena.id, roleId);

    const rows = await volunteersOf(event.id);
    expect(rows.find((row) => row.id === out.volunteerId)).toMatchObject({ name: "Radu Munteanu", state: "CONFIRMED", bibNumber: 500, inRaffle: false });
    expect(rows.find((row) => row.id === stays.volunteerId)).toMatchObject({ name: "Elena Munteanu", state: "CONFIRMED", bibNumber: 501, inRaffle: true });
    // The press that was about something else did not put him back: the file has Elena, the volunteer, and never Radu.
    expect((await exportRaffleList(db, admin, event.id, at(40))).rows).toEqual([{ number: 501, name: "Elena Munteanu", kind: "VOLUNTEER", present: false }]);
    // Said in the trail as the volunteers' own tick says it: once, for Radu alone, by the Administrator who pressed.
    const ticks = (await trail("volunteer.edited")).filter((row) => (row.metadata.fields as string[]).includes("inRaffle"));
    expect(ticks).toEqual([{ entityId: event.id, actor: admin.id, metadata: expect.objectContaining({ volunteerId: out.volunteerId, fields: ["inRaffle"], inRaffle: false }) }]);
    // The cancelled registration keeps what it held, and nobody was written to about a raffle: the transform's own emails alone.
    expect((await rowOf("Radu")).inRaffle).toBe(false);
    expect((await db.select().from(emailOutbox)).map((row) => row.messageType).filter((type) => !["VERIFY_REGISTRATION_EMAIL", "COMPLETE_DECLARATION", "REGISTRATION_CONFIRMED", "REGISTRATION_CANCELLED", "VOLUNTEER_ROLE_ASSIGNED"].includes(type))).toEqual([]);
  });

  it("carries «Prezent» one way: a runner the desk had checked in is ticked present as a volunteer, by the volunteers' own tick — one who was not stays absent (§983)", async () => {
    const { event, roleId } = await createRace(150);
    await setVolunteerNumbersStart(db, admin, { eventId: event.id, start: 500 }, at(0));
    const radu = await registered(event, "Radu", 1, true);
    const elena = await registered(event, "Elena", 3, true);
    // Radu was checked in at the desk on the morning of the race; Elena was not.
    await checkInByStaff(db, admin, radu.id, "in", at(20));
    expect((await rowOf("Radu")).checkedInAt).toEqual(at(20));

    const here = await toVolunteer(radu.id, roleId);
    const away = await toVolunteer(elena.id, roleId);

    const rows = await volunteersOf(event.id);
    expect(rows.find((row) => row.id === here.volunteerId)).toMatchObject({ name: "Radu Munteanu", state: "CONFIRMED", bibNumber: 500, present: true, inRaffle: true });
    expect(rows.find((row) => row.id === away.volunteerId)).toMatchObject({ name: "Elena Munteanu", state: "CONFIRMED", bibNumber: 501, present: false });
    // Said in the trail as the volunteers' own tick says it: once, for Radu alone, by the Administrator who pressed, at the press.
    const ticks = (await trail("volunteer.edited")).filter((row) => (row.metadata.fields as string[]).includes("present"));
    expect(ticks).toEqual([{ entityId: event.id, actor: admin.id, metadata: { volunteerId: here.volunteerId, fields: ["present"], present: true, assignedRoleIds: [roleId] } }]);
    // The press about something else kept him on the present-only raffle file; Elena, who never came to the desk, is not on it.
    expect((await exportRaffleList(db, admin, event.id, at(40), { onlyPresent: true })).rows).toEqual([{ number: 500, name: "Radu Munteanu", kind: "VOLUNTEER", present: true }]);
    expect((await exportRaffleList(db, admin, event.id, at(41))).rows.map((row) => [row.number, row.present])).toEqual([[500, true], [501, false]]);
    // Nobody was written to about it: the transform's own emails alone.
    expect((await db.select().from(emailOutbox)).map((row) => row.messageType).filter((type) => !["VERIFY_REGISTRATION_EMAIL", "COMPLETE_DECLARATION", "REGISTRATION_CONFIRMED", "REGISTRATION_CANCELLED", "VOLUNTEER_ROLE_ASSIGNED", "BIB_ASSIGNED"].includes(type))).toEqual([]);
  });

  it("ticks «Prezent» inside the transform's own transaction: a press refused after the tick leaves no volunteer, no tick and no trail of it (§983)", async () => {
    const { event, roleId } = await createRace(150);
    const radu = await registered(event, "Radu", 1, true);
    await checkInByStaff(db, admin, radu.id, "in", at(20));
    // The press's last write — the row that ties the two — refused by the database, after the volunteer was entered and ticked.
    await db.execute(sql`CREATE FUNCTION refuse_became_volunteer() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action = 'registration.became_volunteer' THEN RAISE EXCEPTION 'refused for the test'; END IF; RETURN NEW; END $$`);
    await db.execute(sql`CREATE TRIGGER refuse_became_volunteer BEFORE INSERT ON audit_logs FOR EACH ROW EXECUTE FUNCTION refuse_became_volunteer()`);
    try {
      const before = await snapshot();
      await expect(toVolunteer(radu.id, roleId)).rejects.toThrow();
      expect(await snapshot()).toEqual(before);
      expect(await volunteersOf(event.id)).toEqual([]);
      expect((await trail("volunteer.edited")).filter((row) => (row.metadata.fields as string[]).includes("present"))).toEqual([]);
      expect((await rowOf("Radu")).status).toBe("CONFIRMED");
    } finally {
      await db.execute(sql`DROP TRIGGER refuse_became_volunteer ON audit_logs`);
      await db.execute(sql`DROP FUNCTION refuse_became_volunteer()`);
    }
    // Pressed again once nothing refuses it, the person is a volunteer, present.
    const { volunteerId } = await toVolunteer(radu.id, roleId);
    expect((await volunteersOf(event.id)).map((row) => [row.id, row.present])).toEqual([[volunteerId, true]]);
  });

  it("BR-REQ-060-01: is the Administrator's — the Organizer, who manages volunteers, and every other role are refused, and nothing is written", async () => {
    const { event, roleId } = await createRace(10);
    const radu = await registered(event, "Radu", 0, true);
    const before = await snapshot();
    for (const role of STAFF_ROLES) {
      if (canManageRegistrations(role)) continue;
      const refusal = await failureOf(toVolunteer(radu.id, roleId, await staff(role)));
      expect(refusal.code, role).toBe("FORBIDDEN");
    }
    expect(await snapshot()).toEqual(before);
    expect(await volunteersOf(event.id)).toEqual([]);
  });

  it("refuses, writing nothing: no role or another event's, a registration that is gone, cancelled, never confirmed or a test one, a person under eighteen, an address already volunteering", async () => {
    const { event, roleId } = await createRace(10);
    const other = await createRace(10);
    const radu = await registered(event, "Radu", 0, true);

    let before = await snapshot();
    expect(await failureOf(toVolunteer(radu.id, ""))).toMatchObject({ code: "VALIDATION_ERROR", fields: ["roleId"] });
    expect(await failureOf(toVolunteer(radu.id, other.roleId))).toMatchObject({ code: "VALIDATION_ERROR", fields: ["roleId"] });
    expect((await failureOf(toVolunteer("not-an-id", roleId))).code).toBe("NOT_FOUND");
    expect((await failureOf(toVolunteer("00000000-0000-4000-8000-000000000000", roleId))).code).toBe("NOT_FOUND");
    expect(await snapshot()).toEqual(before);

    // Never confirmed: no place, no state to leave.
    await submitRegistration(db, event, submission("Mara", at(5)), at(5), "REAL", PUBLIC);
    before = await snapshot();
    expect((await failureOf(toVolunteer((await rowOf("Mara")).id, roleId))).code).toBe("CONFLICT");
    // A test registration is nobody.
    await submitRegistration(db, event, submission("Test", at(6)), at(6), "TEST", PUBLIC);
    before = await snapshot();
    const test = await rowOf("Test");
    await db.update(registrations).set({ status: "CONFIRMED" }).where(eq(registrations.id, test.id));
    before = await snapshot();
    expect((await failureOf(toVolunteer(test.id, roleId))).code).toBe("VALIDATION_ERROR");
    expect(await snapshot()).toEqual(before);

    // Under eighteen on the event's day: a minor volunteers only with a parent's agreement.
    await db.update(registrations).set({ birthDate: "2008-12-14" }).where(eq(registrations.id, radu.id));
    before = await snapshot();
    expect((await failureOf(toVolunteer(radu.id, roleId))).code).toBe(RUNNER_TO_VOLUNTEER_MINOR);
    expect(await snapshot()).toEqual(before);
    // Eighteen on the day itself is an adult.
    await db.update(registrations).set({ birthDate: "2008-12-13" }).where(eq(registrations.id, radu.id));

    // The address already on the event's volunteers: the entry's own refusal, and the registration stands.
    await changeVolunteer(db, admin, { kind: "add", eventId: event.id, fields: { assignedRoleIds: [roleId], name: "Radu M.", email: "radu@example.ro" } }, at(10), { sendEmail: false });
    before = await snapshot();
    expect((await failureOf(toVolunteer(radu.id, roleId))).code).toBe("VOLUNTEER_ALREADY_LISTED");
    expect(await snapshot()).toEqual(before);
    expect((await rowOf("Radu")).status).toBe("CONFIRMED");

    // Already cancelled: nobody to move.
    const elena = await registered(event, "Elena", 20, true);
    await toVolunteer(elena.id, roleId);
    before = await snapshot();
    expect((await failureOf(toVolunteer(elena.id, roleId))).code).toBe("CONFLICT");
    expect(await snapshot()).toEqual(before);
  });
});

/** A volunteer as the card's hand entry writes one, with the role given. */
async function volunteer(eventId: string, roleId: string, name: string, email: string | null, minute: number, confirmed = true): Promise<string> {
  const added = await changeVolunteer(db, admin, { kind: "add", eventId, fields: { assignedRoleIds: [roleId], name, email: email ?? "", phone: "+40712345678" } }, at(minute), { sendEmail: false });
  if (confirmed) await changeVolunteer(db, admin, { kind: "setState", eventId, id: added.volunteer.id, state: "CONFIRMED" }, at(minute + 1), { sendEmail: false });
  return added.volunteer.id;
}

const toRunner = (eventId: string, volunteerId: string, actor: StaffUser = admin, more: Partial<{ firstName: string; lastName: string; relayedByParticipantRequest: boolean }> = {}) =>
  turnVolunteerIntoRunner(db, actor, { eventId, volunteerId, firstName: "Ana", lastName: "Pop", relayedByParticipantRequest: true, ...more }, at(30));

describe("§948 BR-REQ-037-03 «Transformă în alergător»: a volunteer becomes a runner", () => {
  it("enters the person by the official list's own entry — a counted free place, the declaration theirs to sign — and cancels the volunteer, who keeps roles and number", async () => {
    const { event, roleId } = await createRace(150);
    await setVolunteerNumbersStart(db, admin, { eventId: event.id, start: 500 }, at(0));
    const ana = await volunteer(event.id, roleId, "Ana Pop", "ana@example.ro", 1);
    expect((await volunteersOf(event.id))[0].bibNumber).toBe(500);

    const result = await toRunner(event.id, ana);

    const [registration, ...more] = await db.select().from(registrations).where(eq(registrations.eventId, event.id));
    expect(more).toEqual([]);
    // A place held for the declaration the person signs themselves: never confirmed by this press, no number yet.
    expect(registration).toMatchObject({ id: result.registrationId, status: "PENDING_DECLARATION", registeredName: "Ana Pop", firstName: "Ana", lastName: "Pop", locale: "ro", kind: "REAL", bibNumber: null, confirmedAt: null });
    expect(result).toMatchObject({ eventId: event.id, volunteerId: ana, status: "PENDING_DECLARATION", capacityRaisedTo: null });
    const [person] = await db.select().from(participants).where(eq(participants.id, registration.participantId));
    expect(person.deliveryEmail).toBe("ana@example.ro");
    expect(await placesHeld(event.id)).toBe(1);
    expect((await mailOf("COMPLETE_DECLARATION")).map((row) => row.registrationId)).toEqual([registration.id]);
    expect(await mailOf("VERIFY_REGISTRATION_EMAIL")).toEqual([]);

    // The volunteer: cancelled, the row, its role and its number kept — and the number never drawn again.
    const [row] = await volunteersOf(event.id);
    expect(row).toMatchObject({ id: ana, state: "CANCELLED", bibNumber: 500, roleId });
    const dan = await volunteer(event.id, roleId, "Dan Ionescu", "dan@example.ro", 40);
    expect((await db.select().from(eventVolunteers).where(eq(eventVolunteers.id, dan)))[0].bibNumber).toBe(501);

    // The trail: the entry's own rows, the volunteers' own, and one that ties the two — ids alone.
    expect(await trail("volunteer.became_runner")).toEqual([{ entityId: event.id, actor: admin.id, metadata: { volunteerId: ana, registrationId: registration.id, to: "PENDING_DECLARATION" } }]);
    expect((await trail("registration.address_vouched_on_entry")).map((entry) => entry.entityId)).toEqual([registration.id]);
    expect((await trail("volunteer.state_changed")).map((entry) => [entry.metadata.volunteerId, entry.metadata.to])).toContainEqual([ana, "CANCELLED"]);
  });

  it("BR-REQ-034-01: on a full race joins the back of the line — never ahead of the one already waiting, never a place by itself", async () => {
    const { event, roleId } = await createRace(1);
    await registered(event, "Radu", 0, true);
    await registered(event, "Elena", 3, false);
    const ana = await volunteer(event.id, roleId, "Ana Pop", "ana@example.ro", 5);

    const result = await toRunner(event.id, ana);

    expect(result.status).toBe("WAITLISTED");
    expect(await placesHeld(event.id)).toBe(1);
    const waiting = await db
      .select({ name: registrations.registeredName, queuedAt: registrations.waitlistedAt })
      .from(registrations)
      .where(and(eq(registrations.eventId, event.id), eq(registrations.status, "WAITLISTED")))
      .orderBy(asc(registrations.waitlistedAt));
    expect(waiting.map((row) => row.name)).toEqual(["Elena Munteanu", "Ana Pop"]);
    expect((await mailOf("WAITLIST_JOINED")).map((row) => row.registrationId)).toContain(result.registrationId);
    // No place, so no declaration to sign yet: the person is told they wait, and nothing else.
    expect((await mailOf("COMPLETE_DECLARATION")).filter((row) => row.registrationId === result.registrationId)).toEqual([]);
    expect((await volunteersOf(event.id))[0].state).toBe("CANCELLED");
  });

  it("writes to the person in the language their volunteer row holds", async () => {
    const { event, roleId } = await createRace(10);
    const ana = await volunteer(event.id, roleId, "Ana Pop", "ana@example.ro", 1);
    await db.update(eventVolunteers).set({ locale: "en" }).where(eq(eventVolunteers.id, ana));
    const result = await toRunner(event.id, ana);
    expect((await db.select().from(registrations).where(eq(registrations.id, result.registrationId)))[0].locale).toBe("en");
    expect((await mailOf("COMPLETE_DECLARATION")).map((row) => row.locale)).toEqual(["en"]);
  });

  it("carries «Participă la tombolă»: a volunteer the organizers took out of the raffle is out of it as a runner too, and one who was in stays in (§953)", async () => {
    const { event, roleId } = await createRace(150);
    const ana = await volunteer(event.id, roleId, "Ana Pop", "ana@example.ro", 1);
    const dan = await volunteer(event.id, roleId, "Dan Ionescu", "dan@example.ro", 3);
    // The Organizer took Ana out on the «Voluntari» list.
    await changeVolunteer(db, await staff("MODERATOR"), { kind: "setRaffle", eventId: event.id, id: ana, inRaffle: false }, at(10));

    const out = await toRunner(event.id, ana);
    const stays = await toRunner(event.id, dan, admin, { firstName: "Dan", lastName: "Ionescu" });

    const registrationOf = async (id: string) => (await db.select().from(registrations).where(eq(registrations.id, id)))[0];
    // The entry's own outcome — a counted free place, the declaration theirs to sign — and the tick the person held.
    expect(await registrationOf(out.registrationId)).toMatchObject({ registeredName: "Ana Pop", status: "PENDING_DECLARATION", bibNumber: null, inRaffle: false });
    expect(await registrationOf(stays.registrationId)).toMatchObject({ registeredName: "Dan Ionescu", status: "PENDING_DECLARATION", inRaffle: true });
    // Said in the trail as the registrations' own tick says it: once, for Ana alone, by the Administrator who pressed.
    expect(await trail("registration.raffle_excluded")).toEqual([{ entityId: out.registrationId, actor: admin.id, metadata: { inRaffle: false } }]);
    expect(await trail("registration.raffle_included")).toEqual([]);
    // The cancelled volunteer keeps what she held.
    expect((await db.select().from(eventVolunteers).where(eq(eventVolunteers.id, ana)))[0]).toMatchObject({ state: "CANCELLED", inRaffle: false });
    // Once she signs and is confirmed with a number, the raffle's file still leaves her out; Dan, confirmed, is on it.
    await db.update(registrations).set({ status: "CONFIRMED", confirmedAt: at(50), bibNumber: 7, holdExpiresAt: null }).where(eq(registrations.id, out.registrationId));
    await db.update(registrations).set({ status: "CONFIRMED", confirmedAt: at(50), bibNumber: 8, holdExpiresAt: null }).where(eq(registrations.id, stays.registrationId));
    expect((await exportRaffleList(db, admin, event.id, at(60))).rows.map((row) => [row.number, row.name, row.kind])).toEqual([[8, "Dan Ionescu", "RUNNER"]]);
  });

  it("carries no «Prezent»: a volunteer ticked present becomes a runner nobody checked in — the desk's verb, with its own conditions (§983)", async () => {
    const { event, roleId } = await createRace(150);
    const ana = await volunteer(event.id, roleId, "Ana Pop", "ana@example.ro", 1);
    // The Organizer ticked her «Prezent» on the «Voluntari» list.
    await changeVolunteer(db, await staff("MODERATOR"), { kind: "setPresent", eventId: event.id, id: ana, present: true }, at(10));
    const ticksBefore = (await trail("volunteer.edited")).filter((row) => (row.metadata.fields as string[]).includes("present"));
    expect(ticksBefore).toHaveLength(1);

    const result = await toRunner(event.id, ana);

    const [registration] = await db.select().from(registrations).where(eq(registrations.id, result.registrationId));
    // A place held for the declaration she signs herself: not confirmed, so not one the desk could check in — and nobody did.
    expect(registration).toMatchObject({ status: "PENDING_DECLARATION", checkedInAt: null, checkedInByStaffUserId: null });
    expect(await trail("registration.checked_in")).toEqual([]);
    // The cancelled volunteer keeps what she held, and no tick of anybody's was written by the press.
    expect((await db.select().from(eventVolunteers).where(eq(eventVolunteers.id, ana)))[0]).toMatchObject({ state: "CANCELLED", present: true });
    expect((await trail("volunteer.edited")).filter((row) => (row.metadata.fields as string[]).includes("present"))).toEqual(ticksBefore);
    // Confirmed with a number later, she is on the whole raffle file as a runner nobody checked in — and on no present-only one.
    await db.update(registrations).set({ status: "CONFIRMED", confirmedAt: at(50), bibNumber: 7, holdExpiresAt: null }).where(eq(registrations.id, result.registrationId));
    expect((await exportRaffleList(db, admin, event.id, at(60))).rows).toEqual([{ number: 7, name: "Ana Pop", kind: "RUNNER", present: false }]);
    expect((await exportRaffleList(db, admin, event.id, at(61), { onlyPresent: true })).rows).toEqual([]);
  });

  it("BR-REQ-060-01: is the Administrator's — the Organizer and every other role are refused, and nothing is written", async () => {
    const { event, roleId } = await createRace(10);
    const ana = await volunteer(event.id, roleId, "Ana Pop", "ana@example.ro", 1);
    const before = await snapshot();
    for (const role of STAFF_ROLES) {
      if (canManageRegistrations(role)) continue;
      expect((await failureOf(toRunner(event.id, ana, await staff(role)))).code, role).toBe("FORBIDDEN");
    }
    expect(await snapshot()).toEqual(before);
  });

  it("refuses, writing nothing: without the relay tick or a name, a volunteer with no address, a cancelled one, another event's, after the start, the person already registered on the address", async () => {
    const { event, roleId } = await createRace(10);
    const other = await createRace(10);
    const ana = await volunteer(event.id, roleId, "Ana Pop", "ana@example.ro", 1);

    let before = await snapshot();
    expect((await failureOf(toRunner(event.id, ana, admin, { relayedByParticipantRequest: false }))).fields).toContain("relayedByParticipantRequest");
    expect((await failureOf(toRunner(event.id, ana, admin, { lastName: " " }))).fields).toContain("lastName");
    expect((await failureOf(toRunner(other.event.id, ana))).code).toBe("NOT_FOUND");
    expect((await failureOf(toRunner(event.id, "not-an-id"))).code).toBe("NOT_FOUND");
    expect(await snapshot()).toEqual(before);

    // No address: a registration is its address.
    const noAddress = await volunteer(event.id, roleId, "Ion Fără Adresă", null, 5);
    before = await snapshot();
    expect((await failureOf(toRunner(event.id, noAddress))).code).toBe(VOLUNTEER_TO_RUNNER_NEEDS_ADDRESS);
    // Cancelled: reopen first.
    await changeVolunteer(db, admin, { kind: "setState", eventId: event.id, id: noAddress, state: "CANCELLED" }, at(8), { sendEmail: false });
    before = await snapshot();
    expect((await failureOf(toRunner(event.id, noAddress))).code).toBe("CONFLICT");
    expect(await snapshot()).toEqual(before);

    // The person already runs on that address: the entry's own refusal, and the volunteer stands.
    await registered(event, "Radu", 10, true);
    const radu = await volunteer(event.id, roleId, "Radu Munteanu", "radu@example.ro", 15);
    before = await snapshot();
    expect((await failureOf(toRunner(event.id, radu, admin, { firstName: "Radu", lastName: "Munteanu" }))).fields).toContain(ALREADY_ON_ADDRESS);
    expect(await snapshot()).toEqual(before);
    expect((await db.select().from(eventVolunteers).where(eq(eventVolunteers.id, radu)))[0].state).toBe("CONFIRMED");

    // After the start the person registers at the desk.
    const started = await createRace(10, { startsAt: at(-60) });
    const late = await volunteer(started.event.id, started.roleId, "Ana Pop", "ana@example.ro", 20);
    before = await snapshot();
    expect((await failureOf(toRunner(started.event.id, late))).code).toBe("VOUCHED_ENTRY_AFTER_START");
    expect(await snapshot()).toEqual(before);
  });

  it("there and back: a runner turned volunteer and turned runner again is one person on each list, once", async () => {
    const { event, roleId } = await createRace(150);
    await setVolunteerNumbersStart(db, admin, { eventId: event.id, start: 500 }, at(0));
    const radu = await registered(event, "Radu", 1, true);
    const { volunteerId } = await toVolunteer(radu.id, roleId);

    const back = await turnVolunteerIntoRunner(db, admin, { eventId: event.id, volunteerId, firstName: "Radu", lastName: "Munteanu", relayedByParticipantRequest: true }, at(60));

    const rows = await db.select().from(registrations).where(eq(registrations.eventId, event.id));
    expect(rows.filter((row) => row.status !== "CANCELLED").map((row) => [row.id, row.status])).toEqual([[back.registrationId, "PENDING_DECLARATION"]]);
    expect((await volunteersOf(event.id)).map((row) => [row.state, row.bibNumber])).toEqual([["CANCELLED", 500]]);
    expect(await placesHeld(event.id)).toBe(1);
  });

  it("there and back keeps the tick the person holds now, over what the restarted registration held (§953)", async () => {
    const { event, roleId } = await createRace(150);
    const radu = await registered(event, "Radu", 1, true);
    // Out of the raffle as a runner, and so as a volunteer…
    await setRegistrationInRaffle(db, admin, radu.id, false, at(5));
    const { volunteerId } = await toVolunteer(radu.id, roleId);
    expect((await volunteersOf(event.id))[0]).toMatchObject({ id: volunteerId, inRaffle: false });
    // …put back in by the Organizer on the «Voluntari» list…
    await changeVolunteer(db, await staff("MODERATOR"), { kind: "setRaffle", eventId: event.id, id: volunteerId, inRaffle: true }, at(40));

    // …and a runner again: the entry restarts the registration cancelled before, which still said «out».
    const back = await turnVolunteerIntoRunner(db, admin, { eventId: event.id, volunteerId, firstName: "Radu", lastName: "Munteanu", relayedByParticipantRequest: true }, at(60));

    expect(back.registrationId).toBe(radu.id);
    expect((await rowOf("Radu"))).toMatchObject({ id: radu.id, status: "PENDING_DECLARATION", inRaffle: true });
    expect(await trail("registration.raffle_included")).toEqual([{ entityId: radu.id, actor: admin.id, metadata: { inRaffle: true } }]);
  });
});

describe("§984 «Transformă în …» moves the person's raffle sign-up with them", () => {
  /** «Regulamentul tombolei» approved: the version a sign-up's acceptance names. */
  async function rules(): Promise<string> {
    const text: LegalDocumentTranslationInput[] = [
      { locale: "ro", title: "Regulamentul tombolei", body: { sections: [{ paragraphs: ["Tombola."] }] } },
      { locale: "en", title: "Raffle rules", body: { sections: [{ paragraphs: ["The raffle."] }] } },
    ];
    return insertLegalDocumentVersion(db, { key: "RAFFLE_RULES", version: 1, effectiveAt: new Date("2026-01-01T00:00:00Z"), isApproved: true, contentSha256: computeContentHash(text), translations: text, now: NOW });
  }
  /** A sign-up as the public form writes one, put straight in the store: what the transform does with it is the question, not the door. */
  async function signUp(eventId: string, person: { registrationId: string } | { volunteerId: string }, rulesDocumentId: string, typedName: string) {
    const [row] = await db
      .insert(eventRaffleEntries)
      .values({ eventId, ...person, method: "FORM", rulesDocumentId, rulesAcceptedAt: at(2), rulesLocale: "ro", rulesTextHash: "a".repeat(64), rulesFacts: { event: "Crosul" }, typedName, ip: "203.0.113.7", userAgent: "Test", privacyNoticeVersion: 1, createdAt: at(2) })
      .returning();
    return row;
  }
  const entriesOf = (eventId: string) => db.select().from(eventRaffleEntries).where(eq(eventRaffleEntries.eventId, eventId));
  const signUpMode = (eventId: string) => db.update(events).set({ hasRaffle: true, raffleSignUp: true, raffleSignUpOpen: true }).where(eq(events.id, eventId));

  it("a runner turned volunteer keeps theirs — the same row, door and acceptance, now the volunteer's — and takes part as one", async () => {
    const { event, roleId } = await createRace(150);
    await signUpMode(event.id);
    await setVolunteerNumbersStart(db, admin, { eventId: event.id, start: 500 }, at(0));
    const radu = await registered(event, "Radu", 1, true);
    const entry = await signUp(event.id, { registrationId: radu.id }, await rules(), "Radu Munteanu");

    const { volunteerId } = await toVolunteer(radu.id, roleId);

    expect(await entriesOf(event.id)).toEqual([{ ...entry, registrationId: null, volunteerId }]);
    expect((await trail("registration.became_volunteer"))[0].metadata).toEqual({ volunteerId, roleId, from: "CONFIRMED", raffleEntryId: entry.id });
    const { readRaffleLine } = await import("@/modules/volunteers/raffle-roster");
    expect(await readRaffleLine(db, { table: "volunteer", id: volunteerId }, at(40))).toMatchObject({ reason: "in", signedUp: true });
    // The cancelled registration holds none: nobody is in the raffle twice.
    expect(await readRaffleLine(db, { table: "registration", id: radu.id }, at(40))).toMatchObject({ signedUp: false });
  });

  it("a volunteer turned runner keeps theirs too, on the registration the entry wrote", async () => {
    const { event, roleId } = await createRace(150);
    await signUpMode(event.id);
    const ana = await volunteer(event.id, roleId, "Ana Pop", "ana@example.ro", 1);
    const entry = await signUp(event.id, { volunteerId: ana }, await rules(), "Ana Pop");

    const result = await toRunner(event.id, ana);

    expect(await entriesOf(event.id)).toEqual([{ ...entry, volunteerId: null, registrationId: result.registrationId }]);
    expect((await trail("volunteer.became_runner"))[0].metadata).toEqual({ volunteerId: ana, registrationId: result.registrationId, to: "PENDING_DECLARATION", raffleEntryId: entry.id });
  });

  it("there and back, a restarted registration that holds a sign-up of its own keeps it, and the other stays with its cancelled row", async () => {
    const { event, roleId } = await createRace(150);
    await signUpMode(event.id);
    const rulesId = await rules();
    const radu = await registered(event, "Radu", 1, true);
    const first = await signUp(event.id, { registrationId: radu.id }, rulesId, "Radu Munteanu");
    const { volunteerId } = await toVolunteer(radu.id, roleId);
    // A sign-up on the cancelled registration meanwhile: the store holds one per person row, and this row has none since the move.
    const kept = await signUp(event.id, { registrationId: radu.id }, rulesId, "Radu Munteanu");

    const back = await turnVolunteerIntoRunner(db, admin, { eventId: event.id, volunteerId, firstName: "Radu", lastName: "Munteanu", relayedByParticipantRequest: true }, at(60));

    expect(back.registrationId).toBe(radu.id);
    const where = Object.fromEntries((await entriesOf(event.id)).map((row) => [row.id, [row.registrationId, row.volunteerId]]));
    expect(where).toEqual({ [first.id]: [null, volunteerId], [kept.id]: [radu.id, null] });
    expect((await trail("volunteer.became_runner"))[0].metadata).not.toHaveProperty("raffleEntryId");
  });

  it("moves it inside the transform's own transaction: a press refused at its last row leaves the sign-up on the registration", async () => {
    const { event, roleId } = await createRace(150);
    await signUpMode(event.id);
    const radu = await registered(event, "Radu", 1, true);
    const entry = await signUp(event.id, { registrationId: radu.id }, await rules(), "Radu Munteanu");
    await db.execute(sql`CREATE FUNCTION refuse_became_volunteer() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action = 'registration.became_volunteer' THEN RAISE EXCEPTION 'refused for the test'; END IF; RETURN NEW; END $$`);
    await db.execute(sql`CREATE TRIGGER refuse_became_volunteer BEFORE INSERT ON audit_logs FOR EACH ROW EXECUTE FUNCTION refuse_became_volunteer()`);
    try {
      await expect(toVolunteer(radu.id, roleId)).rejects.toThrow();
      expect(await entriesOf(event.id)).toEqual([entry]);
      expect(await volunteersOf(event.id)).toEqual([]);
    } finally {
      await db.execute(sql`DROP TRIGGER refuse_became_volunteer ON audit_logs`);
      await db.execute(sql`DROP FUNCTION refuse_became_volunteer()`);
    }
  });
});
