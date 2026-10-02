import { asc, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { auditLogs } from "@/db/schema/audit-logs";
import { emailOutbox } from "@/db/schema/email-outbox";
import { events } from "@/db/schema/events";
import { participants } from "@/db/schema/participants";
import { registrations } from "@/db/schema/registrations";
import { type StaffUser, staffUsers } from "@/db/schema/staff-users";
import type { StaffRole } from "@/modules/staff-identity/domain/roles";
import { canonicalizeEmail } from "@/modules/participants/domain/canonical-email";
import { CLUB_NAME } from "@/theme/brand";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";

/**
 * BR-REQ-037-03 criterion 12 (§NNN) — «Modifică datele»: an Administrator corrects or overwrites any
 * answer the person typed.
 *
 * The owner, 2026-10-02: «Nu vreau să se numească „curăță”, dar practic vreau să pot modifica sau
 * suprascrie orice dată introdusă de utilizator.» What these hold:
 * - only the changed columns are written, each with its own audit row `{ field, from, to }`, the name
 *   of record with §67's `registration.name_corrected`; no state, no place, no number, no email;
 * - the allowlist is the typed answers: the address, the consents, the declaration's statements, the
 *   state and the number are refused by name; an empty change and a change that changes nothing too;
 * - each value meets the form's own rule, and the form's cross-field rules hold on the row as it would be;
 * - the Administrator's alone; any status; a TEST row like a real one; an erased row NOT_FOUND;
 * - the person's own page reads the corrected answers;
 * - the values leave the trail with the row (erase) and, for the emergency contact, after the race.
 */
const NOW = new Date("2026-10-02T10:00:00.000Z");
const RACE_DAY = new Date("2026-11-21T08:00:00.000Z");

let db: TestDatabase;
let close: () => Promise<void>;

vi.mock("@/db/client", () => ({ getDb: () => db }));

const { issueActionToken } = await import("@/modules/action-tokens/repository");
const { deleteRegistrationByStaff, editRegistrationAnswers } = await import("@/modules/registrations/admin-service");
const { editRegistrationAnswersByStaff } = await import("@/modules/registrations/service");
const { readRaceDayContext } = await import("@/modules/registrations/token-actions");
const { pruneExpiredRows } = await import("@/modules/jobs/retention");
const { isDomainError } = await import("@/shared/errors/domain-error");

let participantId: string;
let eventId: string;
let admin: StaffUser;

beforeAll(async () => {
  ({ db, close } = await createTestDatabase());
});
afterAll(async () => close());

async function staff(role: StaffRole): Promise<StaffUser> {
  const [user] = await db.insert(staffUsers).values({ email: `${role.toLowerCase()}@dev.test`, displayName: role, role }).returning();
  return user;
}

beforeEach(async () => {
  await resetTables(db);
  const identity = canonicalizeEmail("ana.pop@example.org");
  const [participant] = await db
    .insert(participants)
    .values({
      deliveryEmail: identity.deliveryEmail,
      normalizedEmail: identity.normalizedEmail,
      canonicalEmail: identity.canonicalEmail,
      canonicalizationVersion: identity.canonicalizationVersion,
      defaultName: "Ana Pop",
    })
    .returning();
  participantId = participant.id;
  const [event] = await db.insert(events).values({ type: "RACE", startsAt: RACE_DAY, registrationMode: "INTERNAL", capacity: 10 }).returning();
  eventId = event.id;
  admin = await staff("ADMIN");
});

/** A confirmed registration holding a place and a number, as the public form left it. */
async function seed(row: Partial<typeof registrations.$inferInsert> = {}): Promise<string> {
  const [created] = await db
    .insert(registrations)
    .values({
      eventId,
      participantId,
      status: "CONFIRMED",
      kind: "REAL",
      locale: "ro",
      firstName: "Ana",
      lastName: "Pop",
      registeredName: "Ana Pop",
      nameKey: "ana pop",
      displayName: "Ana Pop",
      birthDate: "1990-05-01",
      sex: "FEMALE",
      nationality: "RO",
      country: "RO",
      city: "Brasov",
      phone: "+40711111111",
      emergencyContactName: "Ion Pop",
      emergencyContactPhone: "+40722222222",
      clubMemberDeclared: true,
      clubName: CLUB_NAME,
      privacyNoticeVersion: 1,
      privacyAcknowledgedAt: NOW,
      resultsNameConsent: false,
      resultsConsentVersion: 1,
      listOptOut: false,
      confirmedAt: NOW,
      bibNumber: 17,
      ...row,
    })
    .returning({ id: registrations.id });
  return created.id;
}

async function rowOf(id: string) {
  const [row] = await db.select().from(registrations).where(eq(registrations.id, id));
  return row;
}

async function refusal(operation: Promise<unknown>): Promise<{ code: string; fields: string[] }> {
  try {
    await operation;
  } catch (error) {
    if (isDomainError(error)) return { code: error.code, fields: [...error.fields] };
    throw error;
  }
  throw new Error("expected a refusal");
}

const corrections = async () =>
  (await db.select().from(auditLogs).where(eq(auditLogs.action, "registration.answer_corrected")).orderBy(asc(auditLogs.createdAt))).map(
    (row) => row.metadataJson,
  );

describe("BR-REQ-037-03 criterion 12: «Modifică datele» writes only what changed, and audits each", () => {
  it("corrects several answers in one press, one audit row each, and moves no state, place, number or email", async () => {
    const id = await seed();
    const before = await rowOf(id);

    const { corrected } = await editRegistrationAnswers(
      db,
      admin,
      id,
      { city: "Brașov", phone: "0733 333 333", birthDate: "1991-05-01", instagramHandle: "@ana.runs", nationality: "md" },
      NOW,
    );

    const after = await rowOf(id);
    expect(after).toMatchObject({ city: "Brașov", phone: "+40733333333", birthDate: "1991-05-01", instagramHandle: "ana.runs", nationality: "MD" });
    expect(after).toMatchObject({ status: before.status, bibNumber: 17, registeredName: "Ana Pop", clubMemberDeclared: true, listOptOut: false });
    expect(await db.select().from(emailOutbox)).toHaveLength(0);
    expect(corrected.sort()).toEqual(["birthDate", "city", "instagramHandle", "nationality", "phone"]);
    expect(await corrections()).toEqual(
      expect.arrayContaining([
        { field: "city", from: "Brasov", to: "Brașov" },
        { field: "phone", from: "+40711111111", to: "+40733333333" },
        { field: "instagramHandle", from: null, to: "ana.runs" },
      ]),
    );
    const [audit] = await db.select().from(auditLogs).where(eq(auditLogs.action, "registration.answer_corrected")).limit(1);
    expect(audit).toMatchObject({ actorStaffUserId: admin.id, participantId, entityType: "registration", entityId: id });
  });

  it("composes the name of record from the two names, with §67's audit row, and the derived list name follows it", async () => {
    const id = await seed();
    await editRegistrationAnswers(db, admin, id, { lastName: "Popescu" }, NOW);
    expect(await rowOf(id)).toMatchObject({ lastName: "Popescu", registeredName: "Ana Popescu", nameKey: "ana popescu", displayName: "Ana Popescu" });
    const [renamed] = await db.select().from(auditLogs).where(eq(auditLogs.action, "registration.name_corrected"));
    expect(renamed.metadataJson).toEqual({ from: "Ana Pop", to: "Ana Popescu" });

    // A list name the person chose is theirs and stays.
    const chosen = await seed({ registeredName: "Ion Pop", nameKey: "ion pop", firstName: "Ion", displayName: "Ionuț", bibNumber: 18 });
    await editRegistrationAnswers(db, admin, chosen, { firstName: "Ioan" }, NOW);
    expect(await rowOf(chosen)).toMatchObject({ registeredName: "Ioan Pop", displayName: "Ionuț" });
  });

  it("clears an optional answer with an empty value, and refuses to empty a required one", async () => {
    const id = await seed({ stravaUrl: "https://www.strava.com/athletes/12345", listSocials: true });
    await editRegistrationAnswers(db, admin, id, { stravaUrl: "" }, NOW);
    // The socials-on-the-list tick goes with the last social: a tick about nothing.
    expect(await rowOf(id)).toMatchObject({ stravaUrl: null, listSocials: false });
    expect(await corrections()).toContainEqual({ field: "listSocials", from: true, to: false });

    expect(await refusal(editRegistrationAnswers(db, admin, id, { firstName: "  " }, NOW))).toEqual({ code: "VALIDATION_ERROR", fields: ["firstName"] });
    expect(await refusal(editRegistrationAnswers(db, admin, id, { country: "" }, NOW))).toEqual({ code: "VALIDATION_ERROR", fields: ["country"] });
  });

  it("meets each answer with the form's own rule, naming every invalid field", async () => {
    const id = await seed();
    expect(await refusal(editRegistrationAnswers(db, admin, id, { phone: "asdasd", stravaUrl: "https://example.org/me", sex: "UNSPECIFIED" }, NOW))).toEqual({
      code: "VALIDATION_ERROR",
      fields: ["phone", "stravaUrl", "sex"],
    });
    // The emergency contact is somebody else (§228).
    expect(await refusal(editRegistrationAnswers(db, admin, id, { emergencyContactPhone: "+40711111111" }, NOW))).toEqual({
      code: "VALIDATION_ERROR",
      fields: ["emergencyContactPhone"],
    });
    expect(await db.select().from(auditLogs)).toHaveLength(0);
  });

  it("keeps the form's rules for a minor: a guardian, no socials, and the event's minimum age", async () => {
    const id = await seed({ instagramHandle: "ana.pop" });
    // Sixteen on the race day: a minor, so a guardian is owed and the socials must go first.
    expect((await refusal(editRegistrationAnswers(db, admin, id, { birthDate: "2010-01-01" }, NOW))).fields).toEqual(["guardianName"]);
    expect((await refusal(editRegistrationAnswers(db, admin, id, { birthDate: "2010-01-01", guardianName: "Ion Pop" }, NOW))).fields).toEqual(["instagramHandle"]);
    await editRegistrationAnswers(db, admin, id, { birthDate: "2010-01-01", guardianName: "Ion Pop", instagramHandle: "" }, NOW);
    expect(await rowOf(id)).toMatchObject({ birthDate: "2010-01-01", guardianName: "Ion Pop", instagramHandle: null });
    // Under the event's fourteen on the race day.
    expect((await refusal(editRegistrationAnswers(db, admin, id, { birthDate: "2015-01-01" }, NOW))).fields).toContain("birthDate");
  });

  it("carries the member tick with the club, as the form does (§215)", async () => {
    const id = await seed();
    await editRegistrationAnswers(db, admin, id, { clubMemberDeclared: false }, NOW);
    expect(await rowOf(id)).toMatchObject({ clubMemberDeclared: false, clubName: null });
    // A club typed while the tick goes back on is refused: the tick is the club.
    expect((await refusal(editRegistrationAnswers(db, admin, id, { clubMemberDeclared: true, clubName: "CS Alt Club" }, NOW))).fields).toEqual(["clubName"]);
    await editRegistrationAnswers(db, admin, id, { clubName: "CS Alt Club" }, NOW);
    expect(await rowOf(id)).toMatchObject({ clubMemberDeclared: false, clubName: "CS Alt Club" });
  });
});

describe("BR-REQ-037-03 criterion 12: what stays the person's, and who may correct", () => {
  it("refuses the address, the consents, the declaration's statements and what is not an answer, naming the key", async () => {
    const id = await seed();
    for (const key of ["email", "promoConsent", "listOptOut", "healthNotes", "fitnessDeclared", "termsAccepted", "status", "bibNumber", "kind", "outsideCapacity", "locale"]) {
      expect(await refusal(editRegistrationAnswers(db, admin, id, { [key]: "x" } as never, NOW)), key).toEqual({ code: "VALIDATION_ERROR", fields: [key] });
    }
    expect(await db.select().from(auditLogs)).toHaveLength(0);
  });

  it("refuses an empty change and a change that changes nothing, writing nothing", async () => {
    const id = await seed();
    expect((await refusal(editRegistrationAnswers(db, admin, id, {}, NOW))).code).toBe("VALIDATION_ERROR");
    expect((await refusal(editRegistrationAnswers(db, admin, id, { city: " Brasov ", clubMemberDeclared: true }, NOW))).code).toBe("VALIDATION_ERROR");
    expect(await db.select().from(auditLogs)).toHaveLength(0);
  });

  it("is the Administrator's: the Organizer and the volunteer are refused by the wrapper and by the service", async () => {
    const id = await seed();
    for (const role of ["MODERATOR", "CONTRIBUTOR"] as const) {
      const actor = await staff(role);
      expect((await refusal(editRegistrationAnswers(db, actor, id, { city: "Sibiu" }, NOW))).code, role).toBe("FORBIDDEN");
      expect((await refusal(editRegistrationAnswersByStaff(db, actor, id, { city: "Sibiu" }, NOW))).code, role).toBe("FORBIDDEN");
    }
    expect((await rowOf(id)).city).toBe("Brasov");
  });

  it("corrects any status and a TEST row alike; an erased row is NOT_FOUND", async () => {
    const cancelled = await seed({ status: "CANCELLED", cancelledAt: NOW, cancellationSource: "ADMIN", bibNumber: null });
    await editRegistrationAnswers(db, admin, cancelled, { city: "Sibiu" }, NOW);
    expect(await rowOf(cancelled)).toMatchObject({ city: "Sibiu", status: "CANCELLED" });

    const test = await seed({ kind: "TEST", registeredName: "Test Pop", nameKey: "test pop", firstName: "Test", bibNumber: 18 });
    await editRegistrationAnswers(db, admin, test, { city: "Sibiu" }, NOW);
    expect((await rowOf(test)).city).toBe("Sibiu");

    await deleteRegistrationByStaff(db, admin, cancelled, "asked to be erased", NOW);
    expect((await refusal(editRegistrationAnswers(db, admin, cancelled, { city: "Cluj" }, NOW))).code).toBe("NOT_FOUND");
  });
});

describe("BR-REQ-037-03 criterion 12: the person sees the corrected answers; the values leave the trail with the data", () => {
  it("the manage page reads the corrected name", async () => {
    const id = await seed();
    await editRegistrationAnswers(db, admin, id, { firstName: "Ana Maria" }, NOW);
    const secret = (await issueActionToken(db, { participantId, registrationId: id, purpose: "MANAGE_REGISTRATION", expiresAt: RACE_DAY, now: NOW })).secret;
    const context = await readRaceDayContext(secret, NOW);
    expect(context.ok).toBe(true);
    if (context.ok) {
      expect(context.registration.registeredName).toBe("Ana Maria Pop");
      expect(context.people.map((person) => person.registeredName)).toEqual(["Ana Maria Pop"]);
    }
  });

  it("erasing the registration takes both values off every correction, and keeps which field", async () => {
    const id = await seed({ status: "CANCELLED", cancelledAt: NOW, cancellationSource: "ADMIN", bibNumber: null });
    await editRegistrationAnswers(db, admin, id, { city: "Sibiu", firstName: "Ioana" }, NOW);
    await deleteRegistrationByStaff(db, admin, id, "asked to be erased", NOW);
    const left = await corrections();
    expect(left).toEqual(expect.arrayContaining([{ field: "city" }, { field: "firstName" }]));
    expect(JSON.stringify(left)).not.toContain("Sibiu");
  });

  it("seven days after the event the emergency contact's corrected values go, the other corrections stay", async () => {
    const id = await seed();
    await editRegistrationAnswers(db, admin, id, { emergencyContactPhone: "+40733333333", city: "Sibiu" }, NOW);
    await pruneExpiredRows(db, new Date(RACE_DAY.getTime() + 8 * 24 * 3_600_000));
    const left = await corrections();
    expect(left).toContainEqual({ field: "emergencyContactPhone" });
    expect(left).toContainEqual({ field: "city", from: "Brasov", to: "Sibiu" });
  });
});
