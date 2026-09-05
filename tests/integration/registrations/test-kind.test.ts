import { asc, eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { events } from "@/db/schema/events";
import { participants } from "@/db/schema/participants";
import { type RegistrationKind, registrations } from "@/db/schema/registrations";
import { type StaffUser, staffUsers } from "@/db/schema/staff-users";
import {
  computeContentHash,
  type LegalDocumentTranslationInput,
} from "@/modules/legal-documents/domain/content-hash";
import { insertLegalDocumentVersion } from "@/modules/legal-documents/repository";
import { listRegistrationsForAdmin } from "@/modules/registrations/admin-repository";
import {
  confirmEmail,
  type EventForRegistration,
  submitRegistration,
} from "@/modules/registrations/service";
import {
  addTestRegistrations,
  removeTestRegistrations,
  TEST_PARTICIPANT_EMAIL_DOMAIN,
} from "@/modules/registrations/test-registrations";
import { isDomainError } from "@/shared/errors/domain-error";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";

/**
 * `registrations.kind` — a demonstration queue that behaves exactly like a real one
 * (`DECISIONS.md` §30).
 *
 * The property that gives the whole feature its point is the first test below: `kind` must not
 * appear in any condition inside the allocator or the capacity formula, so the same scenario run
 * as TEST and as REAL produces identical transitions. Everything else — the production guard,
 * the reserved domain, the export, the removal — is what keeps a demonstration from being
 * mistaken for people.
 */
const NOW = new Date("2026-09-04T10:00:00.000Z");

async function approveLegalDocuments(db: TestDatabase, now: Date) {
  const body = { sections: [{ paragraphs: ["p"] }] };
  const pair: LegalDocumentTranslationInput[] = [
    { locale: "ro", title: "Document", body },
    { locale: "en", title: "Document", body },
  ];
  for (const key of ["PRIVACY_NOTICE", "EVENT_DECLARATION"] as const) {
    await insertLegalDocumentVersion(db, {
      key,
      version: 1,
      effectiveAt: new Date("2026-01-01T00:00:00.000Z"),
      isApproved: true,
      contentSha256: computeContentHash(pair),
      translations: pair,
      now,
    });
  }
}

async function createInternalEvent(
  db: TestDatabase,
  capacity: number | null,
): Promise<EventForRegistration> {
  const [event] = await db
    .insert(events)
    .values({
      kind: "COMMUNITY_RUN",
      startsAt: new Date("2026-10-01T09:00:00.000Z"),
      registrationMode: "INTERNAL",
      capacity,
    })
    .returning();

  return {
    id: event.id,
    eventStatus: event.eventStatus,
    registrationMode: "INTERNAL",
    startsAt: event.startsAt,
    registrationOpensAt: null,
    registrationClosesAt: null,
    capacity,
    raceId: null,
    publishedAt: NOW,
  };
}

/** One participant registers and confirms their address, at whichever kind. */
async function registerAndConfirm(
  db: TestDatabase,
  event: EventForRegistration,
  email: string,
  kind: RegistrationKind,
) {
  await submitRegistration(
    db,
    event,
    {
      name: `Runner ${email}`,
      email,
      locale: "ro",
      privacyAcknowledged: true,
      resultsNameConsent: false,
      listOptOut: false,
      honeypot: "",
      renderedAt: new Date(NOW.getTime() - 10_000).toISOString(),
    },
    NOW,
    kind,
  );

  const [participant] = await db
    .select()
    .from(participants)
    .where(eq(participants.deliveryEmail, email));
  const [registration] = await db
    .select()
    .from(registrations)
    .where(eq(registrations.participantId, participant.id));

  return confirmEmail(db, event, registration.id, NOW);
}

describe("registrations.kind — a test registration is a real one to the queue", () => {
  let db: TestDatabase;
  let close: () => Promise<void>;
  let admin: StaffUser;
  let editor: StaffUser;

  beforeAll(async () => {
    ({ db, close } = await createTestDatabase());
  });
  afterAll(async () => close());

  beforeEach(async () => {
    await resetTables(db);
    await approveLegalDocuments(db, NOW);
    [admin] = await db
      .insert(staffUsers)
      .values({ email: "admin@dev.test", displayName: "Admin", role: "ADMIN" })
      .returning();
    [editor] = await db
      .insert(staffUsers)
      .values({ email: "editor@dev.test", displayName: "Editor", role: "EDITOR" })
      .returning();
  });

  async function codeOf(operation: Promise<unknown>): Promise<string> {
    try {
      await operation;
      return "no error";
    } catch (error) {
      if (isDomainError(error)) return error.code;
      throw error;
    }
  }

  /**
   * The whole point, stated as a test: run the same scenario twice, once as TEST and once as
   * REAL, and compare the transitions. Two places, three registrants — the third is waitlisted,
   * whichever kind they are.
   */
  it("produces identical transitions for TEST and for REAL", async () => {
    async function runScenario(kind: RegistrationKind): Promise<string[]> {
      await resetTables(db);
      await approveLegalDocuments(db, NOW);
      const event = await createInternalEvent(db, 2);

      for (const index of [1, 2, 3]) {
        await registerAndConfirm(db, event, `runner-${index}@example.test`, kind);
      }

      const rows = await db
        .select({ status: registrations.status })
        .from(registrations)
        .where(eq(registrations.eventId, event.id))
        .orderBy(asc(registrations.submittedAt), asc(registrations.id));
      return rows.map((row) => row.status);
    }

    const asTest = await runScenario("TEST");
    const asReal = await runScenario("REAL");

    expect(asTest.filter((status) => status === "PENDING_DECLARATION")).toHaveLength(2);
    expect(asTest.filter((status) => status === "WAITLISTED")).toHaveLength(1);
    expect(asTest.sort()).toEqual(asReal.sort());
  });

  it("occupies a place, so a real registrant behind a test one is waitlisted", async () => {
    const event = await createInternalEvent(db, 1);

    await registerAndConfirm(db, event, `demo-1@${TEST_PARTICIPANT_EMAIL_DOMAIN}`, "TEST");
    const real = await registerAndConfirm(db, event, "ana@example.test", "REAL");

    expect(real.status).toBe("WAITLISTED");
  });

  describe("the backoffice tool", () => {
    it("pushes N synthetic participants through submission and confirmation", async () => {
      const event = await createInternalEvent(db, 2);

      const result = await addTestRegistrations(db, admin, { eventId: event.id, count: 3 });
      expect(result.created).toBe(3);

      const rows = await db
        .select()
        .from(registrations)
        .where(eq(registrations.eventId, event.id));

      expect(rows).toHaveLength(3);
      expect(rows.every((row) => row.kind === "TEST")).toBe(true);
      // Confirmed their addresses, so the queue filled: two holds and one waiting entry.
      expect(rows.filter((row) => row.status === "PENDING_DECLARATION")).toHaveLength(2);
      expect(rows.filter((row) => row.status === "WAITLISTED")).toHaveLength(1);
    });

    it("gives every synthetic participant a distinct address in the reserved domain", async () => {
      const event = await createInternalEvent(db, null);
      await addTestRegistrations(db, admin, { eventId: event.id, count: 4 });

      const rows = await db.select().from(participants);
      expect(rows).toHaveLength(4);
      for (const row of rows) {
        expect(row.deliveryEmail.endsWith(`@${TEST_PARTICIPANT_EMAIL_DOMAIN}`)).toBe(true);
      }
      // Distinct local parts, not tags on one address: `canonicalizeEmail` collapses those for
      // Gmail (BR-REQ-032-02), and one participant registered four times is one row.
      expect(new Set(rows.map((row) => row.canonicalEmail)).size).toBe(4);
    });

    it("refuses an Editor: registrations are the Administrator's (§10.2)", async () => {
      const event = await createInternalEvent(db, null);
      expect(
        await codeOf(addTestRegistrations(db, editor, { eventId: event.id, count: 1 })),
      ).toBe("FORBIDDEN");
    });

    it("refuses a batch that is not a sensible number", async () => {
      const event = await createInternalEvent(db, null);
      for (const count of [0, -1, 999]) {
        expect(
          await codeOf(addTestRegistrations(db, admin, { eventId: event.id, count })),
          String(count),
        ).toBe("VALIDATION_ERROR");
      }
    });
  });

  describe("removal leaves everything real standing", () => {
    it("deletes the test rows and their participants, and nothing else", async () => {
      const event = await createInternalEvent(db, null);

      const real = await registerAndConfirm(db, event, "ana@example.test", "REAL");
      await addTestRegistrations(db, admin, { eventId: event.id, count: 3 });

      const removed = await removeTestRegistrations(db, admin, event.id);
      expect(removed.registrationsRemoved).toBe(3);
      expect(removed.participantsRemoved).toBe(3);

      const remaining = await db
        .select()
        .from(registrations)
        .where(eq(registrations.eventId, event.id));
      expect(remaining.map((row) => row.id)).toEqual([real.id]);

      const people = await db.select().from(participants);
      expect(people.map((row) => row.deliveryEmail)).toEqual(["ana@example.test"]);
    });

    it("is repeatable: removing twice is not an error", async () => {
      const event = await createInternalEvent(db, null);
      await addTestRegistrations(db, admin, { eventId: event.id, count: 2 });

      await removeTestRegistrations(db, admin, event.id);
      const second = await removeTestRegistrations(db, admin, event.id);

      expect(second).toEqual({ registrationsRemoved: 0, participantsRemoved: 0 });
    });

    it("refuses an Editor", async () => {
      const event = await createInternalEvent(db, null);
      expect(await codeOf(removeTestRegistrations(db, editor, event.id))).toBe("FORBIDDEN");
    });
  });

  /**
   * `DECISIONS.md` §30: the export omits `TEST` rows rather than labelling them. A label
   * survives inside this application; an export is a file that leaves it, and a column somebody
   * filtered away an hour ago is not a warning.
   */
  describe("what the club counts", () => {
    it("omits test rows from the export and keeps them in the backoffice list", async () => {
      const event = await createInternalEvent(db, null);
      await registerAndConfirm(db, event, "ana@example.test", "REAL");
      await addTestRegistrations(db, admin, { eventId: event.id, count: 2 });

      const exported = await listRegistrationsForAdmin(db, { excludeTest: true });
      expect(exported).toHaveLength(1);
      expect(exported[0].participantEmail).toBe("ana@example.test");

      const listed = await listRegistrationsForAdmin(db, {});
      expect(listed).toHaveLength(3);
      // And every one of them carries the label the screens render.
      expect(listed.filter((row) => row.kind === "TEST")).toHaveLength(2);
    });
  });
});

/**
 * The production guard, twice. `APP_ENV` is read at module load by `shared/config/env.ts`, so
 * the modules under test are re-imported with the environment set — a mutated `process.env`
 * alone would change nothing.
 */
describe("a test registration cannot exist in production", () => {
  const originalAppEnv = process.env.APP_ENV;

  afterEach(() => {
    process.env.APP_ENV = originalAppEnv;
    vi.resetModules();
  });

  it("is refused at the feature's own entrance", async () => {
    process.env.APP_ENV = "production";
    vi.resetModules();
    const { assertTestRegistrationsEnabled, areTestRegistrationsAvailable } = await import(
      "@/modules/registrations/test-registrations"
    );

    expect(areTestRegistrationsAvailable()).toBe(false);
    expect(() => assertTestRegistrationsEnabled()).toThrow(/not available/);
  });

  it("is refused again at the only statement that can write such a row", async () => {
    process.env.APP_ENV = "production";
    vi.resetModules();
    const { insertPendingEmailRegistration } = await import("@/modules/registrations/repository");
    const { createTestDatabase: create } = await import("../../helpers/db");
    const { db, close } = await create();

    try {
      await expect(
        insertPendingEmailRegistration(db, {
          eventId: "00000000-0000-0000-0000-000000000000",
          participantId: "00000000-0000-0000-0000-000000000000",
          kind: "TEST",
          locale: "ro",
          registeredName: "Runner",
          privacyNoticeVersion: 1,
          privacyAcknowledgedAt: NOW,
          raceId: null,
          resultsNameConsent: false,
          listOptOut: false,
          resultsConsentVersion: 1,
          now: NOW,
        }),
        // Refused before the insert is attempted, so the missing foreign keys never matter.
      ).rejects.toThrow(/cannot be created in production/);
    } finally {
      await close();
    }
  });

  it("permits it everywhere else, where nobody has entered a real race", async () => {
    for (const APP_ENV of ["local", "test", "qa"]) {
      process.env.APP_ENV = APP_ENV;
      vi.resetModules();
      const { areTestRegistrationsAvailable } = await import(
        "@/modules/registrations/test-registrations"
      );
      expect(areTestRegistrationsAvailable(), APP_ENV).toBe(true);
    }
  });
});
