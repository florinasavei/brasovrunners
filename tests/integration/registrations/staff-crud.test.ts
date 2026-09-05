import { asc, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { auditLogs } from "@/db/schema/audit-logs";
import { emailOutbox } from "@/db/schema/email-outbox";
import { events } from "@/db/schema/events";
import { participants } from "@/db/schema/participants";
import { registrations } from "@/db/schema/registrations";
import { type StaffUser, staffUsers } from "@/db/schema/staff-users";
import {
  computeContentHash,
  type LegalDocumentTranslationInput,
} from "@/modules/legal-documents/domain/content-hash";
import { insertLegalDocumentVersion } from "@/modules/legal-documents/repository";
import {
  cancelRegistrationByStaff,
  correctRegisteredName,
  createRegistrationByStaff,
} from "@/modules/registrations/admin-service";
import {
  confirmEmail,
  type EventForRegistration,
  submitRegistration,
} from "@/modules/registrations/service";
import { isDomainError } from "@/shared/errors/domain-error";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";

/**
 * BR-REQ-037-05 — an Administrator enters a registration for somebody who asked in person.
 * BR-REQ-037-03 — administrative corrections are bounded, and audited.
 * BR-REQ-034-03 — a staff-entered registration does not jump the queue.
 *
 * The property that matters most is the third one, and it is the first test below: this feature
 * exists so the club can register the person standing in front of them, and it must be
 * impossible for that to be worth more than registering online. Everything else here is about
 * what staff may change afterwards — a name, and nothing else — and about the trail that says
 * they did.
 */
const NOW = new Date("2026-09-05T10:00:00.000Z");

let db: TestDatabase;
let close: () => Promise<void>;
let admin: StaffUser;
let editor: StaffUser;

beforeAll(async () => {
  ({ db, close } = await createTestDatabase());
});
afterAll(async () => {
  await close();
});

beforeEach(async () => {
  await resetTables(db);

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
      now: NOW,
    });
  }

  [admin] = await db
    .insert(staffUsers)
    .values({ email: "admin@dev.test", displayName: "Admin", role: "ADMIN" })
    .returning();
  [editor] = await db
    .insert(staffUsers)
    .values({ email: "editor@dev.test", displayName: "Editor", role: "EDITOR" })
    .returning();
});

async function createInternalEvent(capacity: number | null): Promise<EventForRegistration> {
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

/** A public registration, taken as far as the participant's own email confirmation. */
async function registerPublicly(event: EventForRegistration, email: string, at: Date = NOW) {
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
      renderedAt: new Date(at.getTime() - 10_000).toISOString(),
    },
    at,
  );

  const [participant] = await db
    .select()
    .from(participants)
    .where(eq(participants.canonicalEmail, email.toLowerCase()));
  const [registration] = await db
    .select()
    .from(registrations)
    .where(eq(registrations.participantId, participant.id));

  return confirmEmail(db, event, registration.id, at);
}

async function addByStaff(
  event: EventForRegistration,
  email: string,
  at: Date = NOW,
  actor: StaffUser = admin,
) {
  await createRegistrationByStaff(
    db,
    actor,
    {
      eventId: event.id,
      name: `Desk ${email}`,
      email,
      locale: "ro",
      listOptOut: false,
      relayedByParticipantRequest: true,
    },
    at,
  );

  const [participant] = await db
    .select()
    .from(participants)
    .where(eq(participants.canonicalEmail, email.toLowerCase()));
  const [registration] = await db
    .select()
    .from(registrations)
    .where(eq(registrations.participantId, participant.id));
  return registration;
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

describe("BR-REQ-037-05 a registration entered by staff", () => {
  it("starts where a public one starts, and records who entered it", async () => {
    const event = await createInternalEvent(10);
    const registration = await addByStaff(event, "desk@example.org");

    // Not confirmed, not holding a place by fiat: the same first state as the public form.
    expect(registration.status).toBe("PENDING_EMAIL_CONFIRMATION");
    expect(registration.source).toBe("STAFF");
    expect(registration.createdByStaffUserId).toBe(admin.id);
    expect(registration.kind).toBe("REAL");

    // And the participant is asked to confirm, by the ordinary message.
    const queued = await db
      .select()
      .from(emailOutbox)
      .where(eq(emailOutbox.registrationId, registration.id));
    expect(queued.map((row) => row.messageType)).toContain("VERIFY_REGISTRATION_EMAIL");
  });

  it("cannot confirm anybody: the declaration is still the participant's to sign", async () => {
    const event = await createInternalEvent(10);
    const registration = await addByStaff(event, "desk@example.org");

    // The only thing that reaches CONFIRMED is `signDeclaration`, from the participant's own
    // link. Nothing in the admin service touches that transition (AGENTS.md §10.8).
    expect(registration.confirmedAt).toBeNull();
    expect(registration.status).not.toBe("CONFIRMED");
  });

  it("does not jump the queue: it lands behind everyone already waiting", async () => {
    const event = await createInternalEvent(1);
    // One place, taken by a hold; two people waiting behind it.
    await registerPublicly(event, "first@example.org", NOW);
    const second = await registerPublicly(event, "second@example.org", new Date(NOW.getTime() + 1_000));
    expect(second.status).toBe("WAITLISTED");

    const staffEntered = await addByStaff(event, "desk@example.org", new Date(NOW.getTime() + 2_000));
    const allocated = await confirmEmail(db, event, staffEntered.id, new Date(NOW.getTime() + 3_000));

    expect(allocated.status).toBe("WAITLISTED");

    // FIFO by `waitlisted_at`: the person who registered online first is still in front.
    const queue = await db
      .select({ id: registrations.id, name: registrations.registeredName })
      .from(registrations)
      .where(eq(registrations.status, "WAITLISTED"))
      .orderBy(asc(registrations.waitlistedAt), asc(registrations.id));
    expect(queue[0].id).toBe(second.id);
    expect(queue[1].id).toBe(staffEntered.id);
  });

  it("is refused without the relay confirmation", async () => {
    const event = await createInternalEvent(10);

    const code = await codeOf(
      createRegistrationByStaff(
        db,
        admin,
        {
          eventId: event.id,
          name: "Nobody Asked",
          email: "invented@example.org",
          locale: "ro",
          listOptOut: false,
          relayedByParticipantRequest: false,
        },
        NOW,
      ),
    );

    expect(code).toBe("VALIDATION_ERROR");
    expect(await db.select().from(registrations)).toHaveLength(0);
  });

  it("tells an Administrator plainly when the person is already registered", async () => {
    // The public form answers a duplicate with the same generic success it gives everybody
    // (BR-REQ-031-01 criterion 3). Here the answer goes to somebody who can read the list
    // anyway, and silence would leave them typing it again.
    const event = await createInternalEvent(10);
    await addByStaff(event, "desk@example.org");

    const code = await codeOf(
      createRegistrationByStaff(
        db,
        admin,
        {
          eventId: event.id,
          name: "Desk Again",
          email: "desk@example.org",
          locale: "ro",
          listOptOut: false,
          relayedByParticipantRequest: true,
        },
        NOW,
      ),
    );

    expect(code).toBe("VALIDATION_ERROR");
  });

  it("is refused to an Editor", async () => {
    const event = await createInternalEvent(10);

    const code = await codeOf(
      createRegistrationByStaff(
        db,
        editor,
        {
          eventId: event.id,
          name: "Desk",
          email: "desk@example.org",
          locale: "ro",
          listOptOut: false,
          relayedByParticipantRequest: true,
        },
        NOW,
      ),
    );

    expect(code).toBe("FORBIDDEN");
  });

  it("writes an audit row naming the organizer", async () => {
    const event = await createInternalEvent(10);
    const registration = await addByStaff(event, "desk@example.org");

    const [entry] = await db
      .select()
      .from(auditLogs)
      .where(eq(auditLogs.entityId, registration.id));

    expect(entry.action).toBe("registration.created_by_staff");
    expect(entry.actorStaffUserId).toBe(admin.id);
    expect(entry.entityType).toBe("registration");
  });
});

describe("BR-REQ-037-03 corrections are bounded and audited", () => {
  it("corrects the name and records what it was", async () => {
    const event = await createInternalEvent(10);
    const registration = await addByStaff(event, "desk@example.org");

    const updated = await correctRegisteredName(db, admin, registration.id, "  Ana Popescu  ", NOW);
    expect(updated.registeredName).toBe("Ana Popescu");

    const trail = await db
      .select()
      .from(auditLogs)
      .where(eq(auditLogs.action, "registration.name_corrected"));
    expect(trail).toHaveLength(1);
    expect(trail[0].metadataJson).toMatchObject({
      from: registration.registeredName,
      to: "Ana Popescu",
    });
  });

  it("refuses an empty name", async () => {
    const event = await createInternalEvent(10);
    const registration = await addByStaff(event, "desk@example.org");

    expect(await codeOf(correctRegisteredName(db, admin, registration.id, "   ", NOW))).toBe(
      "VALIDATION_ERROR",
    );
  });

  it("refuses an Editor", async () => {
    const event = await createInternalEvent(10);
    const registration = await addByStaff(event, "desk@example.org");

    expect(await codeOf(correctRegisteredName(db, editor, registration.id, "Ana", NOW))).toBe(
      "FORBIDDEN",
    );
  });
});

describe("BR-REQ-037-03 cancelling on the club's behalf", () => {
  it("releases the place to the front of the waiting list, and audits the reason", async () => {
    const event = await createInternalEvent(1);
    const holder = await registerPublicly(event, "holder@example.org", NOW);
    expect(holder.status).toBe("PENDING_DECLARATION");

    const waiting = await registerPublicly(event, "waiting@example.org", new Date(NOW.getTime() + 1_000));
    expect(waiting.status).toBe("WAITLISTED");

    const cancelled = await cancelRegistrationByStaff(
      db,
      admin,
      holder.id,
      "asked us at the club night",
      new Date(NOW.getTime() + 2_000),
    );

    expect(cancelled.status).toBe("CANCELLED");
    // §15.5 and §15.6: the released place is offered to the queue, not left free for a newcomer.
    expect(cancelled.cancellationSource).toBe("ADMIN");
    const [promoted] = await db
      .select()
      .from(registrations)
      .where(eq(registrations.id, waiting.id));
    expect(promoted.status).toBe("WAITLIST_OFFERED");

    const [entry] = await db
      .select()
      .from(auditLogs)
      .where(eq(auditLogs.action, "registration.cancelled_by_staff"));
    expect(entry.actorStaffUserId).toBe(admin.id);
    expect(entry.metadataJson).toMatchObject({ reason: "asked us at the club night" });
  });

  it("never deletes the row", async () => {
    // A registration records what somebody agreed to and when. "Remove them" means cancelled.
    const event = await createInternalEvent(10);
    const holder = await registerPublicly(event, "holder@example.org", NOW);

    await cancelRegistrationByStaff(db, admin, holder.id, "duplicate", NOW);

    const rows = await db.select().from(registrations).where(eq(registrations.id, holder.id));
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe("CANCELLED");
  });

  it("refuses a registration whose address was never confirmed, and says why", async () => {
    /**
     * AGENTS.md §10.5 has no edge from PENDING_EMAIL_CONFIRMATION to CANCELLED, and this feature
     * does not add one: such a row holds no place and lapses after 48 hours on its own. What is
     * asserted here is that the refusal is a sentence an organizer can act on rather than the
     * bare CONFLICT the guarded UPDATE would otherwise produce.
     */
    const event = await createInternalEvent(10);
    const registration = await addByStaff(event, "desk@example.org");

    expect(
      await codeOf(cancelRegistrationByStaff(db, admin, registration.id, "typo", NOW)),
    ).toBe("VALIDATION_ERROR");
  });

  it("refuses an Editor", async () => {
    const event = await createInternalEvent(10);
    const holder = await registerPublicly(event, "holder@example.org", NOW);

    // The role is asserted before the state, so an Editor is refused for the role rather than
    // being told which registrations happen to be cancellable.
    expect(await codeOf(cancelRegistrationByStaff(db, editor, holder.id, "no", NOW))).toBe(
      "FORBIDDEN",
    );
  });
});
