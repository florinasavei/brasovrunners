import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { emailOutbox } from "@/db/schema/email-outbox";
import { participants } from "@/db/schema/participants";
import type { OutgoingEmail, SendResult } from "@/infrastructure/email/adapter";
import { createCaptureAdapter } from "@/infrastructure/email/capture-adapter";
import { createEmailSender, type EmailSender } from "@/infrastructure/email/delivery";
import { MAX_SEND_ATTEMPTS } from "@/modules/notifications/domain/retry";
import {
  applyMailgunEvent,
  claimOutboxBatch,
  enqueueEmail,
  type OutboxRow,
  processOutboxBatch,
} from "@/modules/notifications/outbox";
import { eq } from "drizzle-orm";
import { canonicalizeEmail } from "@/modules/participants/domain/canonical-email";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";

/**
 * BR-REQ-080-02 — the outbox is authoritative and idempotent.
 *
 * Criterion 3 (concurrent workers claim disjoint sets) is NOT covered here and must not be
 * faked. PGlite is single-connection, so it cannot run two transactions at once; a green test
 * written against it would prove that `FOR UPDATE SKIP LOCKED` parses, not that it works.
 * `tests/helpers/db.ts` records the same limit for the capacity work. What is covered below is
 * the claim *predicate*: a claimed row is not offered again.
 */
const NOW = new Date("2026-09-03T10:00:00.000Z");

/** Stands in for BR-REQ-080-01's templates, which do not exist and must not be invented. */
async function render(row: OutboxRow): Promise<OutgoingEmail> {
  return {
    to: row.recipientEmail,
    subject: `test-${row.messageType}`,
    html: `<p>${row.messageType}</p>`,
    text: row.messageType,
    locale: row.locale,
    idempotencyKey: row.idempotencyKey,
  };
}

/** An adapter that records every call and answers however the test needs. */
function recordingSender(result: SendResult | (() => Promise<SendResult>)): EmailSender & {
  readonly calls: OutgoingEmail[];
} {
  const calls: OutgoingEmail[] = [];
  return {
    calls,
    async send(message) {
      calls.push(message);
      return typeof result === "function" ? result() : result;
    },
  };
}

describe("BR-REQ-080-02 transactional outbox", () => {
  let db: TestDatabase;
  let close: () => Promise<void>;
  let participantId: string;

  beforeAll(async () => {
    ({ db, close } = await createTestDatabase());
  });
  afterAll(async () => close());

  beforeEach(async () => {
    await resetTables(db);
    const identity = canonicalizeEmail("ana@example.ro");
    const [participant] = await db
      .insert(participants)
      .values({
        deliveryEmail: identity.deliveryEmail,
        normalizedEmail: identity.normalizedEmail,
        canonicalEmail: identity.canonicalEmail,
        canonicalizationVersion: identity.canonicalizationVersion,
        defaultName: "Ana Pop",
      })
      .returning();
    participantId = participant.id;
  });

  function enqueueParams(overrides: Partial<Parameters<typeof enqueueEmail>[1]> = {}) {
    return {
      participantId,
      registrationId: null,
      messageType: "VERIFY_REGISTRATION_EMAIL" as const,
      locale: "ro" as const,
      recipientEmail: "ana@example.ro",
      payload: { name: "Ana Pop" },
      idempotencyKey: "participant:ana:VERIFY_REGISTRATION_EMAIL",
      now: NOW,
      ...overrides,
    };
  }

  async function queueOne(overrides: Partial<Parameters<typeof enqueueEmail>[1]> = {}) {
    return db.transaction(async (tx) => enqueueEmail(tx, enqueueParams(overrides)));
  }

  describe("criterion 1 — the row commits with the change that triggered it", () => {
    it("commits the message together with the state change", async () => {
      await db.transaction(async (tx) => {
        const identity = canonicalizeEmail("bogdan@example.ro");
        const [created] = await tx
          .insert(participants)
          .values({
            deliveryEmail: identity.deliveryEmail,
            normalizedEmail: identity.normalizedEmail,
            canonicalEmail: identity.canonicalEmail,
            canonicalizationVersion: identity.canonicalizationVersion,
            defaultName: "Bogdan Ionescu",
          })
          .returning();

        await enqueueEmail(
          tx,
          enqueueParams({
            participantId: created.id,
            recipientEmail: identity.deliveryEmail,
            idempotencyKey: "participant:bogdan:VERIFY_REGISTRATION_EMAIL",
          }),
        );
      });

      const rows = await db.select().from(emailOutbox);
      expect(rows).toHaveLength(1);
      expect(rows[0].status).toBe("PENDING");
      expect(rows[0].attemptCount).toBe(0);
      expect(rows[0].sentAt).toBeNull();
    });

    it("queues nothing when the transaction that triggered it rolls back", async () => {
      await expect(
        db.transaction(async (tx) => {
          const identity = canonicalizeEmail("carmen@example.ro");
          const [created] = await tx
            .insert(participants)
            .values({
              deliveryEmail: identity.deliveryEmail,
              normalizedEmail: identity.normalizedEmail,
              canonicalEmail: identity.canonicalEmail,
              canonicalizationVersion: identity.canonicalizationVersion,
              defaultName: "Carmen Radu",
            })
            .returning();

          await enqueueEmail(tx, enqueueParams({ participantId: created.id }));

          // Whatever fails after the message is queued: a constraint, a capacity refusal, a
          // deploy. The participant must not receive mail about something that did not happen.
          throw new Error("the registration was refused after the message was queued");
        }),
      ).rejects.toThrow(/refused after the message was queued/);

      expect(await db.select().from(emailOutbox)).toHaveLength(0);
      // And the participant is gone too — one transaction, one outcome.
      expect(await db.select().from(participants)).toHaveLength(1);
    });

    it("calls no provider while the transaction is open", async () => {
      const capture = createCaptureAdapter();

      await db.transaction(async (tx) => {
        await enqueueEmail(tx, enqueueParams());
        // Nothing in `enqueueEmail`'s signature can reach an adapter: it takes a transaction,
        // a payload and a key. This asserts the consequence.
        expect(capture.messages).toHaveLength(0);
      });

      expect(capture.messages).toHaveLength(0);
    });

    it("is idempotent for one trigger", async () => {
      const first = await queueOne();
      const second = await queueOne();

      expect(first).not.toBeNull();
      // Not an error: two code paths reacting to one state change is normal.
      expect(second).toBeNull();
      expect(await db.select().from(emailOutbox)).toHaveLength(1);
    });

    it("gives a deliberate resend its own row", async () => {
      await queueOne();
      const resend = await queueOne({
        idempotencyKey: "participant:ana:VERIFY_REGISTRATION_EMAIL:resend:1",
        isManualResend: true,
      });

      expect(resend).not.toBeNull();
      expect(resend?.isManualResend).toBe(true);
      expect(await db.select().from(emailOutbox)).toHaveLength(2);
    });
  });

  describe("sending happens outside the transaction", () => {
    it("marks a delivered message SENT with the provider's id", async () => {
      await queueOne();
      const capture = createCaptureAdapter();
      const sender = createEmailSender({
        appEnv: "test",
        mode: "capture",
        allowlist: [],
        capture,
        live: () => {
          throw new Error("live delivery must not be constructed in test");
        },
      });

      const summary = await processOutboxBatch(db, { sender, render, now: NOW });

      expect(summary).toEqual({ claimed: 1, sent: 1, retrying: 0, failed: 0, bounced: 0 });
      const [row] = await db.select().from(emailOutbox);
      expect(row.status).toBe("SENT");
      expect(row.sentAt).toEqual(NOW);
      expect(row.attemptCount).toBe(1);
      expect(row.lockedAt).toBeNull();
      expect(row.providerMessageId).toMatch(/^capture:/);
      expect(capture.messages).toHaveLength(1);
      expect(capture.messages[0].to).toBe("ana@example.ro");
    });

    it("does not offer a message that is already sent", async () => {
      await queueOne();
      const sender = recordingSender({ outcome: "sent", providerMessageId: "provider:1" });

      await processOutboxBatch(db, { sender, render, now: NOW });
      const second = await processOutboxBatch(db, { sender, render, now: NOW });

      expect(second.claimed).toBe(0);
      expect(sender.calls).toHaveLength(1);
    });
  });

  describe("criterion 2 — a provider failure changes no committed state and is retried", () => {
    it("leaves the row PENDING with a bounded next attempt", async () => {
      await queueOne();
      const sender = recordingSender({ outcome: "transient_failure", error: "502 bad gateway" });

      const summary = await processOutboxBatch(db, { sender, render, now: NOW });

      expect(summary).toEqual({ claimed: 1, sent: 0, retrying: 1, failed: 0, bounced: 0 });
      const [row] = await db.select().from(emailOutbox);
      expect(row.status).toBe("PENDING");
      expect(row.attemptCount).toBe(1);
      expect(row.nextAttemptAt).toEqual(new Date(NOW.getTime() + 60_000));
      expect(row.lastError).toBe("502 bad gateway");
      expect(row.sentAt).toBeNull();
      expect(row.lockedAt).toBeNull();
    });

    it("leaves the state change that triggered the message untouched", async () => {
      const before = await db.select().from(participants);
      await queueOne();
      const sender = recordingSender({ outcome: "transient_failure", error: "502 bad gateway" });

      await processOutboxBatch(db, { sender, render, now: NOW });

      // The database is authoritative when Mailgun fails (AGENTS.md §16.1).
      expect(await db.select().from(participants)).toEqual(before);
    });

    it("does not retry before the backoff has elapsed", async () => {
      await queueOne();
      const sender = recordingSender({ outcome: "transient_failure", error: "502" });

      await processOutboxBatch(db, { sender, render, now: NOW });
      const tooSoon = await processOutboxBatch(db, {
        sender,
        render,
        now: new Date(NOW.getTime() + 30_000),
      });
      const later = await processOutboxBatch(db, {
        sender,
        render,
        now: new Date(NOW.getTime() + 61_000),
      });

      expect(tooSoon.claimed).toBe(0);
      expect(later.claimed).toBe(1);
      expect(sender.calls).toHaveLength(2);
    });

    it("gives up at the attempt ceiling instead of retrying forever", async () => {
      await queueOne();
      const sender = recordingSender({ outcome: "transient_failure", error: "502" });
      let clock = NOW;

      for (let attempt = 1; attempt <= MAX_SEND_ATTEMPTS; attempt += 1) {
        const summary = await processOutboxBatch(db, { sender, render, now: clock });
        expect(summary.claimed).toBe(1);
        const [row] = await db.select().from(emailOutbox);
        clock = new Date((row.nextAttemptAt ?? clock).getTime() + 1000);
      }

      const [row] = await db.select().from(emailOutbox);
      expect(row.status).toBe("FAILED");
      expect(row.attemptCount).toBe(MAX_SEND_ATTEMPTS);
      expect(row.nextAttemptAt).toBeNull();

      // A FAILED row is terminal: no worker picks it up again.
      const after = await processOutboxBatch(db, { sender, render, now: clock });
      expect(after.claimed).toBe(0);
    });

    it("treats an adapter that throws as transient", async () => {
      await queueOne();
      const sender: EmailSender = {
        async send() {
          throw new Error("socket hang up");
        },
      };

      const summary = await processOutboxBatch(db, { sender, render, now: NOW });

      expect(summary.retrying).toBe(1);
      const [row] = await db.select().from(emailOutbox);
      expect(row.status).toBe("PENDING");
      expect(row.lastError).toBe("socket hang up");
    });

    it("stores a sanitized reason, never a token", async () => {
      await queueOne();
      const secret = "hQ2v_xR8tL-3mZpK9wFj0aBcDeFgHiJkLmNoPqRsTuV";
      const sender = recordingSender({
        outcome: "transient_failure",
        error: `rejected: /ro/actiune/${secret}`,
      });

      await processOutboxBatch(db, { sender, render, now: NOW });

      const [row] = await db.select().from(emailOutbox);
      expect(row.lastError).not.toContain(secret);
      expect(row.lastError).toContain("[redacted]");
    });
  });

  describe("criterion 4 — a permanent failure is not retried", () => {
    it("marks the row BOUNCED and schedules nothing", async () => {
      await queueOne();
      const sender = recordingSender({
        outcome: "permanent_failure",
        error: "550 5.1.1 no such user",
      });

      const summary = await processOutboxBatch(db, { sender, render, now: NOW });

      expect(summary).toEqual({ claimed: 1, sent: 0, retrying: 0, failed: 0, bounced: 1 });
      const [row] = await db.select().from(emailOutbox);
      expect(row.status).toBe("BOUNCED");
      expect(row.nextAttemptAt).toBeNull();
      expect(row.lastError).toBe("550 5.1.1 no such user");

      const after = await processOutboxBatch(db, { sender, render, now: NOW });
      expect(after.claimed).toBe(0);
      expect(sender.calls).toHaveLength(1);
    });

    it("fails a message whose template throws, without spending six attempts on it", async () => {
      await queueOne();
      const sender = recordingSender({ outcome: "sent", providerMessageId: "provider:1" });

      const summary = await processOutboxBatch(db, {
        sender,
        render: () => {
          throw new Error("no template for this message type");
        },
        now: NOW,
      });

      expect(summary.failed).toBe(1);
      expect(sender.calls).toHaveLength(0);
      const [row] = await db.select().from(emailOutbox);
      expect(row.status).toBe("FAILED");
      expect(row.lastError).toBe("no template for this message type");
    });
  });

  describe("claiming", () => {
    it("takes the oldest messages first, up to the batch size", async () => {
      for (let i = 0; i < 3; i += 1) {
        await queueOne({
          idempotencyKey: `message:${i}`,
          now: new Date(NOW.getTime() + i * 1000),
        });
      }

      const claimed = await claimOutboxBatch(db, { now: NOW, batchSize: 2 });

      expect(claimed).toHaveLength(2);
      expect(claimed.map((row) => row.idempotencyKey)).toEqual(["message:0", "message:1"]);
      expect(claimed.every((row) => row.status === "PROCESSING")).toBe(true);
      expect(claimed.every((row) => row.attemptCount === 1)).toBe(true);
    });

    it("does not offer a row it has already claimed", async () => {
      await queueOne();

      const first = await claimOutboxBatch(db, { now: NOW, batchSize: 10 });
      const second = await claimOutboxBatch(db, { now: NOW, batchSize: 10 });

      expect(first).toHaveLength(1);
      expect(second).toHaveLength(0);
    });

    it("reclaims a row whose worker died holding it", async () => {
      await queueOne();
      await claimOutboxBatch(db, { now: NOW, batchSize: 10 });

      const beforeTimeout = await claimOutboxBatch(db, {
        now: new Date(NOW.getTime() + 299_000),
        batchSize: 10,
      });
      const afterTimeout = await claimOutboxBatch(db, {
        now: new Date(NOW.getTime() + 301_000),
        batchSize: 10,
      });

      expect(beforeTimeout).toHaveLength(0);
      expect(afterTimeout).toHaveLength(1);
      // The stranded attempt still counted, so a message that kills its worker cannot loop.
      expect(afterTimeout[0].attemptCount).toBe(2);
    });
  });

  describe("AGENTS.md §16.5 Mailgun delivery webhook", () => {
    async function queueSent(providerMessageId: string) {
      const row = await queueOne({ idempotencyKey: `provider:${providerMessageId}` });
      await db
        .update(emailOutbox)
        .set({ status: "SENT", sentAt: NOW, providerMessageId })
        .where(eq(emailOutbox.id, row!.id));
      return row!.id;
    }

    it("marks the row COMPLAINED on a complaint event", async () => {
      const id = await queueSent("mailgun-msg-1");
      await applyMailgunEvent(db, { providerMessageId: "mailgun-msg-1", event: "complained", reason: null });

      const [row] = await db.select().from(emailOutbox).where(eq(emailOutbox.id, id));
      expect(row.status).toBe("COMPLAINED");
    });

    it("marks the row BOUNCED on a permanent failure, with the sanitized reason recorded", async () => {
      const id = await queueSent("mailgun-msg-2");
      await applyMailgunEvent(db, {
        providerMessageId: "mailgun-msg-2",
        event: "permanent_fail",
        reason: "mailbox does not exist",
      });

      const [row] = await db.select().from(emailOutbox).where(eq(emailOutbox.id, id));
      expect(row.status).toBe("BOUNCED");
      expect(row.lastError).toBe("mailbox does not exist");
    });

    it("leaves the row untouched for delivery/engagement events this schema does not track", async () => {
      const id = await queueSent("mailgun-msg-3");

      for (const event of ["delivered", "opened", "clicked", "unsubscribed", "temporary_fail"] as const) {
        await applyMailgunEvent(db, { providerMessageId: "mailgun-msg-3", event, reason: null });
      }

      const [row] = await db.select().from(emailOutbox).where(eq(emailOutbox.id, id));
      expect(row.status).toBe("SENT");
    });

    it("is idempotent: the same event applied twice leaves the same terminal state", async () => {
      const id = await queueSent("mailgun-msg-4");
      await applyMailgunEvent(db, { providerMessageId: "mailgun-msg-4", event: "permanent_fail", reason: "bounce" });
      await applyMailgunEvent(db, { providerMessageId: "mailgun-msg-4", event: "permanent_fail", reason: "bounce" });

      const [row] = await db.select().from(emailOutbox).where(eq(emailOutbox.id, id));
      expect(row.status).toBe("BOUNCED");
    });

    it("does nothing for an unknown provider message id", async () => {
      await expect(
        applyMailgunEvent(db, { providerMessageId: "no-such-id", event: "complained", reason: null }),
      ).resolves.toBeUndefined();
    });
  });
});
