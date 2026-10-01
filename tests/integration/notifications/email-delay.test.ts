import { asc, isNull } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { emailOutbox } from "@/db/schema/email-outbox";
import { platformSettings } from "@/db/schema/platform-settings";
import type { OutgoingEmail, SendResult } from "@/infrastructure/email/adapter";
import type { EmailSender } from "@/infrastructure/email/delivery";
import { RATE_PAUSE_ERROR_PREFIX } from "@/modules/notifications/domain/hourly-pace";
import { EMAIL_PLAN_SETTING_KEY } from "@/modules/notifications/email-plan";
import { checkEmailHealth } from "@/modules/notifications/health";
import { type OutboxRoads, type OutboxRow, processOutboxBatch } from "@/modules/notifications/outbox";
import { readEmailDelay, readEmailDelayFacts } from "@/modules/notifications/public-delay";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";

/**
 * §NNN — the outbox as the pages that wait for an email read it (`readEmailDelay`), on PGlite: seeded
 * rows make it late or not, for each reason; the newsletter, the club's copies and a family's held
 * row (told by its markers) never count, while a row handed to a later run — a pace, a pause — does,
 * from its creation; a paused batch leaves `/admin/emails` and `/api/health` as they were; and the
 * outbox expires the read's cache tag once per batch that moved the queue, never for a batch that did
 * nothing.
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

  it("never counts a row the club holds for a family's window — by either kind of marker — nor a sent or failed one", async () => {
    await insert(
      // A hold as the family's path now writes it: the release instant ahead, beside the marker.
      { createdAt: ago(40), nextAttemptAt: ahead(5), payloadJson: { sittingHeld: true, heldUntil: ahead(5).toISOString() } },
      // The payload flags (`sittingHeld` on a verification email, `familyHeld` on any other message).
      { createdAt: ago(40), nextAttemptAt: ahead(5), payloadJson: { sittingHeld: true } },
      { messageType: "COMPLETE_DECLARATION", createdAt: ago(40), nextAttemptAt: ahead(5), payloadJson: { familyHeld: true } },
      { messageType: "REGISTER_ANOTHER_PERSON", createdAt: ago(40), nextAttemptAt: ahead(5), payloadJson: { familySittingId: "sitting-1", familyHeld: true } },
      // The family's one confirmation: the row that names its sitting, with its not-before.
      { messageType: "REGISTRATION_CONFIRMED", createdAt: ago(40), nextAttemptAt: ahead(5), payloadJson: { familySittingId: "sitting-1" } },
      { createdAt: ago(40), status: "SENT", sentAt: ago(30) },
      { createdAt: ago(40), status: "FAILED", lastError: "gone" },
    );
    expect(await readEmailDelay(db, NOW, 15)).toMatchObject({ late: false, queued: 0 });
  });

  it("counts a released family row from its release (`heldUntil`), not its creation", async () => {
    await insert(
      { createdAt: ago(40), nextAttemptAt: ago(4), payloadJson: { sittingHeld: true, heldUntil: ago(4).toISOString() } },
      { messageType: "REGISTRATION_CONFIRMED", createdAt: ago(40), nextAttemptAt: ago(3), payloadJson: { familySittingId: "sitting-1", heldUntil: ago(3).toISOString() } },
    );
    expect(await readEmailDelay(db, NOW, 15)).toMatchObject({ late: false, queued: 2, oldestWaitMinutes: 4 });
  });

  it("counts a released family row from its release after a failed attempt, its retry ahead", async () => {
    // Let go a minute ago, tried once, refused: the backoff puts its next turn ahead, as the outbox writes it.
    await insert({ createdAt: ago(30), nextAttemptAt: ahead(1), attemptCount: 1, lastError: "transient 503", payloadJson: { sittingHeld: true, heldUntil: ago(1).toISOString() } });
    expect(await readEmailDelay(db, NOW, 15)).toMatchObject({ late: false, queued: 1, oldestWaitMinutes: 1 });
  });

  it("counts a family row released half an hour ago and failing since as a backlog — every retry leaves the release where it was", async () => {
    await insert({ createdAt: ago(45), nextAttemptAt: ahead(4), attemptCount: 3, lastError: "transient 503", payloadJson: { sittingHeld: true, heldUntil: ago(30).toISOString() } });
    expect(await readEmailDelay(db, NOW, 15)).toMatchObject({ late: true, reason: "backlog", queued: 1, oldestWaitMinutes: 30 });
  });

  it("reads a marked row queued before `heldUntil` was written by the earlier rule: its not-before with no reason, else its creation", async () => {
    await insert({ createdAt: ago(40), nextAttemptAt: ago(4), payloadJson: { sittingHeld: true } });
    expect(await readEmailDelay(db, NOW, 15)).toMatchObject({ late: false, queued: 1, oldestWaitMinutes: 4 });
    await resetTables(db);
    // Failed after its release: no instant to read, so its creation — an over-report of one hold window at most.
    await insert({ createdAt: ago(40), nextAttemptAt: ahead(4), attemptCount: 1, lastError: "transient 503", payloadJson: { familyHeld: true } });
    expect(await readEmailDelay(db, NOW, 15)).toMatchObject({ late: true, reason: "backlog", queued: 1, oldestWaitMinutes: 40 });
  });

  it("counts an unmarked row with a future turn and no reason as waiting, from its creation — it is not a family's hold", async () => {
    await insert({ createdAt: ago(40), nextAttemptAt: ahead(5) });
    expect(await readEmailDelay(db, NOW, 15)).toMatchObject({ late: true, reason: "backlog", queued: 1, oldestWaitMinutes: 40 });
  });

  it("says paused while Mailgun's pause lasts, with the pause's end as the estimate", async () => {
    await insert(
      { createdAt: ago(2), status: "PENDING", attemptCount: 0, lastError: `${RATE_PAUSE_ERROR_PREFIX}mailgun 429`, nextAttemptAt: ahead(9) },
      { createdAt: ago(1) },
    );
    // Nine minutes of pause, then the pinger's 15-minute tick: 24 → 25.
    expect(await readEmailDelay(db, NOW, 15)).toEqual({ late: true, reason: "paused", queued: 2, oldestWaitMinutes: 2, estimateMinutes: 25 });
  });

  it("says allowance when Mailgun's hour is spent, with the queue at the pace as the estimate", async () => {
    await insert(...Array.from({ length: 100 }, () => ({ status: "SENT" as const, sentAt: ago(20), transport: "mailgun" as const, recipientCount: 1, createdAt: ago(21) })));
    await insert(...Array.from({ length: 30 }, () => ({ createdAt: ago(2) })));
    const facts = await readEmailDelayFacts(db, NOW);
    expect(facts).toMatchObject({ hourlyAllowance: 100, hourlyRemaining: 0, paceBinding: true, queued: 30, queuedOnMailgun: 30, aheadOnMailgun: 30 });
    // The hour's first place frees 41 minutes from now (the sends were 20 minutes ago, the window is 61); then 30 ÷ 100 × 60 = 18, then the 15-minute tick: 74 → 75.
    expect(await readEmailDelay(db, NOW, 15)).toEqual({ late: true, reason: "allowance", queued: 30, oldestWaitMinutes: 2, estimateMinutes: 75 });
  });

  it("is not paced when the club cleared the hourly allowance", async () => {
    await db.insert(platformSettings).values({ key: EMAIL_PLAN_SETTING_KEY, value: { plan: "FREE", hourlyAllowance: null } });
    await insert(...Array.from({ length: 100 }, () => ({ status: "SENT" as const, sentAt: ago(20), transport: "mailgun" as const, recipientCount: 1, createdAt: ago(21) })));
    await insert({ createdAt: ago(2) });
    expect(await readEmailDelay(db, NOW, 15)).toMatchObject({ late: false, queued: 1 });
  });

  it("says allowance for a message a provider put off to its reset, with the reset as the estimate", async () => {
    await insert({ createdAt: ago(3), lastError: "mailgun: daily allowance spent", nextAttemptAt: ahead(178), attemptCount: 1 });
    // The reset in 178 minutes, then the next run: 193 → 195.
    expect(await readEmailDelay(db, NOW, 15)).toEqual({ late: true, reason: "allowance", queued: 1, oldestWaitMinutes: 3, estimateMinutes: 195 });
  });
});

const renderAny = async (r: OutboxRow): Promise<OutgoingEmail> => ({
  to: r.recipientEmail,
  subject: "x",
  html: "<p>x</p>",
  text: "x",
  locale: r.locale,
  idempotencyKey: r.idempotencyKey,
});

describe("§NNN a batch held behind Mailgun's pause", () => {
  beforeEach(() => {
    vi.stubEnv("NEXT_RUNTIME", "nodejs");
  });

  it("still counts every message of it, from its creation, while the pause lasts", async () => {
    await insert(...Array.from({ length: 5 }, () => ({ createdAt: ago(30) })));
    const pause: SendResult = { outcome: "throttled", error: "mailgun 429", paced: true, rateRefused: true, retryAfter: ahead(20) };
    const summary = await processOutboxBatch(db, { sender: { send: async () => pause }, render: renderAny, now: NOW });
    expect(summary).toMatchObject({ claimed: 5, deferred: 5 });
    // Four were handed back with no reason and no marker: not a family's hold, so all five wait, since 30 minutes ago.
    expect(await db.select({ lastError: emailOutbox.lastError }).from(emailOutbox).where(isNull(emailOutbox.lastError))).toHaveLength(4);
    // The pause's 20 minutes, then the pinger's 15-minute tick: 35.
    expect(await readEmailDelay(db, NOW, 15)).toEqual({ late: true, reason: "paused", queued: 5, oldestWaitMinutes: 30, estimateMinutes: 35 });
  });

  it("leaves /admin/emails and /api/health as they were: the batch-mates carry no reason, health names the refused row's", async () => {
    // Three rows, the oldest refused first; the two newer ones are its batch-mates.
    await insert({ createdAt: ago(32) }, { createdAt: ago(31) }, { createdAt: ago(30) });
    const pause: SendResult = { outcome: "throttled", error: "mailgun 429", paced: true, rateRefused: true, retryAfter: ahead(120) };
    const summary = await processOutboxBatch(db, { sender: { send: async () => pause }, render: renderAny, now: NOW });
    expect(summary).toMatchObject({ claimed: 3, deferred: 3 });

    const rows = await db.select({ createdAt: emailOutbox.createdAt, lastError: emailOutbox.lastError }).from(emailOutbox).orderBy(asc(emailOutbox.createdAt));
    // The queue panel shows a row's `last_error` as «Ultimul răspuns al furnizorului»: nothing new on the batch-mates.
    expect(rows.map((r) => r.lastError)).toEqual([`${RATE_PAUSE_ERROR_PREFIX}mailgun 429`, null, null]);

    // Two hours of pause: deferred, and the reason is the refused row's, not a newer batch-mate's.
    const health = await checkEmailHealth(db, NOW);
    expect(health).toMatchObject({ status: "stalled", deferred: 3, lastError: `${RATE_PAUSE_ERROR_PREFIX}mailgun 429` });
    expect(await readEmailDelay(db, NOW, 15)).toMatchObject({ late: true, reason: "paused", queued: 3, oldestWaitMinutes: 32 });
  });
});

describe("§NNN a row Gmail's pace handed to the next run", () => {
  const ROADS: OutboxRoads = { gmailMessageTypes: ["VERIFY_REGISTRATION_EMAIL"], gmailClubCopies: false, gmailBatchSize: 20 };

  beforeEach(() => {
    vi.stubEnv("NEXT_RUNTIME", "nodejs");
  });

  it("waits from its creation, not from the hand-off, and is late past the promise", async () => {
    await insert({ createdAt: ago(60) });
    // Handed off two minutes ago, due again a minute from now: a future turn, no reason, no marker.
    const paced: SendResult = { outcome: "throttled", error: "gmail pace: handed to the next run", paced: true, retryAfter: ahead(1) };
    const summary = await processOutboxBatch(db, { sender: { send: async () => paced }, render: renderAny, roads: ROADS, now: ago(2) });
    expect(summary).toMatchObject({ claimed: 1, retrying: 1 });
    const [handed] = await db.select().from(emailOutbox);
    expect(handed).toMatchObject({ status: "PENDING", attemptCount: 0, lastError: null, nextAttemptAt: ahead(1) });

    expect(await readEmailDelay(db, NOW, 15)).toMatchObject({ late: true, reason: "backlog", queued: 1, oldestWaitMinutes: 60 });
  });

  it("still never counts a family's held row, whichever marker it carries", async () => {
    await insert(
      { createdAt: ago(60), nextAttemptAt: ahead(10), payloadJson: { sittingHeld: true } },
      { messageType: "REGISTER_ANOTHER_PERSON", createdAt: ago(60), nextAttemptAt: ahead(10), payloadJson: { familySittingId: "sitting-2", familyHeld: true } },
      { messageType: "REGISTRATION_CONFIRMED", createdAt: ago(60), nextAttemptAt: ahead(10), payloadJson: { familySittingId: "sitting-2" } },
      // And their club copies, which carry the participant's payload.
      { messageType: "REGISTRATION_CONFIRMED", createdAt: ago(60), nextAttemptAt: ahead(10), payloadJson: { familySittingId: "sitting-2", clubCopy: true } },
    );
    const facts = await readEmailDelayFacts(db, NOW);
    expect(facts).toMatchObject({ queued: 0, aheadOnMailgun: 0, oldestWaitingSince: null });
    expect(await readEmailDelay(db, NOW, 15)).toMatchObject({ late: false, queued: 0 });
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
