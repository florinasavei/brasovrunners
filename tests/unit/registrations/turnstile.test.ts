import { afterEach, describe, expect, it, vi } from "vitest";

/** `DECISIONS.md` §97 — the bot check is off without both keys, and strict with them. */
describe("Cloudflare Turnstile", () => {
  afterEach(() => {
    vi.resetModules();
    delete process.env.TURNSTILE_SITE_KEY;
    delete process.env.TURNSTILE_SECRET_KEY;
  });

  it("is not configured without both keys, and shows no widget", async () => {
    process.env.TURNSTILE_SITE_KEY = "site-only";
    const { turnstileSiteKey, verifyTurnstile } = await import("@/modules/registrations/turnstile");
    expect(turnstileSiteKey()).toBeUndefined();
    expect(await verifyTurnstile("anything", null)).toBe("not_configured");
  });

  it("verifies the token with the secret once configured, and treats an outage as a failure", async () => {
    process.env.TURNSTILE_SITE_KEY = "1x000";
    process.env.TURNSTILE_SECRET_KEY = "2x000";
    const { turnstileSiteKey, verifyTurnstile } = await import("@/modules/registrations/turnstile");
    expect(turnstileSiteKey()).toBe("1x000");

    const calls: Array<{ url: string; body: URLSearchParams }> = [];
    const ok = (async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), body: init?.body as URLSearchParams });
      return new Response(JSON.stringify({ success: true }), { status: 200 });
    }) as typeof fetch;
    expect(await verifyTurnstile("token-123", "203.0.113.5", ok)).toBe("passed");
    expect(calls[0].url).toContain("siteverify");
    expect(calls[0].body.get("secret")).toBe("2x000");
    expect(calls[0].body.get("response")).toBe("token-123");
    expect(calls[0].body.get("remoteip")).toBe("203.0.113.5");

    const refused = (async () => new Response(JSON.stringify({ success: false }), { status: 200 })) as typeof fetch;
    expect(await verifyTurnstile("token-123", null, refused)).toBe("failed");
    const down = (async () => {
      throw new Error("network");
    }) as typeof fetch;
    expect(await verifyTurnstile("token-123", null, down)).toBe("failed");
    // No token at all — the widget never ran, or a script posted the form.
    expect(await verifyTurnstile("", null, ok)).toBe("failed");
  });
});
