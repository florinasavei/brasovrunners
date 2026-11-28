import { beforeEach, describe, expect, it, vi } from "vitest";

/** AGENTS.md §16.5 — the Azure delivery webhook (`docs/AZURE.md` Part 1): the key, the handshake, the events. */
const KEY = "k".repeat(40);
const mocked = vi.hoisted(() => ({ getDb: vi.fn(() => ({})), applyMailgunEvent: vi.fn(async () => {}) }));
vi.mock("@/db/client", () => ({ getDb: () => mocked.getDb() }));
vi.mock("@/modules/notifications/outbox", () => ({ applyMailgunEvent: (...args: unknown[]) => mocked.applyMailgunEvent(...(args as [])) }));
vi.mock("@/shared/config/env", () => ({ env: { ACS_WEBHOOK_KEY: "k".repeat(40), APP_ENV: "production" } }));

const { POST } = await import("@/app/api/webhooks/acs/route");

function post(body: unknown, key: string | null = KEY): Request {
  const url = `http://localhost/api/webhooks/acs${key === null ? "" : `?key=${key}`}`;
  return new Request(url, { method: "POST", body: JSON.stringify(body) });
}

describe("the Azure delivery webhook", () => {
  beforeEach(() => {
    mocked.getDb.mockClear();
    mocked.applyMailgunEvent.mockClear();
  });

  it("refuses a request without the key, or with another one, before reading anything", async () => {
    expect((await POST(post([], null))).status).toBe(401);
    expect((await POST(post([], "x".repeat(40)))).status).toBe(401);
    expect(mocked.getDb).not.toHaveBeenCalled();
  });

  it("answers Event Grid's handshake with its code", async () => {
    const response = await POST(post([{ eventType: "Microsoft.EventGrid.SubscriptionValidationEvent", data: { validationCode: "CODE-7" } }]));
    expect(await response.json()).toEqual({ validationResponse: "CODE-7" });
    expect(mocked.applyMailgunEvent).not.toHaveBeenCalled();
  });

  it("applies a bounce through the outbox's own delivery event", async () => {
    const response = await POST(
      post([
        {
          eventType: "Microsoft.Communication.EmailDeliveryReportReceived",
          data: { recipient: "ana@example.test", internetMessageId: "<id-1@mail.example.test>", status: "Bounced" },
        },
      ]),
    );
    expect(response.status).toBe(200);
    expect(mocked.applyMailgunEvent).toHaveBeenCalledTimes(1);
    const [, event] = mocked.applyMailgunEvent.mock.calls[0] as unknown as [unknown, { providerMessageId: string; event: string; severity: string }];
    expect(event).toMatchObject({ providerMessageId: "id-1@mail.example.test", event: "failed", severity: "permanent" });
  });

  it("refuses a body that is not JSON", async () => {
    const response = await POST(new Request(`http://localhost/api/webhooks/acs?key=${KEY}`, { method: "POST", body: "{" }));
    expect(response.status).toBe(400);
  });
});
