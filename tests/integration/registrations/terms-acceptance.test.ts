import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { events } from "@/db/schema/events";
import { registrations } from "@/db/schema/registrations";
import { deletionObstacle, dependantObstacle } from "@/modules/legal-documents/domain/deletability";
import { computeContentHash, type LegalDocumentTranslationInput } from "@/modules/legal-documents/domain/content-hash";
import { insertLegalDocumentVersion, listVersionsForBackoffice } from "@/modules/legal-documents/repository";
import { readDeletionFacts } from "@/modules/legal-documents/service";
import { findRegistrationDetailForAdmin, listRegistrationsForAdmin } from "@/modules/registrations/admin-repository";
import { type EventForRegistration, submitRegistration } from "@/modules/registrations/service";
import { isDomainError } from "@/shared/errors/domain-error";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";

/**
 * §421 — the club's terms, accepted expressly on the form, and the record of which version
 * (BR-REQ-053-01 criterion 3; Codul civil art. 1202–1203; Codul de procedură civilă art. 249).
 *
 * Before this, the terms were a link beside the event's rules — or, on an event with its own
 * rules, not even that — and nothing recorded which version a runner agreed to. Now one tick,
 * always shown, names the version in force and the unusual clauses; the service refuses a public
 * registration without it, and without any approved terms at all; and the row keeps the version
 * and the moment, which `/admin/legal` then counts as reliance on that version.
 */
const NOW = new Date("2026-09-25T10:00:00.000Z");
const at = (minutes: number) => new Date(NOW.getTime() + minutes * 60_000);

let db: TestDatabase;
let close: () => Promise<void>;

beforeAll(async () => {
  ({ db, close } = await createTestDatabase());
});
afterAll(async () => close());
beforeEach(async () => resetTables(db));

const text: LegalDocumentTranslationInput[] = [
  { locale: "ro", title: "Text", body: { sections: [{ paragraphs: ["p"] }] } },
  { locale: "en", title: "Text", body: { sections: [{ paragraphs: ["p"] }] } },
];

async function approve(key: "TERMS" | "PRIVACY_NOTICE", version: number, effectiveAt = new Date("2026-01-01T00:00:00.000Z")) {
  await insertLegalDocumentVersion(db, { key, version, effectiveAt, isApproved: true, contentSha256: computeContentHash(text), translations: text, now: NOW });
}

async function createEvent(): Promise<EventForRegistration> {
  const [event] = await db.insert(events).values({ type: "GROUP_RUN", startsAt: new Date("2026-10-11T07:00:00.000Z"), registrationMode: "INTERNAL" }).returning();
  return { id: event.id, eventStatus: event.eventStatus, registrationMode: "INTERNAL", startsAt: event.startsAt, registrationOpensAt: null, registrationClosesAt: null, capacity: null, raceId: null, publishedAt: NOW };
}

const submission = (when: Date, overrides: Record<string, unknown> = {}) => ({
  firstName: "Ana",
  lastName: "Pop",
  birthDate: "1990-05-17",
  sex: "UNSPECIFIED",
  phone: "+40711111111",
  emergencyContactName: "Ion Vecinul",
  emergencyContactPhone: "+40722222222",
  email: "ana@example.ro",
  locale: "ro",
  privacyAcknowledged: true,
  fitnessDeclared: true,
  rulesAcknowledged: true,
  termsAccepted: true,
  resultsNameConsent: false,
  listOptOut: true,
  honeypot: "",
  renderedAt: new Date(when.getTime() - 30_000).toISOString(),
  ...overrides,
});

async function refusal(promise: Promise<unknown>) {
  try {
    await promise;
  } catch (error) {
    if (isDomainError(error)) return { code: error.code, message: error.message, fields: [...error.fields] };
    throw error;
  }
  throw new Error("expected a refusal");
}

async function onlyRow(eventId: string) {
  const rows = await db.select().from(registrations).where(eq(registrations.eventId, eventId));
  expect(rows).toHaveLength(1);
  return rows[0];
}

describe("§421 the terms tick", () => {
  it("refuses a public registration while no terms version is in force, and writes nothing", async () => {
    await approve("PRIVACY_NOTICE", 1);
    const event = await createEvent();
    const refused = await refusal(submitRegistration(db, event, submission(NOW), NOW));
    expect(refused).toMatchObject({ code: "VALIDATION_ERROR", message: "no approved terms exist yet; registration cannot be accepted" });
    expect(await db.select().from(registrations)).toHaveLength(0);
  });

  it("refuses a public form without the tick, naming it", async () => {
    await approve("PRIVACY_NOTICE", 1);
    await approve("TERMS", 1);
    const event = await createEvent();
    expect(await refusal(submitRegistration(db, event, submission(NOW, { termsAccepted: false }), NOW))).toMatchObject({
      code: "VALIDATION_ERROR",
      fields: ["termsAccepted"],
    });
  });

  /**
   * §421, finding (7) of the fix round: the version shown and the version about to be recorded
   * can differ when a new TERMS version is approved between the render and the submit. The tick
   * names a version (`termsVersionShown`, posted alongside it); a mismatch is refused rather than
   * silently recorded under a tick that never named the newer text. An absent one — an older
   * client, or nothing approved at render — is not a mismatch, and still records the current
   * version, as before this finding.
   */
  it("refuses a stale tick when the terms changed since the form was shown, and accepts a current or absent one", async () => {
    await approve("PRIVACY_NOTICE", 1);
    await approve("TERMS", 1);
    const event = await createEvent();

    expect(await refusal(submitRegistration(db, event, submission(NOW, { termsVersionShown: 2 }), NOW))).toMatchObject({
      code: "VALIDATION_ERROR",
      fields: ["termsAccepted"],
    });
    expect(await db.select().from(registrations)).toHaveLength(0);

    await submitRegistration(db, event, submission(NOW, { termsVersionShown: 1 }), NOW);
    const current = await onlyRow(event.id);
    expect(current.termsVersion).toBe(1);

    await db.delete(registrations);
    await submitRegistration(db, event, submission(at(1), { termsVersionShown: undefined }), at(1));
    const absent = await onlyRow(event.id);
    expect(absent.termsVersion).toBe(1);
  });

  it("records the version in force and the moment, and rewrites both when a cancelled registration is sent again", async () => {
    await approve("PRIVACY_NOTICE", 1);
    await approve("TERMS", 1);
    await approve("TERMS", 2);
    // Approved for a later day: not the version in force until then.
    await approve("TERMS", 3, at(60));
    const event = await createEvent();

    await submitRegistration(db, event, submission(NOW), NOW);
    const first = await onlyRow(event.id);
    expect(first.termsVersion).toBe(2);
    expect(first.termsAcceptedAt).toEqual(NOW);

    // Cancelled — the lifecycle that gets it there is proved elsewhere; what matters is the restart.
    await db.update(registrations).set({ status: "CANCELLED", cancelledAt: at(30), cancellationSource: "PARTICIPANT" }).where(eq(registrations.id, first.id));
    await submitRegistration(db, event, submission(at(90)), at(90));
    const again = await onlyRow(event.id);
    expect(again.id).toBe(first.id);
    expect(again.termsVersion).toBe(3);
    expect(again.termsAcceptedAt).toEqual(at(90));
  });

  it("records nothing for a staff entry, and does not refuse one: the paper carries the terms", async () => {
    await approve("PRIVACY_NOTICE", 1);
    const event = await createEvent();
    await submitRegistration(db, event, submission(NOW, { termsAccepted: undefined }), NOW, "REAL", { source: "STAFF", createdByStaffUserId: null });
    const row = await onlyRow(event.id);
    expect(row.termsVersion).toBeNull();
    expect(row.termsAcceptedAt).toBeNull();
  });

  /**
   * §425 — the backoffice reads what the form recorded: the registration's page draws the terms
   * line beside the privacy notice's, and the export's two columns come from the list query. A
   * staff entry reads as none on both.
   */
  it("hands the terms version and moment, and the notice's version, to the registration page and the export", async () => {
    await approve("PRIVACY_NOTICE", 1);
    await approve("TERMS", 1);
    await approve("TERMS", 2, at(-1));
    const event = await createEvent();
    await submitRegistration(db, event, submission(NOW), NOW);
    await submitRegistration(db, event, submission(at(1), { email: "ion@example.ro", firstName: "Ion", termsAccepted: undefined }), at(1), "REAL", {
      source: "STAFF",
      createdByStaffUserId: null,
    });
    const rows = await db.select().from(registrations).where(eq(registrations.eventId, event.id));
    const publicRow = rows.find((row) => row.source === "PUBLIC")!;
    const staffRow = rows.find((row) => row.source === "STAFF")!;

    const detail = await findRegistrationDetailForAdmin(db, publicRow.id);
    expect(detail).toMatchObject({ privacyNoticeVersion: 1, termsVersion: 2, termsAcceptedAt: NOW, cycleStartedAt: NOW });
    expect(await findRegistrationDetailForAdmin(db, staffRow.id)).toMatchObject({ privacyNoticeVersion: 1, termsVersion: null, termsAcceptedAt: null });

    const listed = new Map((await listRegistrationsForAdmin(db, { eventId: event.id })).map((row) => [row.id, row]));
    expect(listed.get(publicRow.id)).toMatchObject({ termsVersion: 2, termsAcceptedAt: NOW });
    expect(listed.get(staffRow.id)).toMatchObject({ termsVersion: null, termsAcceptedAt: null });
  });

  it("makes a terms version somebody accepted relied on: refused withdrawal and deletion, like a notice", async () => {
    await approve("PRIVACY_NOTICE", 1);
    await approve("TERMS", 1);
    await approve("TERMS", 2, at(-1));
    const event = await createEvent();
    await submitRegistration(db, event, submission(NOW), NOW);

    const versions = await listVersionsForBackoffice(db);
    const terms = versions.filter((row) => row.key === "TERMS");
    const byVersion = new Map(terms.map((row) => [row.version, row]));
    expect(byVersion.get(2)?.privacyAcknowledgementCount).toBe(1);
    expect(byVersion.get(1)?.privacyAcknowledgementCount).toBe(0);
    // Matched per key: the notice's own count is the notice's, never the terms'.
    expect(versions.find((row) => row.key === "PRIVACY_NOTICE")?.privacyAcknowledgementCount).toBe(1);

    const [facts] = await readDeletionFacts(db, [byVersion.get(2)!], versions, at(5));
    expect(dependantObstacle(facts)).toMatchObject({ kind: "referenced", acknowledgements: 1 });
    expect(deletionObstacle(facts)).toMatchObject({ kind: "referenced" });
  });
});
