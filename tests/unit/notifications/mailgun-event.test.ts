import { createHmac } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { deliveryEventOf, deliveryStatusOf, taggedForAnotherEnvironment } from "@/modules/notifications/mailgun-event";

/**
 * BR-REQ-080-04 (§NNN; AGENTS.md §16.5) — what the delivery webhook keeps of a Mailgun event: the kind, the
 * instant, whom it is about, the codes and the redacted words, Mailgun's one word, the row's own key; every
 * field may be missing. And the route answers another deployment's event without touching the database.
 */
const NOW = new Date("2026-10-08T10:00:00.000Z");

const mocked = vi.hoisted(() => ({ getDb: vi.fn(() => ({})), applyMailgunEvent: vi.fn<(...args: unknown[]) => Promise<undefined>>(async () => undefined) }));
vi.mock("@/db/client", () => ({ getDb: () => mocked.getDb() }));
vi.mock("@/modules/notifications/outbox", () => ({ applyMailgunEvent: (...args: unknown[]) => mocked.applyMailgunEvent(...args) }));
vi.mock("@/shared/config/env", () => ({ env: { MAILGUN_WEBHOOK_SIGNING_KEY: "test-signing-key-not-a-real-secret", APP_ENV: "production" } }));

function failed(overrides: Record<string, unknown> = {}) {
  return {
    "event-data": {
      event: "failed",
      severity: "permanent",
      reason: "bounce",
      timestamp: 1_791_450_000.375,
      recipient: "ana.popescu@example.com",
      tags: ["locale:ro", "env:production"],
      message: { headers: { "message-id": "20261008.abc@mail.example.org" } },
      "user-variables": { idempotency_key: "registration:1:confirmed" },
      "delivery-status": {
        code: 550,
        "enhanced-code": "5.1.1",
        message: "5.1.1 <ana.popescu@example.com>: user ana.popescu unknown",
        "mx-host": "mx.example.com",
        description: "",
      },
      envelope: { "sending-ip": "192.0.2.10" },
      ...overrides,
    },
  };
}

describe("deliveryEventOf", () => {
  it("keeps the kind, the instant, the recipient, the codes and the redacted words — never the MX host or the IP", () => {
    const event = deliveryEventOf(failed(), NOW);
    expect(event).toMatchObject({
      providerMessageId: "20261008.abc@mail.example.org",
      idempotencyKey: "registration:1:confirmed",
      event: "failed",
      severity: "permanent",
      reason: "bounce",
      recipient: "ana.popescu@example.com",
      code: "550 5.1.1",
      cause: "no-such-address",
    });
    expect(event?.occurredAt?.toISOString()).toBe(new Date(1_791_450_000_375).toISOString());
    expect(event?.detail).toContain("unknown");
    for (const secret of ["ana.popescu", "example.com", "mx.example.com", "192.0.2.10"]) expect(JSON.stringify({ ...event, recipient: null })).not.toContain(secret);
  });

  it("reads the cause from the server's words before the redactor takes a name out of them", () => {
    // A mailbox called «user»: redacted, «User unknown» would read «<address> unknown» and lose its cause.
    const event = deliveryEventOf(failed({ recipient: "user@example.com", "delivery-status": { code: 550, message: "User unknown" } }), NOW);
    expect(event?.detail).toBe("<address> unknown");
    expect(event?.cause).toBe("no-such-address");
  });

  it("reads a final «old» by the last deferral's code and words", () => {
    const status = deliveryStatusOf(
      { "delivery-status": { code: 602, message: "", description: "Too old", "last-code": 452, "last-message": "4.2.2 over quota" } },
      "ana@example.com",
    );
    expect(status.code).toBe("602");
    const old = deliveryEventOf(
      failed({ reason: "old", "delivery-status": { code: null, message: "", description: "", "last-code": 452, "last-message": "4.2.2 The email account is over quota" } }),
      NOW,
    );
    expect(old?.code).toBe("452 4.2.2");
    expect(old?.cause).toBe("mailbox-full");
  });

  it("reads Yahoo's final «old» after [TSS04] deferrals as a give-up, and Yahoo's missing account as no such address", () => {
    const old = deliveryEventOf(
      failed({
        reason: "old",
        "delivery-status": {
          code: 421,
          message: "421 4.7.0 [TSS04] Messages from 192.0.2.10 temporarily deferred due to unexpected volume or user complaints - 4.16.55.1",
          description: "",
        },
      }),
      NOW,
    );
    expect(old?.code).toBe("421 4.7.0");
    expect(old?.cause).toBe("gave-up");
    const noAccount = deliveryEventOf(
      failed({
        recipient: "ana.popescu@yahoo.com",
        "delivery-status": { code: 554, message: "delivery error: dd This user doesn't have a yahoo.com account (ana.popescu@yahoo.com) [0] - mta1234.mail.bf1.yahoo.com" },
      }),
      NOW,
    );
    expect(noAccount?.cause).toBe("no-such-address");
    expect(noAccount?.detail).not.toContain("ana.popescu");
  });

  it("tolerates every field missing, and names no message without an id or a key", () => {
    expect(deliveryEventOf({}, NOW)).toBeNull();
    expect(deliveryEventOf({ "event-data": { event: "delivered" } }, NOW)).toBeNull();
    const bare = deliveryEventOf({ "event-data": { event: "complained", message: { headers: { "message-id": "m-1" } } } }, NOW);
    expect(bare).toMatchObject({ providerMessageId: "m-1", event: "complained", reason: null, recipient: null, occurredAt: null, code: null, detail: null, cause: "complained" });
    const byKey = deliveryEventOf({ "event-data": { event: "delivered", "user-variables": { idempotency_key: "k-1" } } }, NOW);
    expect(byKey).toMatchObject({ providerMessageId: null, idempotencyKey: "k-1" });
  });

  it("keeps Mailgun's one word as it is, and redacts anything longer", () => {
    expect(deliveryEventOf(failed({ reason: "suppress-bounce" }), NOW)?.reason).toBe("suppress-bounce");
    expect(deliveryEventOf(failed({ reason: "refused for ana.popescu@example.com" }), NOW)?.reason).toBe("refused for <address>");
  });
});

describe("taggedForAnotherEnvironment", () => {
  it("is another deployment's only when its tags name one and not this one", () => {
    expect(taggedForAnotherEnvironment(["locale:ro", "env:qa"], "production")).toBe(true);
    expect(taggedForAnotherEnvironment(["locale:ro", "env:production"], "production")).toBe(false);
    // A message sent before the tag existed is everyone's, as every event was before.
    expect(taggedForAnotherEnvironment(["locale:ro"], "production")).toBe(false);
    expect(taggedForAnotherEnvironment(undefined, "production")).toBe(false);
  });
});

describe("the webhook route", () => {
  const signingKey = "test-signing-key-not-a-real-secret";
  const { getDb, applyMailgunEvent } = mocked;

  beforeEach(() => {
    getDb.mockClear();
    applyMailgunEvent.mockClear();
  });

  function signed(body: Record<string, unknown>): Request {
    const timestamp = String(Math.floor(Date.now() / 1000));
    const token = "t".repeat(50);
    const signature = createHmac("sha256", signingKey).update(timestamp + token).digest("hex");
    return new Request("http://localhost/api/webhooks/mailgun", { method: "POST", body: JSON.stringify({ signature: { timestamp, token, signature }, ...body }) });
  }

  it("answers another deployment's event without touching the database", async () => {
    const { POST } = await import("@/app/api/webhooks/mailgun/route");
    const response = await POST(signed(failed({ tags: ["locale:ro", "env:qa"] })));
    expect(response.status).toBe(200);
    expect(getDb).not.toHaveBeenCalled();
    expect(applyMailgunEvent).not.toHaveBeenCalled();
  });

  it("applies its own deployment's event, read and redacted", async () => {
    const { POST } = await import("@/app/api/webhooks/mailgun/route");
    const response = await POST(signed(failed()));
    expect(response.status).toBe(200);
    expect(applyMailgunEvent).toHaveBeenCalledTimes(1);
    const [, event] = applyMailgunEvent.mock.calls[0] as unknown as [unknown, { code: string; detail: string }];
    expect(event.code).toBe("550 5.1.1");
    expect(event.detail).not.toContain("ana.popescu");
  });
});
