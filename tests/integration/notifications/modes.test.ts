import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { emailOutbox } from "@/db/schema/email-outbox";
import { participants } from "@/db/schema/participants";
import type { OutgoingEmail } from "@/infrastructure/email/adapter";
import { EmailProviderNotWiredError } from "@/infrastructure/email/mailgun-adapter";
import { createEmailSenderForEnvironment } from "@/infrastructure/email/sender";
import { enqueueEmail, type OutboxRow, processOutboxBatch } from "@/modules/notifications/outbox";
import { canonicalizeEmail } from "@/modules/participants/domain/canonical-email";
import { envSchema } from "@/shared/config/env";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";

/**
 * BR-REQ-080-03 — environment-appropriate delivery.
 *
 * The rule these protect is the one that cannot be undone: a message that reaches a real
 * person from a system that was not supposed to reach anyone. Criteria 1 and 2 run a real
 * batch through the outbox; criterion 3 asserts that the configuration is refused before a
 * process starts at all.
 */
const NOW = new Date("2026-09-03T10:00:00.000Z");

const MAILGUN = { MAILGUN_API_KEY: "key-not-a-real-key", MAILGUN_DOMAIN: "mail.example.test" };

async function render(row: OutboxRow): Promise<OutgoingEmail> {
  return {
    to: row.recipientEmail,
    subject: "Confirmă-ți înscrierea",
    html: "<p>…</p>",
    text: "…",
    locale: row.locale,
    idempotencyKey: row.idempotencyKey,
  };
}

describe("BR-REQ-080-03 environment-appropriate delivery", () => {
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

  async function queue(recipientEmail: string, idempotencyKey: string) {
    await db.transaction(async (tx) =>
      enqueueEmail(tx, {
        participantId,
        registrationId: null,
        messageType: "VERIFY_REGISTRATION_EMAIL",
        locale: "ro",
        recipientEmail,
        payload: {},
        idempotencyKey,
        now: NOW,
      }),
    );
  }

  describe("criterion 1 — local and test capture, and never transmit", () => {
    for (const APP_ENV of ["local", "test"] as const) {
      it(`captures every message in ${APP_ENV}`, async () => {
        await queue("ana@example.ro", "message:1");
        const config = envSchema.parse({ APP_ENV });
        const { sender, capture } = createEmailSenderForEnvironment(config);

        const summary = await processOutboxBatch(db, { sender, render, now: NOW });

        expect(summary.sent).toBe(1);
        expect(capture.messages).toHaveLength(1);
        expect(capture.lastTo("ana@example.ro")?.subject).toBe("Confirmă-ți înscrierea");
        const [row] = await db.select().from(emailOutbox);
        expect(row.status).toBe("SENT");
        expect(row.providerMessageId).toMatch(/^capture:/);
      });
    }

    it("defaults to capture when nothing is configured", () => {
      expect(envSchema.parse({}).EMAIL_DELIVERY_MODE).toBe("capture");
    });
  });

  describe("criterion 2 — QA is captured or allowlisted, and visibly marked", () => {
    it("marks the subject of a QA message", async () => {
      await queue("ana@example.ro", "message:1");
      const config = envSchema.parse({ APP_ENV: "qa" });
      const { sender, capture } = createEmailSenderForEnvironment(config);

      await processOutboxBatch(db, { sender, render, now: NOW });

      expect(capture.messages[0].subject).toBe("[QA] Confirmă-ți înscrierea");
    });

    it("captures a QA address that is not on the allowlist", async () => {
      await queue("stranger@example.ro", "message:1");
      const config = envSchema.parse({
        APP_ENV: "qa",
        EMAIL_DELIVERY_MODE: "allowlist",
        EMAIL_ALLOWLIST: "qa.tester@example.ro",
        ...MAILGUN,
      });
      const { sender, capture } = createEmailSenderForEnvironment(config);

      const summary = await processOutboxBatch(db, { sender, render, now: NOW });

      // A synthetic QA participant must not be mailed by the test system.
      expect(summary.sent).toBe(1);
      expect(capture.messages).toHaveLength(1);
      expect(capture.messages[0].to).toBe("stranger@example.ro");
    });

    it("attempts real delivery only for an allowlisted address", async () => {
      await queue("qa.tester@example.ro", "message:1");
      const config = envSchema.parse({
        APP_ENV: "qa",
        EMAIL_DELIVERY_MODE: "allowlist",
        EMAIL_ALLOWLIST: "qa.tester@example.ro",
        ...MAILGUN,
      });
      const { sender, capture } = createEmailSenderForEnvironment(config);

      const summary = await processOutboxBatch(db, { sender, render, now: NOW });

      // Mailgun is not wired, so the attempt fails loudly rather than vanishing. That the
      // attempt happened at all is what this asserts: the allowlist opened the door.
      expect(capture.messages).toHaveLength(0);
      expect(summary.retrying).toBe(1);
      const [row] = await db.select().from(emailOutbox);
      expect(row.status).toBe("PENDING");
      expect(row.lastError).toContain("not wired");
    });

    it("parses a comma-separated allowlist and trims it", () => {
      const config = envSchema.parse({
        APP_ENV: "qa",
        EMAIL_DELIVERY_MODE: "allowlist",
        EMAIL_ALLOWLIST: " qa.tester@example.ro , ana@gmail.com ,",
        ...MAILGUN,
      });

      expect(config.EMAIL_ALLOWLIST).toEqual(["qa.tester@example.ro", "ana@gmail.com"]);
    });
  });

  describe("criterion 3 — an unsafe combination fails at startup", () => {
    it("refuses live delivery outside production", () => {
      for (const APP_ENV of ["local", "test", "qa"] as const) {
        expect(() =>
          envSchema.parse({ APP_ENV, EMAIL_DELIVERY_MODE: "live", ...MAILGUN }),
        ).toThrow(/live email delivery is only permitted when APP_ENV=production/);
      }
    });

    it("refuses anything but capture in local and test", () => {
      for (const APP_ENV of ["local", "test"] as const) {
        expect(() =>
          envSchema.parse({
            APP_ENV,
            EMAIL_DELIVERY_MODE: "allowlist",
            EMAIL_ALLOWLIST: "ana@example.ro",
            ...MAILGUN,
          }),
        ).toThrow(/must capture email/);
      }
    });

    it("refuses allowlist mode with an empty allowlist", () => {
      expect(() =>
        envSchema.parse({ APP_ENV: "qa", EMAIL_DELIVERY_MODE: "allowlist", ...MAILGUN }),
      ).toThrow(/EMAIL_ALLOWLIST/);
    });

    it("refuses an allowlist entry that is not an address", () => {
      const result = envSchema.safeParse({
        APP_ENV: "qa",
        EMAIL_DELIVERY_MODE: "allowlist",
        EMAIL_ALLOWLIST: "qa.tester@example.ro, not-an-address",
        ...MAILGUN,
      });

      expect(result.success).toBe(false);
      // The offending entry is named: it is configuration an operator typed, not participant
      // data, so naming it is what makes the failure fixable.
      expect(result.error?.issues.map((issue) => issue.message)).toEqual([
        'EMAIL_ALLOWLIST entry is not a valid address: "not-an-address".',
      ]);
    });

    it("refuses a transmitting mode without provider credentials", () => {
      expect(() =>
        envSchema.parse({
          APP_ENV: "qa",
          EMAIL_DELIVERY_MODE: "allowlist",
          EMAIL_ALLOWLIST: "qa.tester@example.ro",
        }),
      ).toThrow(/requires MAILGUN_API_KEY and MAILGUN_DOMAIN/);

      expect(() =>
        envSchema.parse({
          APP_ENV: "production",
          EMAIL_DELIVERY_MODE: "live",
          MAILGUN_API_KEY: "key-not-a-real-key",
        }),
      ).toThrow(/requires MAILGUN_API_KEY and MAILGUN_DOMAIN/);
    });

    it("accepts the combinations AGENTS.md §7.2 permits", () => {
      expect(() => envSchema.parse({ APP_ENV: "local" })).not.toThrow();
      expect(() => envSchema.parse({ APP_ENV: "test" })).not.toThrow();
      expect(() => envSchema.parse({ APP_ENV: "qa" })).not.toThrow();
      expect(() =>
        envSchema.parse({
          APP_ENV: "qa",
          EMAIL_DELIVERY_MODE: "allowlist",
          EMAIL_ALLOWLIST: "qa.tester@example.ro",
          ...MAILGUN,
        }),
      ).not.toThrow();
      expect(() =>
        envSchema.parse({ APP_ENV: "production", EMAIL_DELIVERY_MODE: "live", ...MAILGUN }),
      ).not.toThrow();
    });

    it("says what is missing when live delivery is configured but not wired", async () => {
      const config = envSchema.parse({
        APP_ENV: "production",
        EMAIL_DELIVERY_MODE: "live",
        ...MAILGUN,
      });
      const { sender } = createEmailSenderForEnvironment(config);

      // Constructing the sender is safe; reaching for the provider is what fails, and it
      // fails with the reason rather than by dropping the message.
      await expect(
        sender.send({
          to: "ana@example.ro",
          subject: "s",
          html: "<p>…</p>",
          text: "…",
          locale: "ro",
          idempotencyKey: "message:1",
        }),
      ).rejects.toThrow(EmailProviderNotWiredError);
    });
  });
});
