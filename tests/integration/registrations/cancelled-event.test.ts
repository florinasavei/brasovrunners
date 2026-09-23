import { and, eq, isNotNull } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { type EmailMessageType, emailOutbox } from "@/db/schema/email-outbox";
import { events } from "@/db/schema/events";
import { registrations } from "@/db/schema/registrations";
import { type StaffUser, staffUsers } from "@/db/schema/staff-users";
import { computeContentHash, type LegalDocumentTranslationInput } from "@/modules/legal-documents/domain/content-hash";
import { insertLegalDocumentVersion } from "@/modules/legal-documents/repository";
import { sendEventThanks } from "@/modules/notifications/event-mail";
import { resendRegistrationMessage, setBibNumberByStaff } from "@/modules/registrations/admin-service";
import { runRegistrationMaintenance } from "@/modules/registrations/maintenance";
import { listActiveRegistrationsForParticipant } from "@/modules/registrations/my-registrations";
import {
  checkIn,
  confirmByStaff,
  confirmEmail,
  type EventForRegistration,
  promoteFromWaitlistByStaff,
  requestRegistrationLink,
  signDeclaration,
  submitRegistration,
  unregister,
} from "@/modules/registrations/service";
import { isDomainError } from "@/shared/errors/domain-error";
import { signingInput } from "../../helpers/declaration-signing";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";

/**
 * `DECISIONS.md` §NNN — a cancelled event allocates nothing and mails nothing on its own.
 *
 * Before this, cancelling a race in the editor emailed nobody, and then went on behaving as if
 * the race would run: a place freed by a cancellation was offered to the waiting list, an
 * address confirmed afterwards was given a place and "sign the declaration", the close numbered
 * everybody and sent `BIB_ASSIGNED`. Each entry point now reads the event's status under the
 * lock. The registrations themselves are left as they were — the record of who had entered.
 */
const NOW = new Date("2026-09-21T09:00:00.000Z");
const STARTS_AT = new Date("2026-09-26T07:00:00.000Z");
const CLOSES_AT = new Date("2026-09-25T07:00:00.000Z");
const AFTER_CLOSE = new Date("2026-09-25T08:00:00.000Z");

async function approve(db: TestDatabase, key: "PRIVACY_NOTICE" | "EVENT_DECLARATION") {
  const translations: LegalDocumentTranslationInput[] = [
    { locale: "ro", title: key, body: { sections: [{ paragraphs: ["p"] }] } },
    { locale: "en", title: key, body: { sections: [{ paragraphs: ["p"] }] } },
  ];
  await insertLegalDocumentVersion(db, {
    key,
    version: 1,
    effectiveAt: new Date("2026-01-01T00:00:00.000Z"),
    isApproved: true,
    contentSha256: computeContentHash(translations),
    translations,
    now: NOW,
  });
}

function submissionInput(email: string, at: Date) {
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
    email,
    locale: "ro",
    privacyAcknowledged: true,
    fitnessDeclared: true,
    rulesAcknowledged: true,
    resultsNameConsent: true,
    listOptOut: false,
    honeypot: "",
    renderedAt: new Date(at.getTime() - 10_000).toISOString(),
  };
}

describe("§NNN a cancelled event allocates nothing and mails nothing on its own", () => {
  let db: TestDatabase;
  let close: () => Promise<void>;
  let admin: StaffUser;

  beforeAll(async () => {
    ({ db, close } = await createTestDatabase());
  });
  afterAll(async () => close());

  beforeEach(async () => {
    await resetTables(db);
    await approve(db, "PRIVACY_NOTICE");
    await approve(db, "EVENT_DECLARATION");
    [admin] = await db.insert(staffUsers).values({ email: "admin@dev.test", displayName: "Admin", role: "ADMIN" }).returning();
  });

  async function createEvent(capacity: number | null = 1): Promise<EventForRegistration> {
    const [event] = await db
      .insert(events)
      .values({
        type: "RACE",
        startsAt: STARTS_AT,
        registrationMode: "INTERNAL",
        capacity,
        registrationClosesAt: CLOSES_AT,
        bibStartNumber: 1,
      })
      .returning();
    return {
      id: event.id,
      eventStatus: event.eventStatus,
      registrationMode: "INTERNAL",
      startsAt: event.startsAt,
      registrationOpensAt: null,
      registrationClosesAt: event.registrationClosesAt,
      capacity,
      raceId: null,
      publishedAt: NOW,
    };
  }

  /** Through the form; with `verify`, the email link too — a place or the waiting list. */
  async function enter(event: EventForRegistration, email: string, verify = true) {
    const known = new Set((await db.select({ id: registrations.id }).from(registrations)).map((row) => row.id));
    await submitRegistration(db, event, submissionInput(email, NOW), NOW);
    const created = (await db.select().from(registrations).where(eq(registrations.eventId, event.id))).find((row) => !known.has(row.id))!;
    return verify ? confirmEmail(db, event, created.id, NOW) : created;
  }

  const cancel = (event: EventForRegistration) => db.update(events).set({ eventStatus: "CANCELLED" }).where(eq(events.id, event.id));
  const statusOf = async (id: string) => (await db.select().from(registrations).where(eq(registrations.id, id)))[0];
  const queuedOf = async (messageType: EmailMessageType) =>
    (await db.select().from(emailOutbox).where(and(eq(emailOutbox.messageType, messageType), isNotNull(emailOutbox.participantId)))).length;
  const allQueued = async () => (await db.select().from(emailOutbox)).length;

  async function codeOf(attempt: Promise<unknown>) {
    try {
      await attempt;
      return undefined;
    } catch (caught) {
      if (isDomainError(caught)) return caught.code;
      throw caught;
    }
  }

  it("a place freed on a cancelled event is offered to nobody", async () => {
    const event = await createEvent(1);
    const ana = await enter(event, "ana@example.test");
    await signDeclaration(db, event, ana.id, await signingInput(db, NOW, "Ana Pop"), NOW);
    const bogdan = await enter(event, "bogdan@example.test");
    expect(bogdan.status).toBe("WAITLISTED");
    await cancel(event);

    // Ana withdraws on her own: she is told, as always — and Bogdan is offered nothing.
    await unregister(db, { ...event, eventStatus: "CANCELLED" }, ana.id, "PARTICIPANT", new Date(NOW.getTime() + 60_000));
    expect((await statusOf(bogdan.id)).status).toBe("WAITLISTED");
    expect(await queuedOf("WAITLIST_SPOT_OFFER")).toBe(0);
    expect(await queuedOf("REGISTRATION_CANCELLED")).toBe(1);
  });

  it("an address confirmed after the cancellation is given no place and sent no declaration", async () => {
    const event = await createEvent(10);
    const pending = await enter(event, "late@example.test", false);
    expect(pending.status).toBe("PENDING_EMAIL_CONFIRMATION");
    await cancel(event);
    const before = await allQueued();

    const confirmed = await confirmEmail(db, event, pending.id, new Date(NOW.getTime() + 60_000));
    expect(confirmed.status).toBe("PENDING_EMAIL_CONFIRMATION");
    const row = await statusOf(pending.id);
    expect(row.status).toBe("PENDING_EMAIL_CONFIRMATION");
    // The address was not marked verified, and the number held since submission (§214) is untouched.
    expect(row.emailConfirmedAt).toBeNull();
    expect(row.provisionalBibNumber).toBe(pending.provisionalBibNumber);
    expect(await allQueued()).toBe(before);
    expect(await queuedOf("COMPLETE_DECLARATION")).toBe(0);
  });

  it("the close settles no number and mails none on a cancelled event, and the job leaves its queue alone", async () => {
    const event = await createEvent(1);
    const ana = await enter(event, "ana@example.test");
    expect(ana.status).toBe("PENDING_DECLARATION");
    const bogdan = await enter(event, "bogdan@example.test");
    expect(bogdan.status).toBe("WAITLISTED");
    await cancel(event);
    const before = await allQueued();

    const run = await runRegistrationMaintenance(db, AFTER_CLOSE);
    expect(run.bibsSettled).toBe(0);
    expect(run.eventsProcessed).toBe(0);
    expect(await queuedOf("BIB_ASSIGNED")).toBe(0);
    expect(await allQueued()).toBe(before);
    const [row] = await db.select().from(events).where(eq(events.id, event.id));
    expect(row.bibsSettledAt).toBeNull();
    expect((await statusOf(ana.id)).bibNumber).toBeNull();
    // Nobody's registration moved: the lapsed hold and the waiting list are as they were.
    expect((await statusOf(ana.id)).status).toBe("PENDING_DECLARATION");
    expect((await statusOf(bogdan.id)).status).toBe("WAITLISTED");
  });

  it("the desk and the backoffice cannot give a place, check in, resend a link, mail a number or thank anybody", async () => {
    const event = await createEvent(2);
    const ana = await enter(event, "ana@example.test");
    await signDeclaration(db, event, ana.id, await signingInput(db, NOW, "Ana Pop"), NOW);
    const bogdan = await enter(event, "bogdan@example.test");
    expect(bogdan.status).toBe("PENDING_DECLARATION");
    const carmen = await enter(event, "carmen@example.test");
    expect(carmen.status).toBe("WAITLISTED");
    await cancel(event);
    const cancelled = { ...event, eventStatus: "CANCELLED" as const };
    const later = new Date(NOW.getTime() + 60_000);
    const before = await allQueued();

    expect(await codeOf(confirmByStaff(db, cancelled, bogdan.id, admin, later))).toBe("VALIDATION_ERROR");
    expect(await codeOf(promoteFromWaitlistByStaff(db, cancelled, carmen.id, admin, later))).toBe("VALIDATION_ERROR");
    expect(await codeOf(checkIn(db, ana.id, admin, later))).toBe("VALIDATION_ERROR");
    expect(await codeOf(resendRegistrationMessage(db, admin, ana.id, later))).toBe("VALIDATION_ERROR");
    expect(await codeOf(resendRegistrationMessage(db, admin, bogdan.id, later))).toBe("VALIDATION_ERROR");
    expect(await allQueued()).toBe(before);

    // A number typed by hand is written — the desk may still want it — and mailed to nobody.
    const numbered = await setBibNumberByStaff(db, admin, ana.id, 7, later);
    expect(numbered.bibNumber).toBe(7);
    expect(await queuedOf("BIB_ASSIGNED")).toBe(0);

    // After the start, the thank-you is refused: nobody ran.
    expect(await codeOf(sendEventThanks(db, admin, { eventId: event.id }, new Date(STARTS_AT.getTime() + 3_600_000)))).toBe("CONFLICT");
    expect(await allQueued()).toBe(before);

    // What still works: where a registration stands, for somebody who asks.
    await unregister(db, cancelled, bogdan.id, "ADMIN", later);
    await resendRegistrationMessage(db, admin, bogdan.id, new Date(later.getTime() + 1000));
    expect(await queuedOf("REGISTRATION_STATE_NOTICE")).toBe(1);
  });

  it("the public link request sends nothing, and “Înscrierile mele” says the race will not run", async () => {
    const event = await createEvent(5);
    const ana = await enter(event, "ana@example.test");
    await signDeclaration(db, event, ana.id, await signingInput(db, NOW, "Ana Pop"), NOW);
    await cancel(event);
    const before = await allQueued();

    await requestRegistrationLink(db, { email: "ana@example.test", eventId: event.id }, new Date(NOW.getTime() + 60_000));
    expect(await allQueued()).toBe(before);

    const [mine] = await listActiveRegistrationsForParticipant(db, ana.participantId, "ro", new Date(STARTS_AT.getTime() - 3_600_000));
    expect(mine.status).toBe("CONFIRMED");
    expect(mine.eventCancelled).toBe(true);
    expect(mine.selfCheckinOpen).toBe(false);
  });
});
