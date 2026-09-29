import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { emailOutbox } from "@/db/schema/email-outbox";
import { events } from "@/db/schema/events";
import { platformSettings } from "@/db/schema/platform-settings";
import type { OutgoingEmail } from "@/infrastructure/email/adapter";
import type { EmailSender } from "@/infrastructure/email/delivery";
import { computeContentHash, type LegalDocumentTranslationInput } from "@/modules/legal-documents/domain/content-hash";
import { insertLegalDocumentVersion } from "@/modules/legal-documents/repository";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";

/**
 * §513 — under the scheduled delivery timing (the default on QA and production) the request that
 * queues a registration's verification email sends nothing: the drain after its response only
 * wakes the outbox job, the row stays PENDING, and it leaves at the job's run (`processOutboxBatch`,
 * what `/api/internal/jobs/email-outbox` calls). The request path is the real one — the
 * registration service, `enqueueEmail`, `drainOutboxAfterResponse` — with `after()` captured so
 * the test runs what Next would run once the response is out.
 */
const NOW = new Date("2026-10-01T07:00:00.000Z");

const held = vi.hoisted(() => ({ db: null as unknown, afters: [] as (() => Promise<void>)[] }));

vi.mock("next/cache", async () => (await import("../../helpers/next-cache")).fakeNextCache.module);
vi.mock("next/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/server")>()),
  after: (callback: () => Promise<void>) => {
    held.afters.push(callback);
  },
}));
vi.mock("@/shared/config/env", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/shared/config/env")>();
  // The drain is silent under APP_ENV=test unless the end-to-end server's own flag is on: this is the drain being tested.
  return { env: { ...actual.env, E2E_DRAIN_OUTBOX: true } };
});
vi.mock("@/db/client", () => ({ getDb: () => held.db }));

const { fakeNextCache } = await import("../../helpers/next-cache");
const { submitRegistration } = await import("@/modules/registrations/service");
const { processOutboxBatch } = await import("@/modules/notifications/outbox");
type OutboxRow = import("@/modules/notifications/outbox").OutboxRow;
const { DELIVERY_TIMING_SETTING_KEY } = await import("@/modules/notifications/delivery-timing");

let db: TestDatabase;
let close: () => Promise<void>;

beforeAll(async () => {
  ({ db, close } = await createTestDatabase());
  held.db = db;
});
afterAll(async () => close());
beforeEach(async () => {
  await resetTables(db);
  fakeNextCache.reset();
  held.afters = [];
  await approveLegalDocuments();
});

async function approveLegalDocuments() {
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
      now: NOW,
    });
  }
}

function submission(email: string) {
  return {
    firstName: "Ana",
    lastName: "Pop",
    birthDate: "1990-05-17",
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
    renderedAt: new Date(NOW.getTime() - 10_000).toISOString(),
  };
}

function recordingSender(): EmailSender & { calls: OutgoingEmail[] } {
  const calls: OutgoingEmail[] = [];
  return {
    calls,
    async send(message) {
      calls.push(message);
      return { outcome: "sent", providerMessageId: `id-${calls.length}` };
    },
  };
}

async function render(row: OutboxRow): Promise<OutgoingEmail> {
  return { to: row.recipientEmail, subject: row.messageType, html: `<p>${row.messageType}</p>`, text: row.messageType, locale: row.locale, idempotencyKey: row.idempotencyKey };
}

describe("§513 a registration's email waits for the outbox job under the scheduled timing", () => {
  it("stays PENDING through the request's own drain and leaves at the job's run", async () => {
    await db.insert(platformSettings).values({ key: DELIVERY_TIMING_SETTING_KEY, value: { timing: "scheduled" }, updatedAt: NOW });
    const [row] = await db
      .insert(events)
      .values({ type: "GROUP_RUN", startsAt: new Date("2026-10-10T09:00:00.000Z"), registrationMode: "INTERNAL", capacity: null })
      .returning();

    await submitRegistration(
      db,
      {
        id: row.id,
        eventStatus: row.eventStatus,
        registrationMode: "INTERNAL",
        startsAt: row.startsAt,
        registrationOpensAt: row.registrationOpensAt,
        registrationClosesAt: row.registrationClosesAt,
        capacity: null,
        raceId: null,
        publishedAt: NOW,
      },
      submission("ana@example.ro"),
      NOW,
    );

    // The request queued the verification email and asked for a drain after its response.
    expect(held.afters.length).toBeGreaterThan(0);
    for (const callback of held.afters) await callback();

    // The drain read "scheduled", sent nothing, and only told the outbox job to look.
    const queued = await db.select().from(emailOutbox);
    expect(queued.map((email) => email.messageType)).toContain("VERIFY_REGISTRATION_EMAIL");
    expect(queued.every((email) => email.status === "PENDING")).toBe(true);
    expect(fakeNextCache.invalidated).toContain("br-jobs:due:email-outbox");

    // The job's run sends it.
    const sender = recordingSender();
    const summary = await processOutboxBatch(db, { sender, render, now: new Date(NOW.getTime() + 15 * 60_000) });
    expect(summary.sent).toBe(queued.length);
    expect(sender.calls.map((call) => call.to)).toContain("ana@example.ro");
    const after = await db.select().from(emailOutbox);
    expect(after.every((email) => email.status === "SENT")).toBe(true);
  });
});

describe("§513 /api/health's email block says the queue and the next tick", () => {
  it("counts the pending rows, the scheduled wait and the outbox job's next expected call", async () => {
    const { checkEmailHealth } = await import("@/modules/notifications/health");
    await db.insert(platformSettings).values({ key: DELIVERY_TIMING_SETTING_KEY, value: { timing: "scheduled" }, updatedAt: NOW });
    const idle = await checkEmailHealth(db, NOW);
    expect(idle.status).toBe("ok");
    expect(idle.delivery).toMatchObject({ timing: "scheduled", pending: 0, waitMinutes: 15, scheduledWait: { day: 15, night: 60 } });
    // 10:00 in Brașov: the next quarter-hour call.
    expect(idle.delivery.nextTickAt).toBe("2026-10-01T07:15:00.000Z");

    // The budget governor's floor lengthens the promised wait, as the job's own throttle does.
    expect((await checkEmailHealth(db, NOW, 60)).delivery.waitMinutes).toBe(60);

    // At night the pinger's hour.
    const night = new Date("2026-10-01T23:04:00.000Z");
    expect((await checkEmailHealth(db, night)).delivery).toMatchObject({ waitMinutes: 60, nextTickAt: "2026-10-02T00:00:00.000Z" });
  });
});
