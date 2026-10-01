import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { emailOutbox } from "@/db/schema/email-outbox";
import { platformSettings } from "@/db/schema/platform-settings";
import type { OutgoingEmail, SendResult } from "@/infrastructure/email/adapter";
import type { EmailSender } from "@/infrastructure/email/delivery";
import { RATE_PAUSE_ERROR_PREFIX } from "@/modules/notifications/domain/hourly-pace";
import { EMAIL_PLAN_SETTING_KEY } from "@/modules/notifications/email-plan";
import { type OutboxRow, processOutboxBatch } from "@/modules/notifications/outbox";
import { readEmailDelay, readEmailDelayFacts } from "@/modules/notifications/public-delay";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";

/**
 * §NNN — the outbox as the pages that wait for an email read it (`readEmailDelay`), on PGlite: seeded
 * rows make it late or not, for each reason; the newsletter, the club's copies and a family's held
 * row never count; and the outbox expires the read's cache tag once per batch that moved the queue,
 * never for a batch that did nothing.
 */
vi.mock("next/cache", () => ({ revalidateTag: vi.fn(), unstable_cache: vi.fn() }));
const { revalidateTag } = await import("next/cache");

const NOW = new Date("2026-10-01T09:30:00.000Z");
const MINUTE = 60_000;
const ago = (minutes: number) => new Date(NOW.getTime() - minutes * MINUTE);
const ahead = (minutes: number) => new Date(NOW.getTime() + minutes * MINUTE);

let db: TestDatabase;
let close: () => Promise<void>;

beforeAll(async () => {
  ({ db, close } = await createTestDatabase());
});
afterAll(async () => close());
beforeEach(async () => {
  await resetTables(db);
  vi.mocked(revalidateTag).mockClear();
});
afterEach(() => {
  vi.unstubAllEnvs();
});

let counter = 0;
const row = (overrides: Partial<typeof emailOutbox.$inferInsert> = {}) => {
  counter += 1;
  return {
    participantId: null,
    registrationId: null,
    messageType: "VERIFY_REGISTRATION_EMAIL" as const,
    locale: "ro" as const,
    recipientEmail: `r${counter}@example.com`,
    payloadJson: {},
    idempotencyKey: `delay:${counter}`,
    createdAt: ago(1),
    ...overrides,
  };
};

async function insert(...rows: Array<Partial<typeof emailOutbox.$inferInsert>>) {
  await db.insert(emailOutbox).values(rows.map((overrides) => row(overrides)));
}

describe("§NNN readEmailDelay", () => {
  it("is quiet on an empty outbox and on a queue inside the promised wait", async () => {
    expect(await readEmailDelay(db, NOW, 15)).toEqual({ late: false, reason: null, queued: 0, oldestWaitMinutes: 0, estimateMinutes: null });
    await insert({ createdAt: ago(20) }, { createdAt: ago(3) });
    expect(await readEmailDelay(db, NOW, 15)).toMatchObject({ late: false, queued: 2, oldestWaitMinutes: 20 });
  });

  it("is late past the promised wait plus ten minutes, and reads the promise from the settings when not given one", async () => {
    await insert({ createdAt: ago(26) }, { createdAt: ago(3) });
    expect(await readEmailDelay(db, NOW, 15)).toMatchObject({ late: true, reason: "backlog", queued: 2, oldestWaitMinutes: 26 });
    // The test environment sends immediately by default (§513): the promise is nothing, ten minutes is late.
    expect(await readEmailDelay(db, NOW)).toMatchObject({ late: true, reason: "backlog" });
  });

  it("never counts the newsletter, the club's copies or a staff invitation", async () => {
    await insert(
      { messageType: "NEWSLETTER", createdAt: ago(300) },
      { messageType: "NEW_EVENT_ALERT", createdAt: ago(300) },
      { messageType: "DECLARATION_ARCHIVE", createdAt: ago(300) },
      { messageType: "CLUB_CONFIRMATION_NOTICE", createdAt: ago(300) },
      { messageType: "REGISTRATION_CONFIRMED", payloadJson: { clubCopy: true }, createdAt: ago(300) },
      { messageType: "STAFF_INVITATION", createdAt: ago(300) },
    );
    expect(await readEmailDelay(db, NOW, 15)).toMatchObject({ late: false, queued: 0 });
  });

  it("never counts a row the club holds for a family's window, nor a sent or failed one", async () => {
    await insert(
      { createdAt: ago(40), nextAttemptAt: ahead(5) },
      { createdAt: ago(40), status: "SENT", sentAt: ago(30) },
      { createdAt: ago(40), status: "FAILED", lastError: "gone" },
    );
    expect(await readEmailDelay(db, NOW, 15)).toMatchObject({ late: false, queued: 0 });
  });

  it("counts a released family row from its release, not its creation", async () => {
    await insert({ createdAt: ago(40), nextAttemptAt: ago(4) });
    expect(await readEmailDelay(db, NOW, 15)).toMatchObject({ late: false, queued: 1, oldestWaitMinutes: 4 });
  });

  it("says paused while Mailgun's pause lasts, with the pause's end as the estimate", async () => {
    await insert(
      { createdAt: ago(2), status: "PENDING", attemptCount: 0, lastError: `${RATE_PAUSE_ERROR_PREFIX}mailgun 429`, nextAttemptAt: ahead(9) },
      { createdAt: ago(1) },
    );
    expect(await readEmailDelay(db, NOW, 15)).toEqual({ late: true, reason: "paused", queued: 2, oldestWaitMinutes: 2, estimateMinutes: 10 });
  });

  it("says allowance when Mailgun's hour is spent, with the queue at the pace as the estimate", async () => {
    await insert(...Array.from({ length: 100 }, () => ({ status: "SENT" as const, sentAt: ago(20), transport: "mailgun" as const, recipientCount: 1, createdAt: ago(21) })));
    await insert(...Array.from({ length: 30 }, () => ({ createdAt: ago(2) })));
    const facts = await readEmailDelayFacts(db, NOW);
    expect(facts).toMatchObject({ hourlyAllowance: 100, hourlyRemaining: 0, paceBinding: true, queued: 30, queuedOnMailgun: 30, aheadOnMailgun: 30 });
    // 30 ÷ 100 × 60 = 18 → 20.
    expect(await readEmailDelay(db, NOW, 15)).toEqual({ late: true, reason: "allowance", queued: 30, oldestWaitMinutes: 2, estimateMinutes: 20 });
  });

  it("is not paced when the club cleared the hourly allowance", async () => {
    await db.insert(platformSettings).values({ key: EMAIL_PLAN_SETTING_KEY, value: { plan: "FREE", hourlyAllowance: null } });
    await insert(...Array.from({ length: 100 }, () => ({ status: "SENT" as const, sentAt: ago(20), transport: "mailgun" as const, recipientCount: 1, createdAt: ago(21) })));
    await insert({ createdAt: ago(2) });
    expect(await readEmailDelay(db, NOW, 15)).toMatchObject({ late: false, queued: 1 });
  });

  it("says allowance for a message a provider put off to its reset, with the reset as the estimate", async () => {
    await insert({ createdAt: ago(3), lastError: "mailgun: daily allowance spent", nextAttemptAt: ahead(178), attemptCount: 1 });
    expect(await readEmailDelay(db, NOW, 15)).toEqual({ late: true, reason: "allowance", queued: 1, oldestWaitMinutes: 3, estimateMinutes: 180 });
  });
});

describe("§NNN the outbox expires the delay's cache tag once per batch that moved the queue", () => {
  async function render(outboxRow: OutboxRow): Promise<OutgoingEmail> {
    return { to: outboxRow.recipientEmail, subject: "x", html: "<p>x</p>", text: "x", locale: outboxRow.locale, idempotencyKey: outboxRow.idempotencyKey };
  }
  const sender = (answer: () => SendResult): EmailSender => ({ send: async () => answer() });
  const expiredEmail = () => vi.mocked(revalidateTag).mock.calls.filter(([tag]) => tag === "public:email");

  beforeEach(() => {
    vi.stubEnv("NEXT_RUNTIME", "nodejs");
  });

  it("expires it once when the batch sends, however many rows it sent", async () => {
    await insert({}, {}, {});
    const summary = await processOutboxBatch(db, { sender: sender(() => ({ outcome: "sent", providerMessageId: "ok" })), render, now: NOW });
    expect(summary.sent).toBe(3);
    expect(expiredEmail()).toEqual([["public:email", { expire: 0 }]]);
  });

  it("expires it when Mailgun pauses the batch", async () => {
    await insert({}, {});
    const pause: SendResult = { outcome: "throttled", error: "mailgun 429", paced: true, rateRefused: true, retryAfter: ahead(14) };
    const summary = await processOutboxBatch(db, { sender: sender(() => pause), render, now: NOW });
    expect(summary).toMatchObject({ sent: 0, deferred: 2 });
    expect(expiredEmail()).toHaveLength(1);
  });

  it("does not expire it for a batch that claimed nothing, or only scheduled a retry", async () => {
    await processOutboxBatch(db, { sender: sender(() => ({ outcome: "sent", providerMessageId: "ok" })), render, now: NOW });
    expect(expiredEmail()).toHaveLength(0);

    await insert({});
    const summary = await processOutboxBatch(db, { sender: sender(() => ({ outcome: "transient_failure", error: "socket" })), render, now: NOW });
    expect(summary).toMatchObject({ claimed: 1, retrying: 1 });
    expect(expiredEmail()).toHaveLength(0);
  });
});
