import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { auditLogs } from "@/db/schema/audit-logs";
import { emailOutbox } from "@/db/schema/email-outbox";
import { events } from "@/db/schema/events";
import { participants } from "@/db/schema/participants";
import { registrations } from "@/db/schema/registrations";
import {
  computeContentHash,
  type LegalDocumentTranslationInput,
} from "@/modules/legal-documents/domain/content-hash";
import { insertLegalDocumentVersion } from "@/modules/legal-documents/repository";
import {
  listRegistrationsForAdmin,
  listResubmissionMarks,
  summariseRegistrationsForAdmin,
} from "@/modules/registrations/admin-repository";
import {
  confirmEmail,
  type EventForRegistration,
  submitRegistration,
  unregister,
} from "@/modules/registrations/service";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";

/**
 * §312 — the form filled a second time with the same address, as the *club* sees it.
 *
 * Amalia registered with her browser's autofill twice. She was told in the re-sent message that
 * she already was (§235); the club was told nothing, so "she says she registered but I cannot
 * find anything" had no answer on a screen. Every pass through the second-submission branch now
 * leaves one audit row on the registration it found — the state and the message type re-sent,
 * nothing personal — and the list reads those rows in one grouped query.
 *
 * What must not change is what the visitor sees: the public answer is the same whether the
 * address was new or already registered (§19.4, BR-REQ-031-01 criterion 3).
 */
const NOW = new Date("2026-09-20T10:00:00.000Z");
const minutes = (n: number) => new Date(NOW.getTime() + n * 60_000);

let db: TestDatabase;
let close: () => Promise<void>;

beforeAll(async () => {
  ({ db, close } = await createTestDatabase());
});
afterAll(async () => close());

beforeEach(async () => {
  await resetTables(db);
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
    now: NOW,
  });
  await insertLegalDocumentVersion(db, {
    key: "TERMS",
    version: 1,
    effectiveAt: new Date("2026-01-01T00:00:00.000Z"),
    isApproved: true,
    contentSha256: computeContentHash(privacy),
    translations: privacy,
    now: NOW,
  });
});

async function createInternalEvent(capacity: number | null = null): Promise<EventForRegistration> {
  const [event] = await db
    .insert(events)
    .values({
      type: "RACE",
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
    registrationOpensAt: event.registrationOpensAt,
    registrationClosesAt: event.registrationClosesAt,
    capacity,
    raceId: null,
    publishedAt: NOW,
  };
}

const submission = (at: Date, email = "amalia.pop@example.ro", firstName = "Amalia", lastName = "Popescu") => ({
  firstName,
  lastName,
  birthDate: "1990-05-17",
  sex: "UNSPECIFIED",
  nationality: "RO",
  city: "Brașov",
  phone: "+40711111111",
  emergencyContactName: "Contact Urgență",
  emergencyContactPhone: "+40722222222",
  email,
  locale: "ro",
  privacyAcknowledged: true,
  fitnessDeclared: true,
  termsAccepted: true,
  rulesAcknowledged: true,
  resultsNameConsent: false,
  listOptOut: false,
  honeypot: "",
  renderedAt: new Date(at.getTime() - 30_000).toISOString(),
});

const resubmittedRows = () =>
  db.select().from(auditLogs).where(eq(auditLogs.action, "registration.resubmitted"));

describe("§312 a second submission is recorded for the club", () => {
  it("writes exactly one row, naming the state it found and the message it re-sent", async () => {
    const event = await createInternalEvent();
    await submitRegistration(db, event, submission(NOW), NOW);
    await submitRegistration(db, event, submission(minutes(5)), minutes(5));

    const [registration] = await db.select().from(registrations);
    const [participant] = await db.select().from(participants);
    const rows = await resubmittedRows();

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      entityType: "registration",
      entityId: registration.id,
      participantId: participant.id,
      // Nobody at the club did anything; the person did.
      actorStaffUserId: null,
      createdAt: minutes(5),
    });
    // Still waiting for the email link — the state that answers "she says she registered".
    expect(rows[0].metadataJson).toEqual({ status: "PENDING_EMAIL_CONFIRMATION", resent: "VERIFY_REGISTRATION_EMAIL" });
  });

  it("puts nothing personal in the metadata (§12.12)", async () => {
    const event = await createInternalEvent();
    await submitRegistration(db, event, submission(NOW), NOW);
    // A different spelling of the name the second time: it is recorded nowhere.
    await submitRegistration(db, event, submission(minutes(5), "amalia.pop@example.ro", "Amalía", "Pop"), minutes(5));

    const [row] = await resubmittedRows();
    const serialized = JSON.stringify(row.metadataJson).toLowerCase();
    for (const personal of ["amalia", "amalía", "popescu", "pop@", "example.ro", "+4071", "brașov", "1990"]) {
      expect(serialized).not.toContain(personal);
    }
    expect(Object.keys(row.metadataJson as object).sort()).toEqual(["resent", "status"]);
    // And the registration keeps the name it has.
    const [registration] = await db.select().from(registrations);
    expect(registration.registeredName).toBe("Amalia Popescu");
  });

  it("names the declaration once the address is confirmed", async () => {
    const event = await createInternalEvent();
    await submitRegistration(db, event, submission(NOW), NOW);
    const [registration] = await db.select().from(registrations);
    await confirmEmail(db, event, registration.id, minutes(1));

    await submitRegistration(db, event, submission(minutes(10)), minutes(10));

    const rows = await resubmittedRows();
    expect(rows).toHaveLength(1);
    expect(rows[0].metadataJson).toEqual({ status: "PENDING_DECLARATION", resent: "COMPLETE_DECLARATION" });
  });

  it("names the waiting-list notice for somebody queued for a place", async () => {
    const event = await createInternalEvent(1);
    // Somebody else holds the one place.
    await submitRegistration(db, event, submission(NOW, "first@example.ro", "Ion", "Ionescu"), NOW);
    const [first] = await db.select().from(registrations);
    await confirmEmail(db, event, first.id, minutes(1));

    await submitRegistration(db, event, submission(minutes(2)), minutes(2));
    const amalia = (await db.select().from(registrations)).find((row) => row.id !== first.id)!;
    const queued = await confirmEmail(db, event, amalia.id, minutes(3));
    expect(queued.status).toBe("WAITLISTED");

    await submitRegistration(db, event, submission(minutes(20)), minutes(20));

    const rows = await resubmittedRows();
    expect(rows).toHaveLength(1);
    expect(rows[0].entityId).toBe(amalia.id);
    expect(rows[0].metadataJson).toEqual({ status: "WAITLISTED", resent: "WAITLIST_JOINED" });
  });

  it("records null when nothing new went out, and never claims a message that was not queued", async () => {
    /*
      Two presses inside the same millisecond: the re-send's idempotency key is the one the
      first submission already used, so the outbox queues nothing — and the record says so
      rather than naming a message that does not exist. The row is still written: the attempt
      happened, which is what the club is asking about.
    */
    const event = await createInternalEvent();
    await submitRegistration(db, event, submission(NOW), NOW);
    await submitRegistration(db, event, submission(NOW), NOW);

    expect(await db.select().from(emailOutbox)).toHaveLength(1);
    const rows = await resubmittedRows();
    expect(rows).toHaveLength(1);
    expect(rows[0].metadataJson).toEqual({ status: "PENDING_EMAIL_CONFIRMATION", resent: null });
  });

  it("writes one row per attempt, bounded by the form's own throttle and no other", async () => {
    const event = await createInternalEvent();
    await submitRegistration(db, event, submission(NOW), NOW);
    for (const at of [1, 2, 3, 4]) await submitRegistration(db, event, submission(minutes(at)), minutes(at));
    expect(await resubmittedRows()).toHaveLength(4);

    // The sixth in the hour is refused by the per-identity bucket (§19.4) before it reaches the
    // branch, so the trail grows no faster than the inbox it mirrors.
    await expect(submitRegistration(db, event, submission(minutes(5)), minutes(5))).rejects.toMatchObject({
      fields: ["throttled"],
    });
    expect(await resubmittedRows()).toHaveLength(4);
  });
});

describe("§312 what is not a second submission writes nothing", () => {
  it("a new registration writes no such row", async () => {
    const event = await createInternalEvent();
    await submitRegistration(db, event, submission(NOW), NOW);

    expect(await resubmittedRows()).toHaveLength(0);
    expect(await db.select().from(auditLogs)).toHaveLength(0);
  });

  it("a restart after a cancellation writes no such row", async () => {
    // Cancelled is not "already registered": the form starts that registration again (§10.5).
    const event = await createInternalEvent();
    await submitRegistration(db, event, submission(NOW), NOW);
    const [registration] = await db.select().from(registrations);
    await confirmEmail(db, event, registration.id, minutes(1));
    await unregister(db, event, registration.id, "PARTICIPANT", minutes(2));

    await submitRegistration(db, event, submission(minutes(10)), minutes(10));

    expect(await resubmittedRows()).toHaveLength(0);
  });
});

describe("§312 the public answer is the same either way (§19.4)", () => {
  it("returns exactly what a first submission returns", async () => {
    const event = await createInternalEvent();
    const first = await submitRegistration(db, event, submission(NOW), NOW);
    const second = await submitRegistration(db, event, submission(minutes(5)), minutes(5));
    const stranger = await submitRegistration(db, event, submission(minutes(6), "someone.else@example.ro", "Ion", "Ionescu"), minutes(6));

    expect(second).toEqual(first);
    expect(second).toEqual(stranger);
    expect(second).toEqual({ ok: true });
  });
});

describe("§312 the list's marker, in one grouped query", () => {
  it("returns how many times and when last, for the rows asked about", async () => {
    const event = await createInternalEvent();
    await submitRegistration(db, event, submission(NOW), NOW);
    await submitRegistration(db, event, submission(minutes(1)), minutes(1));
    await submitRegistration(db, event, submission(minutes(7)), minutes(7));
    await submitRegistration(db, event, submission(minutes(8), "once@example.ro", "Ion", "Ionescu"), minutes(8));

    const rows = await listRegistrationsForAdmin(db, { eventId: event.id });
    expect(rows).toHaveLength(2);
    const marks = await listResubmissionMarks(db, rows.map((row) => row.id));

    const amalia = rows.find((row) => row.registeredName === "Amalia Popescu")!;
    const ion = rows.find((row) => row.registeredName === "Ion Ionescu")!;
    expect(marks.get(amalia.id)).toEqual({ count: 2, lastAt: minutes(7) });
    expect(marks.has(ion.id)).toBe(false);
    expect(marks.size).toBe(1);
  });

  it("reads only the rows it is given", async () => {
    const event = await createInternalEvent();
    await submitRegistration(db, event, submission(NOW), NOW);
    await submitRegistration(db, event, submission(minutes(1)), minutes(1));
    await submitRegistration(db, event, submission(minutes(2), "once@example.ro", "Ion", "Ionescu"), minutes(2));

    const [ion] = await listRegistrationsForAdmin(db, { search: "ionescu" });
    expect((await listResubmissionMarks(db, [ion.id])).size).toBe(0);
    expect((await listResubmissionMarks(db, [])).size).toBe(0);
  });

  it("counts people, not attempts, in the summary the club is given", async () => {
    const event = await createInternalEvent();
    await submitRegistration(db, event, submission(NOW), NOW);
    await submitRegistration(db, event, submission(minutes(1)), minutes(1));
    await submitRegistration(db, event, submission(minutes(2)), minutes(2));

    const summary = await summariseRegistrationsForAdmin(db, { eventId: event.id });
    expect(summary.real).toBe(1);
    expect(summary.byStatus).toEqual({ PENDING_EMAIL_CONFIRMATION: 1 });
  });
});
