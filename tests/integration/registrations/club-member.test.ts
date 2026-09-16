import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { events } from "@/db/schema/events";
import { registrations } from "@/db/schema/registrations";
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
  unregister,
} from "@/modules/registrations/service";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";

/**
 * BR-REQ-031-06 — "I am a Brașov Runners team member".
 *
 * A claim the club can see, filter and export, and which grants nothing. The last part is the
 * one worth a test: the obvious next change somebody makes to this column is a member price or
 * a reserved place, and both would put a condition into the capacity path that `AGENTS.md`
 * §12.6 keeps out of it. So the assertions here are as much about what the flag does *not*
 * change as about what it stores (`DECISIONS.md` §48).
 */
const NOW = new Date("2026-09-04T10:00:00.000Z");

async function approveLegalDocuments(db: TestDatabase, now: Date) {
  const privacy: LegalDocumentTranslationInput[] = [
    { locale: "ro", title: "Confidențialitate", body: { sections: [{ paragraphs: ["p"] }] } },
    { locale: "en", title: "Privacy", body: { sections: [{ paragraphs: ["p"] }] } },
  ];
  await insertLegalDocumentVersion(db, {
    key: "PRIVACY_NOTICE",
    version: 1,
    effectiveAt: new Date("2026-01-01T00:00:00.000Z"),
    isApproved: true,
    contentSha256: computeContentHash(privacy),
    translations: privacy,
    now,
  });
}

async function createInternalEvent(
  db: TestDatabase,
  overrides: { capacity?: number | null } = {},
): Promise<EventForRegistration> {
  const [event] = await db
    .insert(events)
    .values({
      kind: "COMMUNITY_RUN",
      startsAt: new Date("2026-10-01T09:00:00.000Z"),
      registrationMode: "INTERNAL",
      capacity: overrides.capacity ?? null,
    })
    .returning();

  return {
    id: event.id,
    eventStatus: event.eventStatus,
    registrationMode: "INTERNAL",
    startsAt: event.startsAt,
    registrationOpensAt: event.registrationOpensAt,
    registrationClosesAt: event.registrationClosesAt,
    capacity: overrides.capacity ?? null,
    raceId: null,
    publishedAt: NOW,
  };
}

function submissionInput(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    firstName: "Ana",
    lastName: "Pop",
    birthDate: "1990-05-17",
    sex: "UNSPECIFIED",
    nationality: "RO",
    city: "Brașov",
    phone: "+40711111111",
    emergencyContactName: "Contact Urgență",
    emergencyContactPhone: "+40722222222",
    email: "ana@example.ro",
    locale: "ro",
    privacyAcknowledged: true,
    resultsNameConsent: true,
    listOptOut: false,
    honeypot: "",
    renderedAt: new Date(NOW.getTime() - 10_000).toISOString(),
    ...overrides,
  };
}

async function oneRegistration(db: TestDatabase, eventId: string) {
  const [row] = await db.select().from(registrations).where(eq(registrations.eventId, eventId));
  return row;
}

describe("BR-REQ-031-06 the club-member claim", () => {
  let db: TestDatabase;
  let close: () => Promise<void>;

  beforeAll(async () => {
    ({ db, close } = await createTestDatabase());
  });
  afterAll(async () => close());

  beforeEach(async () => {
    await resetTables(db);
    await approveLegalDocuments(db, NOW);
  });

  it("stores the tick as given", async () => {
    const event = await createInternalEvent(db);
    await submitRegistration(db, event, submissionInput({ clubMemberDeclared: true }), NOW);

    expect((await oneRegistration(db, event.id)).clubMemberDeclared).toBe(true);
  });

  it("is false, and never null, for somebody who never opened the optional section", async () => {
    const event = await createInternalEvent(db);
    // The field is simply absent from the input, which is what an unticked checkbox produces.
    await submitRegistration(db, event, submissionInput(), NOW);

    const row = await oneRegistration(db, event.id);
    expect(row.clubMemberDeclared).toBe(false);
    expect(row.clubMemberDeclared).not.toBeNull();
  });

  it("records the answer given now when a cancelled registration is restarted", async () => {
    const event = await createInternalEvent(db);
    await submitRegistration(db, event, submissionInput({ clubMemberDeclared: true }), NOW);
    const first = await oneRegistration(db, event.id);
    await confirmEmail(db, event, first.id, NOW);
    await unregister(db, event, first.id, "PARTICIPANT", NOW);

    // They left the club between the two entries; the row must say what they answered this
    // time, not carry a claim forward from a registration they cancelled.
    await submitRegistration(db, event, submissionInput({ clubMemberDeclared: false }), NOW);

    expect((await oneRegistration(db, event.id)).clubMemberDeclared).toBe(false);
  });

  it("grants no place: a member and a stranger meet the same full event", async () => {
    const event = await createInternalEvent(db, { capacity: 1 });

    await submitRegistration(
      db,
      event,
      submissionInput({ email: "first@example.ro", clubMemberDeclared: false }),
      NOW,
    );
    const [stranger] = await db.select().from(registrations).where(eq(registrations.eventId, event.id));
    await confirmEmail(db, event, stranger.id, NOW);

    await submitRegistration(
      db,
      event,
      submissionInput({ email: "member@example.ro", clubMemberDeclared: true }),
      NOW,
    );
    const rows = await db.select().from(registrations).where(eq(registrations.eventId, event.id));
    const member = rows.find((row) => row.id !== stranger.id);
    expect(member).toBeDefined();
    const allocated = await confirmEmail(db, event, member!.id, NOW);

    // The one place was taken. Ticking the box does not move anybody up the queue, and if this
    // test ever goes red the change that did it belongs in `DECISIONS.md`, not in the allocator.
    expect(allocated.status).toBe("WAITLISTED");
  });

  it("narrows the backoffice list to the people who said yes, and never to the rest", async () => {
    const event = await createInternalEvent(db);
    await submitRegistration(
      db,
      event,
      submissionInput({ email: "member@example.ro", clubMemberDeclared: true }),
      NOW,
    );
    await submitRegistration(
      db,
      event,
      submissionInput({ email: "other@example.ro", clubMemberDeclared: false }),
      NOW,
    );

    const all = await listRegistrationsForAdmin(db, { eventId: event.id });
    expect(all).toHaveLength(2);

    const members = await listRegistrationsForAdmin(db, {
      eventId: event.id,
      clubMemberDeclared: true,
    });
    expect(members.map((row) => row.participantEmail)).toEqual(["member@example.ro"]);

    // `false` is not a filter value: it would present "did not answer" as "not a member".
    const unfiltered = await listRegistrationsForAdmin(db, {
      eventId: event.id,
      clubMemberDeclared: false,
    });
    expect(unfiltered).toHaveLength(2);
  });
});
