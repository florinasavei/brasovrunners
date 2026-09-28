import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { auditLogs } from "@/db/schema/audit-logs";
import { emailOutbox } from "@/db/schema/email-outbox";
import { events, eventTranslations } from "@/db/schema/events";
import { jobRuns } from "@/db/schema/job-runs";
import { platformSettings } from "@/db/schema/platform-settings";
import { registrations } from "@/db/schema/registrations";
import { staffUsers } from "@/db/schema/staff-users";
import type { OutgoingEmail } from "@/infrastructure/email/adapter";
import { computeContentHash, type LegalDocumentTranslationInput } from "@/modules/legal-documents/domain/content-hash";
import { insertLegalDocumentVersion } from "@/modules/legal-documents/repository";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";

/**
 * §NNN (amending §513, §80, §68; the owner, 2026-09-28: «cand retrimit un mail trebuie sa am optiunea
 * de bypass la cron ca sa pot retrimite instant!») — under the scheduled timing a backoffice resend
 * with «Trimite acum» leaves within its request: the drain after the response sends that row and its
 * club copy, and nothing else of the queue; with «Pune la coadă» it waits for the scheduled pass as
 * before. A «now» the day's allowance cannot hold is refused and queues nothing (§80). A row already
 * sent is never sent again by this path (§39).
 *
 * The request path is the real one — the service, `enqueueEmail`, `drainOutboxRowsAfterResponse` —
 * with `after()` captured so the test runs what Next runs once the response is out, and the provider
 * a stub that records each call.
 */
const NOW = new Date("2026-10-01T07:00:00.000Z");

const held = vi.hoisted(() => ({
  db: null as unknown,
  afters: [] as (() => Promise<void>)[],
  sent: [] as { to: string; subject: string }[],
}));

vi.mock("next/cache", async () => (await import("../../helpers/next-cache")).fakeNextCache.module);
vi.mock("next/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/server")>()),
  after: (callback: () => Promise<void>) => {
    held.afters.push(callback);
  },
}));
vi.mock("@/shared/config/env", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/shared/config/env")>();
  // The drains are silent under APP_ENV=test unless the end-to-end server's own flag is on.
  return { env: { ...actual.env, E2E_DRAIN_OUTBOX: true } };
});
vi.mock("@/db/client", () => ({ getDb: () => held.db }));
// The provider: a stub that records every message it is handed.
vi.mock("@/modules/notifications/outbox-sender", () => ({
  createOutboxSender: async () => ({
    sender: {
      async send(message: OutgoingEmail) {
        held.sent.push({ to: message.to, subject: message.subject });
        return { outcome: "sent", providerMessageId: `id-${held.sent.length}` } as const;
      },
    },
    route: () => "mailgun" as const,
    replyTo: undefined,
  }),
}));
// The words are the renderer's own business (`render.test.ts`); here, the row's type and address.
vi.mock("@/modules/notifications/render", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/modules/notifications/render")>()),
  createOutboxRenderer: () => async (row: { recipientEmail: string; messageType: string; locale: "ro" | "en"; idempotencyKey: string }) => ({
    to: row.recipientEmail,
    subject: row.messageType,
    html: `<p>${row.messageType}</p>`,
    text: row.messageType,
    locale: row.locale,
    idempotencyKey: row.idempotencyKey,
  }),
}));

const { fakeNextCache } = await import("../../helpers/next-cache");
const { submitRegistration } = await import("@/modules/registrations/service");
const { resendRegistrationMessage } = await import("@/modules/registrations/admin-service");
const { resendStaffInvitation } = await import("@/modules/staff-identity/service");
const { sendParticipantMessage } = await import("@/modules/notifications/participant-messages");
const { processOutboxBatch } = await import("@/modules/notifications/outbox");
const { sendOutboxRowsNow } = await import("@/modules/notifications/send-rows-now");
const { readOutboxQueue } = await import("@/modules/notifications/queue");
const { readOutboxDelivery } = await import("@/modules/notifications/outbox-delivery");
const { SendNowRefused } = await import("@/modules/notifications/send-at-once");
const { SEND_NOW_ROW_LIMIT, leavesNow } = await import("@/modules/notifications/domain/send-at-once");
const { DELIVERY_TIMING_SETTING_KEY } = await import("@/modules/notifications/delivery-timing");
const { CLUB_NOTICES_SETTING_KEY } = await import("@/modules/notifications/club-notices");

let db: TestDatabase;
let close: () => Promise<void>;
let admin: { id: string; role: "ADMIN" };

beforeAll(async () => {
  ({ db, close } = await createTestDatabase());
  held.db = db;
});
afterAll(async () => close());
beforeEach(async () => {
  await resetTables(db);
  fakeNextCache.reset();
  held.afters = [];
  held.sent = [];
  const text: LegalDocumentTranslationInput[] = [
    { locale: "ro", title: "Text", body: { sections: [{ paragraphs: ["p"] }] } },
    { locale: "en", title: "Text", body: { sections: [{ paragraphs: ["p"] }] } },
  ];
  for (const key of ["TERMS", "PRIVACY_NOTICE", "EVENT_DECLARATION"] as const) {
    await insertLegalDocumentVersion(db, { key, version: 1, effectiveAt: new Date("2026-01-01T00:00:00.000Z"), isApproved: true, contentSha256: computeContentHash(text), translations: text, now: NOW });
  }
  // The scheduled pass, as on QA and production (§513).
  await db.insert(platformSettings).values({ key: DELIVERY_TIMING_SETTING_KEY, value: { timing: "scheduled" }, updatedAt: NOW });
  const [row] = await db.insert(staffUsers).values({ email: "admin@dev.test", displayName: "Admin", role: "ADMIN" }).returning();
  admin = { id: row.id, role: "ADMIN" };
});

/** A confirmed runner of a group run, as the public form and the address link leave one. */
async function confirmedRunner(email = "ana@example.ro", existing?: typeof events.$inferSelect) {
  const [event] = existing
    ? [existing]
    : await db
    .insert(events)
    .values({ type: "GROUP_RUN", startsAt: new Date("2026-10-10T09:00:00.000Z"), registrationMode: "INTERNAL", capacity: null, editorialStatus: "PUBLISHED", publishedAt: NOW })
    .returning();
  if (!existing) await db.insert(eventTranslations).values([
    { eventId: event.id, locale: "ro", title: "Alergarea de joi", slug: "alergarea-de-joi" },
    { eventId: event.id, locale: "en", title: "The Thursday run", slug: "thursday-run" },
  ]);
  await submitRegistration(
    db,
    { id: event.id, eventStatus: event.eventStatus, registrationMode: "INTERNAL", startsAt: event.startsAt, registrationOpensAt: null, registrationClosesAt: null, capacity: null, raceId: null, publishedAt: NOW },
    {
      firstName: "Ana",
      lastName: "Pop",
      birthDate: "1990-05-17",
      sex: "UNSPECIFIED",
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
      renderedAt: new Date(NOW.getTime() - 10_000).toISOString(),
    },
    NOW,
  );
  const [registration] = await db.update(registrations).set({ status: "CONFIRMED" }).where(eq(registrations.eventId, event.id)).returning();
  // What the form queued has left long ago: the queue holds only what the test adds.
  await db.update(emailOutbox).set({ status: "SENT", sentAt: new Date(NOW.getTime() - 86_400_000) });
  held.afters = [];
  return { event, registration };
}

async function runAfters() {
  const pending = held.afters;
  held.afters = [];
  for (const callback of pending) await callback();
}

const resends = () => db.select().from(emailOutbox).where(eq(emailOutbox.isManualResend, true));

describe("§NNN a resend with «Trimite acum» leaves within its request", () => {
  it("sends that row once after the response, marks it SENT and names the press on the trail", async () => {
    const { registration } = await confirmedRunner();
    const later = new Date(NOW.getTime() + 60_000);
    await resendRegistrationMessage(db, admin, registration.id, later, undefined, "now");

    // Before the response went out: queued, marked «Pleacă acum» on the queue panel.
    const [queued] = await resends();
    expect(queued.status).toBe("PENDING");
    expect(queued.payloadJson).toMatchObject({ sentNow: true });
    expect((await readOutboxQueue(db, 50, later)).rows.find((row) => row.id === queued.id)?.sentNow).toBe(true);

    await runAfters();
    expect(held.sent).toEqual([{ to: "ana@example.ro", subject: "REGISTRATION_CONFIRMED" }]);
    const [sent] = await resends();
    expect(sent.status).toBe("SENT");

    const [audit] = await db.select().from(auditLogs).where(eq(auditLogs.action, "registration.sent_now"));
    expect(audit).toMatchObject({ actorStaffUserId: admin.id, entityType: "registration", entityId: registration.id });
    expect(audit.metadataJson).toMatchObject({ outboxId: queued.id, messageType: "REGISTRATION_CONFIRMED", bypassedSchedule: true });
  });

  it("is not a pass of the scheduler: no email-outbox job run is written, «Ultima trecere programată» does not move (review)", async () => {
    const { registration } = await confirmedRunner();
    // The scheduler's own last pass, an hour before the press.
    const lastPass = new Date(NOW.getTime() - 3_600_000);
    await db.insert(jobRuns).values({ jobName: "email-outbox", startedAt: lastPass, finishedAt: lastPass, itemsProcessed: 0, errorCount: 0 });
    const later = new Date(NOW.getTime() + 60_000);
    const before = await readOutboxDelivery(db, later);

    await resendRegistrationMessage(db, admin, registration.id, later, undefined, "now");
    await runAfters();

    expect(held.sent).toHaveLength(1);
    const runs = await db.select().from(jobRuns).where(eq(jobRuns.jobName, "email-outbox"));
    expect(runs).toHaveLength(1);
    const after = await readOutboxDelivery(db, later);
    expect(after.lastRunAt).toBe(before.lastRunAt);
    expect(after.nextTickAt).toBe(before.nextTickAt);
  });

  it("sends the club's copy with it, and nothing else of the queue", async () => {
    const { registration } = await confirmedRunner();
    await db.insert(platformSettings).values({
      key: CLUB_NOTICES_SETTING_KEY,
      value: { declarations: { to: "", cc: [], bcc: [] }, confirmations: { to: [] }, participants: { bcc: ["arhiva@club.test"] } },
      updatedAt: NOW,
    });
    // Somebody else's email, waiting for the scheduled pass.
    const [other] = await db
      .insert(emailOutbox)
      .values({ participantId: null, registrationId: null, messageType: "REGISTRATION_STATE_NOTICE", locale: "ro", recipientEmail: "ion@example.ro", payloadJson: {}, idempotencyKey: "other:1", status: "PENDING", attemptCount: 0, createdAt: NOW })
      .returning();

    await resendRegistrationMessage(db, admin, registration.id, new Date(NOW.getTime() + 60_000), undefined, "now");
    await runAfters();

    expect(held.sent.map((message) => message.to).sort()).toEqual(["ana@example.ro", "arhiva@club.test"]);
    expect((await resends()).every((row) => row.status === "SENT")).toBe(true);
    const [untouched] = await db.select().from(emailOutbox).where(eq(emailOutbox.id, other.id));
    expect(untouched.status).toBe("PENDING");
    expect(untouched.attemptCount).toBe(0);
  });

  it("with «Pune la coadă» the row stays PENDING through the drain, and leaves at the scheduled pass", async () => {
    const { registration } = await confirmedRunner();
    await resendRegistrationMessage(db, admin, registration.id, new Date(NOW.getTime() + 60_000), undefined, "queue");
    await runAfters();

    expect(held.sent).toEqual([]);
    const [queued] = await resends();
    expect(queued.status).toBe("PENDING");
    expect(queued.payloadJson).not.toHaveProperty("sentNow");
    // The drain only told the outbox job to look (§513).
    expect(fakeNextCache.invalidated).toContain("br-jobs:due:email-outbox");
    expect(await db.select().from(auditLogs).where(eq(auditLogs.action, "registration.sent_now"))).toHaveLength(0);

    // The scheduled pass sends it.
    const calls: string[] = [];
    await processOutboxBatch(db, {
      sender: { send: async (message) => (calls.push(message.to), { outcome: "sent", providerMessageId: "job-1" }) },
      render: async (row) => ({ to: row.recipientEmail, subject: "x", html: "x", text: "x", locale: row.locale, idempotencyKey: row.idempotencyKey }),
      now: new Date(NOW.getTime() + 15 * 60_000),
    });
    expect(calls).toEqual(["ana@example.ro"]);
  });

  it("refuses a «now» the day's Mailgun allowance cannot hold, and queues nothing; «la coadă» still queues", async () => {
    const { registration } = await confirmedRunner();
    // A hundred sent today already: the free plan's day (§80).
    await db.insert(emailOutbox).values(
      Array.from({ length: 100 }, (_, index) => ({
        participantId: null,
        registrationId: null,
        messageType: "REGISTRATION_STATE_NOTICE" as const,
        locale: "ro" as const,
        recipientEmail: `x${index}@example.ro`,
        payloadJson: {},
        idempotencyKey: `earlier:${index}`,
        status: "SENT" as const,
        attemptCount: 1,
        sentAt: NOW,
        createdAt: NOW,
      })),
    );

    const refused = await resendRegistrationMessage(db, admin, registration.id, new Date(NOW.getTime() + 60_000), undefined, "now").catch((error: unknown) => error);
    expect(refused).toBeInstanceOf(SendNowRefused);
    expect(await resends()).toHaveLength(0);
    expect(held.afters).toHaveLength(0);

    await resendRegistrationMessage(db, admin, registration.id, new Date(NOW.getTime() + 120_000), undefined, "queue");
    expect(await resends()).toHaveLength(1);
  });

  it("counts the club's copy against the allowance too, and a refusal spends none of the hour's resends", async () => {
    const { registration } = await confirmedRunner();
    await db.insert(platformSettings).values({
      key: CLUB_NOTICES_SETTING_KEY,
      value: { declarations: { to: "", cc: [], bcc: [] }, confirmations: { to: [] }, participants: { bcc: ["arhiva@club.test"] } },
      updatedAt: NOW,
    });
    // Ninety-nine sent today: room for the message, not for the message and its copy.
    await db.insert(emailOutbox).values(
      Array.from({ length: 99 }, (_, index) => ({
        participantId: null,
        registrationId: null,
        messageType: "REGISTRATION_STATE_NOTICE" as const,
        locale: "ro" as const,
        recipientEmail: `x${index}@example.ro`,
        payloadJson: {},
        idempotencyKey: `earlier:${index}`,
        status: "SENT" as const,
        attemptCount: 1,
        sentAt: NOW,
        createdAt: NOW,
      })),
    );
    for (let press = 0; press < 5; press += 1) {
      const refused = await resendRegistrationMessage(db, admin, registration.id, new Date(NOW.getTime() + 60_000 + press), undefined, "now").catch((error: unknown) => error);
      expect(refused).toBeInstanceOf(SendNowRefused);
    }
    expect(await resends()).toHaveLength(0);
    // The queue the refusal suggests is still allowed: the refused presses spent no resend.
    await resendRegistrationMessage(db, admin, registration.id, new Date(NOW.getTime() + 120_000), undefined, "queue");
    expect((await resends()).length).toBeGreaterThan(0);
  });

  it("never sends again a row that has left (§39): the path takes only rows still waiting", async () => {
    const { registration } = await confirmedRunner();
    await resendRegistrationMessage(db, admin, registration.id, new Date(NOW.getTime() + 60_000), undefined, "now");
    await runAfters();
    const [sent] = await resends();
    expect(sent.status).toBe("SENT");
    held.sent = [];
    const summary = await sendOutboxRowsNow(db, [sent.id], new Date(NOW.getTime() + 120_000));
    expect(summary.claimed).toBe(0);
    expect(held.sent).toEqual([]);
  });

  it("is an Administrator's verb, asserted in the service", async () => {
    const { registration } = await confirmedRunner();
    // The Organizer (MODERATOR) reads the registrations and changes nothing on them (§289).
    const [organizer] = await db.insert(staffUsers).values({ email: "org@dev.test", displayName: "Org", role: "MODERATOR" }).returning();
    const forbidden = await resendRegistrationMessage(db, { id: organizer.id, role: "MODERATOR" }, registration.id, NOW, undefined, "now").catch((error: unknown) => error);
    expect(forbidden).toMatchObject({ code: "FORBIDDEN" });
    expect(await resends()).toHaveLength(0);
  });
});

describe("§NNN the organizer's message with «Trimite acum»", () => {
  it("sends every row of the send after the response, and the trail says it passed the round", async () => {
    const { event } = await confirmedRunner();
    const result = await sendParticipantMessage(
      db,
      admin,
      {
        eventId: event.id,
        audience: "ALL_ACTIVE",
        sendId: "0b0d5c3e-4f5a-4c1e-9d2b-7a8e9f0a1b2c",
        subject: { ro: "Vreme rea", en: "Bad weather" },
        body: { ro: "Startul se mută la 10:00.", en: "The start moves to 10:00." },
        delivery: "now",
      },
      NOW,
    );
    expect(result).toMatchObject({ kind: "queued", real: 1 });
    await runAfters();
    expect(held.sent).toEqual([{ to: "ana@example.ro", subject: "ORGANIZER_MESSAGE" }]);
    const [audit] = await db.select().from(auditLogs).where(eq(auditLogs.action, "event.participant_message_sent"));
    expect(audit.metadataJson).toMatchObject({ delivery: "now", bypassedSchedule: true });
  });

  it("past forty recipients (review): only the first forty are marked and sent now; the rest and the club's copy wait, unmarked, for the scheduled pass", async () => {
    await db.insert(platformSettings).values({ key: CLUB_NOTICES_SETTING_KEY, value: { declarations: { to: "", cc: [], bcc: [] }, confirmations: { to: [] }, participants: { bcc: ["arhiva@club.test"] } }, updatedAt: NOW });
    const { event } = await confirmedRunner("runner-0@example.ro");
    for (let index = 1; index < 45; index += 1) await confirmedRunner(`runner-${index}@example.ro`, event);
    const result = await sendParticipantMessage(
      db,
      admin,
      {
        eventId: event.id,
        audience: "ALL_ACTIVE",
        sendId: "1c1e6d4f-5a6b-4d2f-8e3c-8b9f0a1b2c3d",
        subject: { ro: "Vreme rea", en: "Bad weather" },
        body: { ro: "Startul se mută la 10:00.", en: "The start moves to 10:00." },
        delivery: "now",
      },
      NOW,
    );
    expect(result).toMatchObject({ kind: "queued", real: 45, sentNow: SEND_NOW_ROW_LIMIT, later: 45 - SEND_NOW_ROW_LIMIT });

    // Before the drain: «Pleacă acum» on exactly the forty the press will send, never on the rest.
    const queue = await readOutboxQueue(db, 100, NOW);
    const organizer = queue.rows.filter((row) => row.messageType === "ORGANIZER_MESSAGE");
    expect(organizer.length).toBeGreaterThanOrEqual(45);
    expect(organizer.filter((row) => row.sentNow)).toHaveLength(SEND_NOW_ROW_LIMIT);
    for (const row of organizer) {
      expect(leavesNow(row, NOW)).toBe(row.sentNow);
    }

    await runAfters();
    expect(held.sent).toHaveLength(SEND_NOW_ROW_LIMIT);
    const waiting = await db.select().from(emailOutbox).where(eq(emailOutbox.status, "PENDING"));
    // The five past the limit, and the club's copy of a send most of the list has not had yet.
    expect(waiting.filter((row) => row.messageType === "ORGANIZER_MESSAGE").length).toBeGreaterThanOrEqual(45 - SEND_NOW_ROW_LIMIT);
    for (const row of waiting) expect((row.payloadJson as Record<string, unknown>).sentNow).toBeUndefined();
  });
});

describe("§NNN «Retrimite invitația» on Echipa with «Trimite acum»", () => {
  /** A colleague on the list who has not signed in yet. */
  async function invited() {
    const [row] = await db.insert(staffUsers).values({ email: "voluntar@club.test", displayName: "Voluntar", role: "CONTRIBUTOR" }).returning();
    return row;
  }
  const invitations = () => db.select().from(emailOutbox).where(eq(emailOutbox.messageType, "STAFF_INVITATION"));
  /** The inviter as the session holds them: the whole row. */
  const adminRow = async () => (await db.select().from(staffUsers).where(eq(staffUsers.id, admin.id)))[0]!;

  it("sends the invitation once after the response and names the press on the trail", async () => {
    const member = await invited();
    await resendStaffInvitation(db, await adminRow(), member.email, new Date(NOW.getTime() + 60_000), "now");
    const [queued] = await invitations();
    expect(queued.status).toBe("PENDING");
    expect(queued.payloadJson).toMatchObject({ sentNow: true });

    await runAfters();
    expect(held.sent).toEqual([{ to: "voluntar@club.test", subject: "STAFF_INVITATION" }]);
    const [sent] = await invitations();
    expect(sent.status).toBe("SENT");
    const [audit] = await db.select().from(auditLogs).where(eq(auditLogs.action, "staff.invitation_sent_now"));
    expect(audit).toMatchObject({ actorStaffUserId: admin.id, entityType: "staff_user", entityId: member.id });
    expect(audit.metadataJson).toMatchObject({ outboxId: queued.id, messageType: "STAFF_INVITATION", bypassedSchedule: true });
  });

  it("with «Pune la coadă» waits for the scheduled pass, as before", async () => {
    const member = await invited();
    await resendStaffInvitation(db, await adminRow(), member.email, new Date(NOW.getTime() + 60_000), "queue");
    await runAfters();
    expect(held.sent).toEqual([]);
    const [queued] = await invitations();
    expect(queued.status).toBe("PENDING");
    expect(queued.payloadJson).not.toHaveProperty("sentNow");
    expect(await db.select().from(auditLogs).where(eq(auditLogs.action, "staff.invitation_sent_now"))).toHaveLength(0);
  });

  it("refuses a «now» the day's allowance cannot hold, and queues nothing (§80)", async () => {
    const member = await invited();
    await db.insert(emailOutbox).values(
      Array.from({ length: 100 }, (_, index) => ({
        participantId: null,
        registrationId: null,
        messageType: "REGISTRATION_STATE_NOTICE" as const,
        locale: "ro" as const,
        recipientEmail: `x${index}@example.ro`,
        payloadJson: {},
        idempotencyKey: `earlier:${index}`,
        status: "SENT" as const,
        attemptCount: 1,
        sentAt: NOW,
        createdAt: NOW,
      })),
    );
    const refused = await resendStaffInvitation(db, await adminRow(), member.email, new Date(NOW.getTime() + 60_000), "now").catch((error: unknown) => error);
    expect(refused).toBeInstanceOf(SendNowRefused);
    expect(await invitations()).toHaveLength(0);
    expect(held.afters).toHaveLength(0);
  });
});
