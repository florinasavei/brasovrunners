import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * `DECISIONS.md` §97, §216 — the bot check is off without both keys, and with them it refuses
 * only what Cloudflare actually rejected.
 *
 * The distinction these tests exist for: a rejected token is evidence and stops a submission;
 * no token, or no answer from Cloudflare, is the *absence* of evidence and must not. §216
 * records why — a person whose browser never loaded the widget could not register at all,
 * which happened on 2026-09-21, and §205 says people must be able to register at all costs.
 */
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

  it("verifies the token with the secret once configured, and refuses only what was rejected", async () => {
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

    // Cloudflare looked at the token and said no. This is the one thing that stops a person.
    const refused = (async () => new Response(JSON.stringify({ success: false }), { status: 200 })) as typeof fetch;
    expect(await verifyTurnstile("token-123", null, refused)).toBe("failed");

    /*
      Everything below is "we could not ask", and none of it refuses anybody (§216).

      Each one is something that happens to real people rather than to bots: a content blocker
      or a privacy browser that will not load `challenges.cloudflare.com`, a corporate proxy, a
      phone on a bad connection, JavaScript off — and Cloudflare itself having a bad five
      seconds, which takes out every visitor at once.
    */
    const down = (async () => {
      throw new Error("network");
    }) as typeof fetch;
    expect(await verifyTurnstile("token-123", null, down)).toBe("unavailable");
    const bad = (async () => new Response("", { status: 503 })) as typeof fetch;
    expect(await verifyTurnstile("token-123", null, bad)).toBe("unavailable");
    // No token at all — the widget never ran.
    expect(await verifyTurnstile("", null, ok)).toBe("unavailable");
    expect(await verifyTurnstile(null, null, ok)).toBe("unavailable");

    // An over-long token *was* submitted, and nothing legitimate produces one.
    expect(await verifyTurnstile("x".repeat(2049), null, ok)).toBe("failed");
  });

  /*
    §NNN (the registration audit, F5): a wrong secret is the server's misconfiguration, not the
    visitor's failure. Cloudflare answers it with HTTP 200 and `success: false`, which used to be
    scored "failed" and refused every person whose widget loaded. It is "unavailable" now, logged
    with the codes; a rejection of the token itself still refuses.
  */
  it("treats a wrong secret or Cloudflare's internal error as the check not running, never as the visitor failing", async () => {
    process.env.TURNSTILE_SITE_KEY = "1x000";
    // Cloudflare's own dummy shape; which secret it is does not matter, only what siteverify answers.
    process.env.TURNSTILE_SECRET_KEY = "2x000";
    const { verifyTurnstile } = await import("@/modules/registrations/turnstile");
    const answer = (codes: string[]) =>
      (async () => new Response(JSON.stringify({ success: false, "error-codes": codes }), { status: 200 })) as typeof fetch;
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      expect(await verifyTurnstile("token-123", null, answer(["invalid-input-secret"]))).toBe("unavailable");
      expect(await verifyTurnstile("token-123", null, answer(["missing-input-secret"]))).toBe("unavailable");
      expect(await verifyTurnstile("token-123", null, answer(["internal-error"]))).toBe("unavailable");
      // Said out loud, with the codes and never the token.
      expect(logged).toHaveBeenCalledTimes(3);
      expect(String(logged.mock.calls[0]?.[0])).toContain("invalid-input-secret");
      expect(String(logged.mock.calls[0]?.[0])).not.toContain("token-123");

      // A token Cloudflare rejected is still evidence, and still refuses.
      expect(await verifyTurnstile("token-123", null, answer(["invalid-input-response"]))).toBe("failed");
      expect(await verifyTurnstile("token-123", null, answer(["timeout-or-duplicate"]))).toBe("failed");
      expect(await verifyTurnstile("token-123", null, answer([]))).toBe("failed");
    } finally {
      logged.mockRestore();
    }
  });

  /*
    §NNN, finding (10)'s health half: `verifyTurnstile` fails a wrong secret open on purpose, so
    something else has to notice it — `probeTurnstileSecret` is what `/api/health` and
    `/admin/tasks` ask. It must tell a wrong secret apart from Cloudflare merely disliking a
    fake token, and from Cloudflare not answering at all.
  */
  it("probes the secret without a real widget token, and tells a wrong secret from a timeout", async () => {
    process.env.TURNSTILE_SITE_KEY = "1x000";
    process.env.TURNSTILE_SECRET_KEY = "2x000";
    const { probeTurnstileSecret } = await import("@/modules/registrations/turnstile");
    const answer = (codes: string[]) =>
      (async () => new Response(JSON.stringify({ success: false, "error-codes": codes }), { status: 200 })) as typeof fetch;

    // The secret is fine; Cloudflare rejects only the dummy token, as it always will.
    expect(await probeTurnstileSecret(answer(["invalid-input-response"]))).toBe("ok");
    expect(await probeTurnstileSecret(answer(["timeout-or-duplicate"]))).toBe("ok");

    // The secret itself is what Cloudflare is unhappy about — this is the fault the health
    // endpoint and the admin task row must both surface.
    expect(await probeTurnstileSecret(answer(["invalid-input-secret"]))).toBe("misconfigured");
    expect(await probeTurnstileSecret(answer(["missing-input-secret"]))).toBe("misconfigured");
    expect(await probeTurnstileSecret(answer(["invalid-input-secret", "internal-error"]))).toBe("misconfigured");

    // Cloudflare's own internal error is its passing fault, not the secret's (§NNN): read like a
    // 5xx, so fifteen minutes of cache never show a right secret as wrong.
    expect(await probeTurnstileSecret(answer(["internal-error"]))).toBe("unreachable");

    // Cloudflare not answering says nothing about the secret, and must never read as broken.
    const down = (async () => {
      throw new Error("network");
    }) as typeof fetch;
    expect(await probeTurnstileSecret(down)).toBe("unreachable");
    const bad = (async () => new Response("", { status: 503 })) as typeof fetch;
    expect(await probeTurnstileSecret(bad)).toBe("unreachable");
  });

  it("probes as not_configured without both keys, and refuses no registration by doing so", async () => {
    process.env.TURNSTILE_SITE_KEY = "site-only";
    const { probeTurnstileSecret } = await import("@/modules/registrations/turnstile");
    expect(await probeTurnstileSecret()).toBe("not_configured");
  });
});
