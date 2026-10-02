import { asc, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { auditLogs } from "@/db/schema/audit-logs";
import { declarationAcceptances } from "@/db/schema/declaration-acceptances";
import { emailOutbox } from "@/db/schema/email-outbox";
import { events } from "@/db/schema/events";
import { participants } from "@/db/schema/participants";
import { registrations } from "@/db/schema/registrations";
import { type StaffUser, staffUsers } from "@/db/schema/staff-users";
import type { StaffRole } from "@/modules/staff-identity/domain/roles";
import { canonicalizeEmail } from "@/modules/participants/domain/canonical-email";
import { computeContentHash, type LegalDocumentTranslationInput } from "@/modules/legal-documents/domain/content-hash";
import { insertLegalDocumentVersion } from "@/modules/legal-documents/repository";
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
 * - the values leave the trail with the row (erase) and, for the emergency contact, after the race;
 *   a corrected social's with the socials, withdrawn or swept for a minor (§322, §323);
 * - once a declaration is signed, the guardian it names is the declaration's, never corrected.
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
const { clearOptionalData } = await import("@/modules/registrations/consent-withdrawal");
const { findSignedDeclaration } = await import("@/modules/registrations/signed-declaration");

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
    // The emergency contact is somebody else (§228), refused with §231's marker so the page says which rule.
    expect(await refusal(editRegistrationAnswers(db, admin, id, { emergencyContactPhone: "+40711111111" }, NOW))).toEqual({
      code: "VALIDATION_ERROR",
      fields: ["emergencyContactPhone", "emergencySame"],
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

/** A signed declaration on the row, as the online press leaves it. */
async function sign(registrationId: string, typedName: string, minorTypedName: string | null = null): Promise<void> {
  const declaration: LegalDocumentTranslationInput[] = [
    { locale: "ro", title: "Declarație", body: { sections: [{ paragraphs: ["Particip pe proprie răspundere."] }] } },
    { locale: "en", title: "Declaration", body: { sections: [{ paragraphs: ["I take part at my own risk."] }] } },
  ];
  const legalDocumentId = await insertLegalDocumentVersion(db, {
    key: "EVENT_DECLARATION",
    version: 1,
    effectiveAt: new Date("2026-01-01T00:00:00Z"),
    isApproved: true,
    contentSha256: computeContentHash(declaration),
    translations: declaration,
    now: NOW,
  });
  await db.insert(declarationAcceptances).values({
    registrationId,
    legalDocumentId,
    declarationVersion: 1,
    contentSha256: computeContentHash(declaration),
    locale: "ro",
    typedName,
    minorTypedName,
    acceptedAt: NOW,
  });
}

describe("BR-REQ-037-03 criterion 12: a signed declaration keeps the guardian it names (§108, §330)", () => {
  it("refuses correcting or clearing the guardian of a minor CONFIRMED on a signed declaration, and the signed text still names who signed", async () => {
    const id = await seed({ birthDate: "2012-03-01", guardianName: "Maria Pop", clubMemberDeclared: false, clubName: null });
    await sign(id, "Maria Pop", "Ana Pop");
    for (const guardianName of ["Elena Pop", ""]) {
      expect(await refusal(editRegistrationAnswers(db, admin, id, { guardianName }, NOW)), guardianName).toEqual({
        code: "VALIDATION_ERROR",
        fields: ["guardianName", "guardianSigned"],
      });
    }
    expect((await rowOf(id)).guardianName).toBe("Maria Pop");
    expect((await findSignedDeclaration(db, id))?.guardianName).toBe("Maria Pop");
    expect(await corrections()).toEqual([]);
    // The row's other answers are still corrected.
    await editRegistrationAnswers(db, admin, id, { city: "Sibiu" }, NOW);
    expect((await rowOf(id)).city).toBe("Sibiu");
  });

  it("corrects the guardian while no declaration is signed", async () => {
    const id = await seed({ status: "PENDING_DECLARATION", confirmedAt: null, bibNumber: null, birthDate: "2012-03-01", guardianName: "Maria Pop", clubMemberDeclared: false, clubName: null });
    await editRegistrationAnswers(db, admin, id, { guardianName: "Elena Pop" }, NOW);
    expect((await rowOf(id)).guardianName).toBe("Elena Pop");
  });
});

describe("BR-REQ-037-03 criterion 12: a corrected social leaves the trail with the socials (§322, §323)", () => {
  it("withdrawn by the person or by staff, the corrected Strava link and username go from every correction, which field stays", async () => {
    const surfaces = [
      { via: "MANAGE_LINK" as const, name: { firstName: "Ana", registeredName: "Ana Pop", nameKey: "ana pop", bibNumber: 17 } },
      { via: "STAFF" as const, name: { firstName: "Ioana", registeredName: "Ioana Pop", nameKey: "ioana pop", displayName: "Ioana Pop", bibNumber: 18 } },
    ];
    for (const { via, name } of surfaces) {
      const id = await seed({ ...name, stravaUrl: "https://www.strava.com/athletes/12345", listSocials: true });
      await editRegistrationAnswers(db, admin, id, { stravaUrl: "https://www.strava.com/athletes/67890", instagramHandle: "ana.runs", city: "Sibiu" }, NOW);

      await clearOptionalData(db, { registrationId: id, fields: ["socials"], via, actorStaffUserId: via === "STAFF" ? admin.id : null, now: NOW });

      const left = (
        await db.select().from(auditLogs).where(eq(auditLogs.entityId, id))
      )
        .filter((row) => row.action === "registration.answer_corrected")
        .map((row) => row.metadataJson);
      expect(left, via).toContainEqual({ field: "stravaUrl" });
      expect(left, via).toContainEqual({ field: "instagramHandle" });
      expect(left, via).toContainEqual({ field: "city", from: "Brasov", to: "Sibiu" });
      expect(JSON.stringify(left), via).not.toMatch(/strava\.com|ana\.runs/);
    }
  });

  it("swept for a minor, the corrected socials go from the trail with them", async () => {
    // Registered an adult; the birth date corrected later shows the row was a minor's when written.
    const id = await seed({ createdAt: NOW });
    await editRegistrationAnswers(db, admin, id, { instagramHandle: "ana.runs" }, NOW);
    await db.update(registrations).set({ birthDate: "2012-03-01", guardianName: "Maria Pop" }).where(eq(registrations.id, id));

    await pruneExpiredRows(db, new Date(NOW.getTime() + 3_600_000));

    expect(await rowOf(id)).toMatchObject({ instagramHandle: null, listSocials: false });
    expect(await corrections()).toContainEqual({ field: "instagramHandle" });
    expect(JSON.stringify(await corrections())).not.toContain("ana.runs");
  });
});
