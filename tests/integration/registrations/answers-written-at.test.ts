import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { events } from "@/db/schema/events";
import { registrations } from "@/db/schema/registrations";
import { type StaffUser, staffUsers } from "@/db/schema/staff-users";
import { pruneExpiredRows } from "@/modules/jobs/retention";
import { computeContentHash, type LegalDocumentTranslationInput } from "@/modules/legal-documents/domain/content-hash";
import { insertLegalDocumentVersion } from "@/modules/legal-documents/repository";
import { answersWrittenAt } from "@/modules/registrations/answers";
import {
  confirmEmail,
  editRegistrationAnswersByStaff,
  type EventForRegistration,
  submitRegistration,
  unregister,
} from "@/modules/registrations/service";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";

/**
 * BR-REQ-033-04 (§NNN) — "the day the row was written" is the day its answers were written.
 *
 * A restart of a cancelled or expired row writes every answer again at its own instant, judged on that
 * instant — a guardian kept only for a minor today, no socials for one — and keeps `created_at` (`AGENTS.md` §10.5).
 * The rules that ask whether the person was a minor when the row was written read `answers_written_at`:
 * the minors' sweep (§323) and the staff correction's guardian and socials rules (§645). Before the
 * column they read `created_at`, so a row created at seventeen and restarted as an adult had its
 * socials swept and its birth date's correction refused for a guardian the restart never kept.
 */
// Eighteen on 2026-09-15.
const BIRTH_DATE = "2008-09-15";
const FIRST = new Date("2026-09-01T10:00:00.000Z");
const RESTART = new Date("2026-10-02T10:00:00.000Z");
const RACE_DAY = new Date("2026-11-21T08:00:00.000Z");

async function approveLegalDocuments(db: TestDatabase, now: Date) {
  const privacy: LegalDocumentTranslationInput[] = [
    { locale: "ro", title: "Confidențialitate", body: { sections: [{ paragraphs: ["p"] }] } },
    { locale: "en", title: "Privacy", body: { sections: [{ paragraphs: ["p"] }] } },
  ];
  for (const key of ["PRIVACY_NOTICE", "TERMS"] as const) {
    await insertLegalDocumentVersion(db, {
      key,
      version: 1,
      effectiveAt: new Date("2026-01-01T00:00:00.000Z"),
      isApproved: true,
      contentSha256: computeContentHash(privacy),
      translations: privacy,
      now,
    });
  }
}

function submissionInput(now: Date, overrides: Partial<Record<string, unknown>> = {}) {
  return {
    firstName: "Ana",
    lastName: "Pop",
    birthDate: BIRTH_DATE,
    sex: "FEMALE",
    nationality: "RO",
    country: "RO",
    city: "Brașov",
    phone: "+40711111111",
    emergencyContactName: "Contact Urgență",
    emergencyContactPhone: "+40722222222",
    guardianName: "Maria Pop",
    stravaUrl: "https://www.strava.com/athletes/123",
    instagramHandle: "ana.pop",
    email: "ana@example.ro",
    locale: "ro",
    privacyAcknowledged: true,
    fitnessDeclared: true,
    termsAccepted: true,
    rulesAcknowledged: true,
    resultsNameConsent: true,
    listOptOut: false,
    honeypot: "",
    renderedAt: new Date(now.getTime() - 10_000).toISOString(),
    ...overrides,
  };
}

describe("BR-REQ-033-04: a restart rewrites the instant the answers were written (§NNN)", () => {
  let db: TestDatabase;
  let close: () => Promise<void>;
  let event: EventForRegistration;
  let admin: StaffUser;

  beforeAll(async () => {
    ({ db, close } = await createTestDatabase());
  });
  afterAll(async () => close());

  beforeEach(async () => {
    await resetTables(db);
    await approveLegalDocuments(db, FIRST);
    const [row] = await db.insert(events).values({ type: "GROUP_RUN", startsAt: RACE_DAY, registrationMode: "INTERNAL", capacity: null }).returning();
    event = {
      id: row.id,
      eventStatus: row.eventStatus,
      registrationMode: "INTERNAL",
      startsAt: row.startsAt,
      registrationOpensAt: row.registrationOpensAt,
      registrationClosesAt: row.registrationClosesAt,
      capacity: null,
      raceId: null,
      publishedAt: FIRST,
    };
    [admin] = await db.insert(staffUsers).values({ email: "admin@dev.test", displayName: "Admin", role: "ADMIN" }).returning();
  });

  async function onlyRow() {
    const [row] = await db.select().from(registrations).where(eq(registrations.eventId, event.id));
    return row;
  }

  it("a first submission writes it on its own instant, beside created_at", async () => {
    await submitRegistration(db, event, submissionInput(FIRST), FIRST);
    const row = await onlyRow();
    expect(row.answersWrittenAt).toEqual(FIRST);
    expect(row.createdAt).toEqual(FIRST);
    // A minor on that day: the guardian kept, no socials (§108, §323).
    expect(row).toMatchObject({ guardianName: "Maria Pop", stravaUrl: null, instagramHandle: null });
  });

  it("a verified participant's restart after the eighteenth birthday moves it and keeps created_at; the sweep keeps the socials and a correction owes no guardian", async () => {
    await submitRegistration(db, event, submissionInput(FIRST), FIRST);
    const first = await onlyRow();
    await confirmEmail(db, event, first.id, FIRST);
    await unregister(db, event, first.id, "PARTICIPANT", FIRST);

    await submitRegistration(db, event, submissionInput(RESTART), RESTART);
    const restarted = await onlyRow();
    expect(restarted.id).toBe(first.id);
    expect(restarted.status).not.toBe("CANCELLED");
    expect(restarted.createdAt).toEqual(FIRST);
    expect(restarted.answersWrittenAt).toEqual(RESTART);
    expect(answersWrittenAt(restarted)).toEqual(RESTART);
    // An adult on the restart's day: no guardian kept, the socials kept.
    expect(restarted).toMatchObject({ guardianName: null, stravaUrl: "https://www.strava.com/athletes/123", instagramHandle: "ana.pop" });

    // The minors' sweep judges the restart's day: an adult's socials stay.
    const counts = await pruneExpiredRows(db, RESTART);
    expect(counts.failures).toEqual([]);
    expect(counts.minorSocials).toBe(0);
    expect(await onlyRow()).toMatchObject({ stravaUrl: "https://www.strava.com/athletes/123", instagramHandle: "ana.pop" });

    // A birth date corrected by a day is still an adult's on the restart's day: no guardian owed (§645).
    const { corrected } = await editRegistrationAnswersByStaff(db, admin, restarted.id, { birthDate: "2008-09-14" }, RESTART);
    expect(corrected).toEqual(["birthDate"]);
    // The correction judges against the instant; it does not move it.
    expect(await onlyRow()).toMatchObject({ birthDate: "2008-09-14", guardianName: null, answersWrittenAt: RESTART, createdAt: FIRST });
  });

  it("an unverified participant's restart moves it too", async () => {
    await submitRegistration(db, event, submissionInput(FIRST), FIRST);
    const first = await onlyRow();
    // Never confirmed, so the address is unverified; the row lapsed as the job lapses it.
    await db.update(registrations).set({ status: "EXPIRED" }).where(eq(registrations.id, first.id));

    await submitRegistration(db, event, submissionInput(RESTART), RESTART);
    const restarted = await onlyRow();
    expect(restarted).toMatchObject({ id: first.id, status: "PENDING_EMAIL_CONFIRMATION", createdAt: FIRST, answersWrittenAt: RESTART, guardianName: null });
  });

  it("a row written before the column is judged on its creation, as before", async () => {
    await submitRegistration(db, event, submissionInput(FIRST), FIRST);
    const row = await onlyRow();
    await db.update(registrations).set({ answersWrittenAt: null }).where(eq(registrations.id, row.id));
    const [before] = await db.select().from(registrations).where(eq(registrations.id, row.id));
    expect(answersWrittenAt(before)).toEqual(FIRST);
    // A minor when created: a correction of an adult today still owes the guardian it was written with.
    await expect(editRegistrationAnswersByStaff(db, admin, row.id, { guardianName: "" }, RESTART)).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });
});
