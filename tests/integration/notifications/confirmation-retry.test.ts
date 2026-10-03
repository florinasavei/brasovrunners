import { and, eq, like } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { emailOutbox } from "@/db/schema/email-outbox";
import { events, eventTranslations } from "@/db/schema/events";
import { participants } from "@/db/schema/participants";
import { registrations } from "@/db/schema/registrations";
import type { OutgoingEmail, SendResult } from "@/infrastructure/email/adapter";
import type { EmailSender } from "@/infrastructure/email/delivery";
import { DEFAULT_DEADLINES } from "@/modules/deadlines/domain/deadlines";
import { hoursPhrase } from "@/modules/deadlines/domain/duration-words";
import { nextMaintenanceWork } from "@/modules/jobs/next-work";
import { computeContentHash, type LegalDocumentTranslationInput } from "@/modules/legal-documents/domain/content-hash";
import { insertLegalDocumentVersion } from "@/modules/legal-documents/repository";
import { queueConfirmationRetries } from "@/modules/notifications/confirmation-retry";
import { forecastAutomaticEmails } from "@/modules/notifications/forecast";
import { type OutboxRow, processOutboxBatch } from "@/modules/notifications/outbox";
import { createOutboxRenderer } from "@/modules/notifications/render";
import { canonicalizeEmail } from "@/modules/participants/domain/canonical-email";
import { runRegistrationMaintenance } from "@/modules/registrations/maintenance";
import { confirmEmail, type EventForRegistration, requestRegistrationLink, submitRegistration } from "@/modules/registrations/service";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";

/**
 * §NNN — the second verification email: the address link once more, by itself, the club's hours
 * after the last email left («Termene», 24 by default), to whoever has not confirmed and whose link
 * still has the club's least time left (6 hours by default). The request path is the real one —
 * `submitRegistration` queues the first email, `processOutboxBatch` sends it — and the job's step is
 * the maintenance run's.
 */
const T = new Date("2026-09-04T08:05:00.000Z");
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

async function approveLegalDocuments(db: TestDatabase) {
  const text: LegalDocumentTranslationInput[] = [
    { locale: "ro", title: "Text", body: { sections: [{ paragraphs: ["p"] }] } },
    { locale: "en", title: "Text", body: { sections: [{ paragraphs: ["p"] }] } },
  ];
  for (const key of ["TERMS", "PRIVACY_NOTICE", "EVENT_DECLARATION"] as const) {
    await insertLegalDocumentVersion(db, {
      key,
      version: 1,
      effectiveAt: new Date("2026-01-01T00:00:00.000Z"),
      isApproved: true,
      contentSha256: computeContentHash(text),
      translations: text,
      now: T,
    });
  }
}

function submission(email: string, at: Date, firstName = "Ana") {
  return {
    firstName,
    lastName: "Pop",
    birthDate: firstName === "Ana" ? "1990-05-17" : "1992-03-02",
    sex: "FEMALE",
    nationality: "RO",
    country: "RO",
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
    resultsNameConsent: true,
    listOptOut: false,
    honeypot: "",
    renderedAt: new Date(at.getTime() - 10_000).toISOString(),
  };
}

function sender(outcomes: SendResult[] = []): EmailSender & { calls: OutgoingEmail[] } {
  const calls: OutgoingEmail[] = [];
  return {
    calls,
    async send(message) {
      calls.push(message);
      return outcomes.shift() ?? { outcome: "sent", providerMessageId: `id-${calls.length}` };
    },
  };
}

async function stub(row: OutboxRow): Promise<OutgoingEmail> {
  return { to: row.recipientEmail, subject: row.messageType, html: `<p>${row.messageType}</p>`, text: row.messageType, locale: row.locale, idempotencyKey: row.idempotencyKey };
}

describe("§NNN the second verification email", () => {
  let db: TestDatabase;
  let close: () => Promise<void>;

  beforeAll(async () => {
    ({ db, close } = await createTestDatabase());
  });
  afterAll(async () => close());
  beforeEach(async () => {
    await resetTables(db);
    await approveLegalDocuments(db);
  });

  async function event(startsAt = new Date("2026-10-01T09:00:00.000Z")): Promise<EventForRegistration> {
    const [row] = await db.insert(events).values({ type: "GROUP_RUN", startsAt, registrationMode: "INTERNAL", capacity: 10 }).returning();
    await db.insert(eventTranslations).values({ eventId: row.id, locale: "ro", slug: "crosul", title: "Crosul", excerpt: "x" });
    return {
      id: row.id,
      eventStatus: row.eventStatus,
      registrationMode: "INTERNAL",
      startsAt: row.startsAt,
      registrationOpensAt: row.registrationOpensAt,
      registrationClosesAt: row.registrationClosesAt,
      capacity: 10,
      raceId: null,
      publishedAt: T,
    };
  }

  async function registrationOf(eventId: string, email: string) {
    const [participant] = await db.select().from(participants).where(eq(participants.canonicalEmail, canonicalizeEmail(email).canonicalEmail));
    const [row] = await db
      .select()
      .from(registrations)
      .where(and(eq(registrations.eventId, eventId), eq(registrations.participantId, participant.id)));
    return row;
  }

  async function retries() {
    return db.select().from(emailOutbox).where(and(eq(emailOutbox.messageType, "VERIFY_REGISTRATION_EMAIL"), like(emailOutbox.idempotencyKey, "%:verify-retry:%")));
  }

  /** Submitted at T and its first email sent at once. */
  async function submittedAndSent(race: EventForRegistration, email = "ana@example.ro") {
    await submitRegistration(db, race, submission(email, T), T);
    await processOutboxBatch(db, { sender: sender(), render: stub, now: T });
    return registrationOf(race.id, email);
  }

  it("goes once, the club's hours after the first email left, with its sentence and the link's hours left", async () => {
    const race = await event();
    const pending = await submittedAndSent(race);
    expect(pending.emailLinkExpiresAt).toEqual(new Date(T.getTime() + 48 * HOUR));

    // The send's own clock is a few milliseconds past T: a minute either side of the day.
    expect((await runRegistrationMaintenance(db, new Date(T.getTime() + 24 * HOUR - MINUTE))).confirmationRetriesQueued).toBe(0);
    expect((await runRegistrationMaintenance(db, new Date(T.getTime() + 24 * HOUR + MINUTE))).confirmationRetriesQueued).toBe(1);
    expect((await runRegistrationMaintenance(db, new Date(T.getTime() + 25 * HOUR))).confirmationRetriesQueued).toBe(0);

    const [retry] = await retries();
    expect(retry.registrationId).toBe(pending.id);
    // No deadline mark (§513): the link keeps the deadline its first email started.
    expect(retry.payloadJson).toEqual({ confirmationRetry: true });

    const mail = sender();
    const at = new Date(T.getTime() + 25 * HOUR);
    await processOutboxBatch(db, { sender: mail, render: createOutboxRenderer(), now: at });
    const sent = mail.calls.find((call) => call.to === "ana@example.ro");
    expect(sent?.text).toContain("Îți scriem încă o dată pentru că adresa nu e confirmată încă.");
    expect(sent?.text).toContain("We are writing once more because your address is not confirmed yet.");
    // Twenty-three hours left on the link, and the club's full forty-eight said nowhere.
    expect(sent?.text).toContain(hoursPhrase("ro", 23));
    expect(sent?.text).not.toContain(hoursPhrase("ro", 48));
    // The link did not move.
    expect((await registrationOf(race.id, "ana@example.ro")).emailLinkExpiresAt).toEqual(new Date(T.getTime() + 48 * HOUR));

    // A second email begets no third.
    expect((await runRegistrationMaintenance(db, new Date(T.getTime() + 47 * HOUR))).confirmationRetriesQueued).toBe(0);
  });

  it("waits for the first email to leave: one still queued is no email yet", async () => {
    const race = await event();
    await submitRegistration(db, race, submission("ana@example.ro", T), T);
    expect(await queueConfirmationRetries(db, new Date(T.getTime() + 30 * HOUR), DEFAULT_DEADLINES)).toBe(0);
  });

  it("never once the link has less than the club's least time left, never at 0 hours, never to a bounced address", async () => {
    const race = await event();
    const pending = await submittedAndSent(race);
    // 48 − 6 = 42 hours: a run after that sends nothing.
    expect(await queueConfirmationRetries(db, new Date(T.getTime() + 42 * HOUR + MINUTE), DEFAULT_DEADLINES)).toBe(0);
    expect(await queueConfirmationRetries(db, new Date(T.getTime() + 30 * HOUR), { ...DEFAULT_DEADLINES, confirmationRetryHours: 0 })).toBe(0);
    await db.update(emailOutbox).set({ status: "BOUNCED" }).where(eq(emailOutbox.registrationId, pending.id));
    expect(await queueConfirmationRetries(db, new Date(T.getTime() + 30 * HOUR), DEFAULT_DEADLINES)).toBe(0);
  });

  it("is withdrawn at the send when the address was confirmed in the meantime", async () => {
    const race = await event();
    const pending = await submittedAndSent(race);
    const at = new Date(T.getTime() + 24 * HOUR + MINUTE);
    expect(await queueConfirmationRetries(db, at, DEFAULT_DEADLINES)).toBe(1);
    await confirmEmail(db, race, pending.id, new Date(at.getTime() + MINUTE));
    const mail = sender();
    await processOutboxBatch(db, { sender: mail, render: createOutboxRenderer(), now: new Date(at.getTime() + 2 * MINUTE) });
    expect(await retries()).toHaveLength(0);
    expect(mail.calls.some((call) => /încă o dată pentru că adresa/.test(call.text))).toBe(false);
  });

  it("counts from the last email: the person's own «Retrimite» moves it, and gets one more after it", async () => {
    const race = await event();
    await submittedAndSent(race);
    const resent = new Date(T.getTime() + 10 * HOUR);
    await requestRegistrationLink(db, { email: "ana@example.ro", eventId: race.id }, resent);
    expect(await queueConfirmationRetries(db, new Date(T.getTime() + 30 * HOUR), DEFAULT_DEADLINES)).toBe(0);
    await processOutboxBatch(db, { sender: sender(), render: stub, now: resent });
    expect(await queueConfirmationRetries(db, new Date(T.getTime() + 30 * HOUR), DEFAULT_DEADLINES)).toBe(0);
    expect(await queueConfirmationRetries(db, new Date(resent.getTime() + 24 * HOUR + MINUTE), DEFAULT_DEADLINES)).toBe(1);
  });

  it("a test registration gets it like a real one (§12.6)", async () => {
    const race = await event();
    const pending = await submittedAndSent(race);
    await db.update(registrations).set({ kind: "TEST" }).where(eq(registrations.id, pending.id));
    expect(await queueConfirmationRetries(db, new Date(T.getTime() + 24 * HOUR + MINUTE), DEFAULT_DEADLINES)).toBe(1);
  });

  it("the job's plan wakes for it, and the forecast lists it at the same instant", async () => {
    const race = await event();
    await submittedAndSent(race);
    const [first] = await db.select().from(emailOutbox).where(eq(emailOutbox.messageType, "VERIFY_REGISTRATION_EMAIL"));
    const due = new Date((first.sentAt as Date).getTime() + 24 * HOUR);
    expect(await nextMaintenanceWork(db, new Date(T.getTime() + HOUR))).toEqual(due);
    const rows = await forecastAutomaticEmails(db, { now: new Date(T.getTime() + HOUR), horizonDays: 14, deadlines: DEFAULT_DEADLINES });
    const retry = rows.find((row) => row.send === "confirmationRetry");
    expect(retry?.at).toEqual(due);
    expect(retry?.type).toBe("VERIFY_REGISTRATION_EMAIL");
    expect(retry?.recipients).toBe(1);
  });
});
