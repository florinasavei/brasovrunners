import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { OutgoingEmail } from "@/infrastructure/email/adapter";
import { createMailgunAdapter } from "@/infrastructure/email/mailgun-adapter";

/**
 * BR-REQ-080-01, BR-REQ-080-03 — the provider boundary, and the distinction the outbox acts on.
 *
 * The mapping from an HTTP status to `transient_failure` or `permanent_failure` is the only
 * interesting logic in the adapter, and getting it wrong is expensive in a way tests are the
 * cheapest way to prevent: a permanent failure retried six times is how a sending domain's
 * reputation goes, and a transient failure treated as permanent is a registration email that
 * silently never arrives because Mailgun was rate-limiting for ten seconds.
 */
const MESSAGE: OutgoingEmail = {
  to: "ana@example.ro",
  subject: "Confirmă-ți înscrierea",
  html: "<p>Confirmă</p>",
  text: "Confirmă",
  locale: "ro",
  idempotencyKey: "registration:1:verify-requested",
};

const adapter = () =>
  createMailgunAdapter({
    apiKey: "key-not-a-real-key",
    domain: "sandbox.example.test",
    apiBaseUrl: "https://api.example.test/v3",
    from: '"Brașov Runners" <noreply@sandbox.example.test>',
    replyTo: "contact@example.test",
  });

let calls: Array<{ url: string; init: RequestInit }>;
const originalFetch = globalThis.fetch;

function respondWith(status: number, body: string) {
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    return new Response(body, { status });
  }) as typeof fetch;
}

beforeEach(() => {
  calls = [];
});
afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("BR-REQ-080-01 what the adapter sends", () => {
  it("posts to the configured domain with the configured sender and the outbox key", async () => {
    respondWith(200, JSON.stringify({ id: "<20260903.1@sandbox.example.test>", message: "Queued" }));

    const result = await adapter().send(MESSAGE);

    // AGENTS.md §16.5: stored without the angle brackets the send response wraps it in,
    // because the delivery webhook reports `message.headers.message-id` without them and
    // `applyMailgunEvent` matches exactly. Stored the other way, no bounce ever lands.
    expect(result).toEqual({
      outcome: "sent",
      providerMessageId: "20260903.1@sandbox.example.test",
    });

    const form = calls[0].init.body as FormData;
    expect(calls[0].url).toBe("https://api.example.test/v3/sandbox.example.test/messages");
    expect(form.get("from")).toBe('"Brașov Runners" <noreply@sandbox.example.test>');
    expect(form.get("to")).toBe("ana@example.ro");
    expect(form.get("h:Reply-To")).toBe("contact@example.test");
    expect(form.get("v:idempotency_key")).toBe("registration:1:verify-requested");
    expect(form.get("o:tag")).toBe("locale:ro");
  });

  it("omits Reply-To when the club has named no mailbox", async () => {
    respondWith(200, JSON.stringify({ id: "<1@x>" }));

    await createMailgunAdapter({
      apiKey: "k",
      domain: "sandbox.example.test",
      apiBaseUrl: "https://api.example.test/v3",
      from: "<noreply@sandbox.example.test>",
    }).send(MESSAGE);

    // Absent rather than empty: an empty Reply-To is a header some clients honour literally.
    expect((calls[0].init.body as FormData).get("h:Reply-To")).toBeNull();
  });

  it("still reports a send when the response carries no id", async () => {
    // A surprising response shape is a message that went out, not an exception on a path that
    // has already handed the message to the provider.
    respondWith(200, "not json at all");

    const result = await adapter().send(MESSAGE);

    expect(result.outcome).toBe("sent");
  });
});

describe("BR-REQ-080-03 transient and permanent are not the same failure", () => {
  it.each([400, 401, 403])("treats %i as permanent, because retrying changes nothing", async (status) => {
    respondWith(status, "Forbidden");

    const result = await adapter().send(MESSAGE);

    expect(result.outcome).toBe("permanent_failure");
  });

  it.each([429, 500, 502, 503])("treats %i as transient, so the outbox retries", async (status) => {
    respondWith(status, "Too Many Requests");

    const result = await adapter().send(MESSAGE);

    expect(result.outcome).toBe("transient_failure");
  });

  it("treats an unreachable provider as transient", async () => {
    globalThis.fetch = (async () => {
      throw new TypeError("fetch failed");
    }) as typeof fetch;

    const result = await adapter().send(MESSAGE);

    expect(result.outcome).toBe("transient_failure");
    expect(result).toMatchObject({ error: expect.stringContaining("unreachable") });
  });

  it("never puts the API key, the recipient or the body into the stored error", async () => {
    // §14.5: `email_outbox.last_error` is read by an organizer in the backoffice and shipped
    // into logs. A provider message is not trusted to be free of any of these.
    respondWith(400, `key-not-a-real-key rejected ana@example.ro: <p>Confirmă</p>`.repeat(20));

    const result = await adapter().send(MESSAGE);

    expect(result.outcome).toBe("permanent_failure");
    const error = (result as { error: string }).error;
    expect(error.length).toBeLessThanOrEqual(220);
    expect(error).not.toContain("key-not-a-real-key");
  });
});
