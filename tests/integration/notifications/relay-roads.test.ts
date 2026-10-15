import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { emailOutbox } from "@/db/schema/email-outbox";
import type { EmailAdapter, OutgoingEmail, SendResult } from "@/infrastructure/email/adapter";
import { platformSettings } from "@/db/schema/platform-settings";
import { DEFAULT_EMAIL_TRANSPORT, GMAIL_CAP_DEFERRED_ERROR } from "@/modules/notifications/domain/email-transport";
import { EMAIL_TRANSPORT_SETTING_KEY } from "@/modules/notifications/email-transport";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";

/**
 * §NNN — `createRelayRoads`, the production wiring of the two roads, over the real sender, the real ledger and the
 * real road state, with only the Gmail adapter (the SMTP connection) stood in for. Every other relay test uses
 * `fakeRoads`, which is how a road state that said «gmail is not taking messages in this batch» instead of the code
 * (`smtp EAUTH`) went unnoticed: this is where the wiring is read.
 */
const state = vi.hoisted(() => ({ gmail: [] as SendResult[], sent: [] as OutgoingEmail[] }));

vi.mock("@/shared/config/env", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/shared/config/env")>();
  return {
    env: {
      ...actual.env,
      APP_ENV: "production",
      EMAIL_DELIVERY_MODE: "live",
      MAILGUN_API_KEY: "key-for-the-test",
      MAILGUN_DOMAIN: "mail.example.org",
      MAILGUN_API_BASE_URL: "https://api.example.org",
      CONTACT_SMTP_USER: "club@example.org",
      CONTACT_SMTP_PASSWORD: "an-app-password",
    },
  };
});
vi.mock("@/infrastructure/email/gmail-adapter", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/infrastructure/email/gmail-adapter")>();
  return {
    ...actual,
    createGmailAdapter: (): EmailAdapter => ({
      async send(message) {
        state.sent.push(message);
        return state.gmail.shift() ?? { outcome: "sent", providerMessageId: "gmail:ok", transport: "gmail", recipients: 1 };
      },
      close() {},
    }),
  };
});

const { createRelayRoads } = await import("@/modules/notifications/relay-roads");
const { readRoadStates } = await import("@/modules/notifications/road-status");
const { recordMailgunStop } = await import("@/modules/notifications/mailgun-stop");

const MESSAGE: OutgoingEmail = { to: "club@example.org", subject: "s", text: "t", html: "t", locale: "ro", idempotencyKey: "relay:k" };

describe("§NNN createRelayRoads: the two roads as the relay uses them", () => {
  let db: TestDatabase;
  let close: () => Promise<void>;

  beforeAll(async () => {
    ({ db, close } = await createTestDatabase());
  });
  afterAll(async () => close());
  beforeEach(async () => {
    await resetTables(db);
    // No pace between two Gmail sends: the test is about the wiring, not about waiting six seconds.
    await db.insert(platformSettings).values({ key: EMAIL_TRANSPORT_SETTING_KEY, value: { ...DEFAULT_EMAIL_TRANSPORT, gmailPaceSeconds: 0 }, updatedAt: new Date() });
    state.gmail = [];
    state.sent = [];
  });

  it("a refused login is a transient failure that says its code, and the road's state keeps that code", async () => {
    state.gmail = [{ outcome: "transient_failure", error: "gmail: smtp EAUTH" }];
    const roads = await createRelayRoads(db);
    try {
      const first = await roads.send("gmail", MESSAGE);
      expect(first).toEqual({ outcome: "transient_failure", error: "gmail: smtp EAUTH" });
      expect((await readRoadStates(db)).gmail.lastError).toBe("gmail: smtp EAUTH");

      // The next message of the batch is «not taken» by the same sender: it says the same code, and the state is not overwritten by the generic phrase.
      const second = await roads.send("gmail", { ...MESSAGE, idempotencyKey: "relay:k2" });
      expect(second).toEqual({ outcome: "transient_failure", error: "gmail: smtp EAUTH" });
      const gmail = (await readRoadStates(db)).gmail;
      expect(gmail.lastError).toBe("gmail: smtp EAUTH");
      expect(gmail.failingSince).not.toBeNull();
      expect(state.sent).toHaveLength(1);
    } finally {
      roads.close?.();
    }
  });

  it("a failure before Gmail could have taken the message is not ambiguous; one after it may have is", async () => {
    state.gmail = [{ outcome: "transient_failure", error: "gmail: smtp ETIMEDOUT" }];
    const before = await createRelayRoads(db);
    try {
      const result = await before.send("gmail", MESSAGE);
      expect(result).toMatchObject({ outcome: "transient_failure", error: "gmail: smtp ETIMEDOUT" });
      expect(result).not.toHaveProperty("mayHaveBeenAccepted");
    } finally {
      before.close?.();
    }

    state.gmail = [{ outcome: "transient_failure", error: "gmail: smtp ETIMEDOUT", mayHaveBeenAccepted: true }];
    const after = await createRelayRoads(db);
    try {
      expect(await after.send("gmail", MESSAGE)).toMatchObject({ outcome: "transient_failure", mayHaveBeenAccepted: true });
    } finally {
      after.close?.();
    }
  });

  it("Gmail's own daily cap comes back as a throttle with a time, and is not a failure of the road", async () => {
    await db.insert(emailOutbox).values({
      messageType: "CONTACT_MESSAGE",
      locale: "ro",
      recipientEmail: "club@example.org",
      payloadJson: { deleted: true },
      idempotencyKey: "relay:spent",
      status: "SENT",
      transport: "gmail",
      recipientCount: 100_000,
      sentAt: new Date(),
    });
    const roads = await createRelayRoads(db);
    try {
      const result = await roads.send("gmail", MESSAGE);
      expect(result).toMatchObject({ outcome: "throttled", error: GMAIL_CAP_DEFERRED_ERROR });
      expect(state.sent).toHaveLength(0);
      expect((await readRoadStates(db)).gmail).toEqual({ failingSince: null, lastFailureAt: null, lastError: null });
    } finally {
      roads.close?.();
    }
  });

  it("a road that carries a message clears its failing run", async () => {
    state.gmail = [{ outcome: "transient_failure", error: "gmail: smtp EAUTH" }];
    const failing = await createRelayRoads(db);
    await failing.send("gmail", MESSAGE);
    failing.close?.();
    expect((await readRoadStates(db)).gmail.failingSince).not.toBeNull();

    const working = await createRelayRoads(db);
    try {
      expect(await working.send("gmail", { ...MESSAGE, idempotencyKey: "relay:k3" })).toMatchObject({ outcome: "sent", transport: "gmail" });
    } finally {
      working.close?.();
    }
    expect((await readRoadStates(db)).gmail.failingSince).toBeNull();
  });

  it("both roads exist here, and Mailgun is not available while a stop of its own is in force", async () => {
    const roads = await createRelayRoads(db);
    const now = new Date();
    expect(await roads.available(now)).toEqual({ gmail: true, mailgun: true });

    await recordMailgunStop(db, { kind: "allowance", until: new Date(now.getTime() + 3_600_000) }, now);
    expect(await roads.available(now)).toEqual({ gmail: true, mailgun: false });
    // The stop ends: the road opens again.
    expect(await roads.available(new Date(now.getTime() + 2 * 3_600_000))).toEqual({ gmail: true, mailgun: true });
  });
});
