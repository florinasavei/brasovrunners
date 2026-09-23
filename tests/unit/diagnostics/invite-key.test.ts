import { describe, expect, it } from "vitest";
import { checkInviteKey, hasNoAccount } from "@/modules/diagnostics/invite-key";

/**
 * BR-REQ-060-01 criterion 10, `DECISIONS.md` §288 — the invitation key is tested with the call
 * "Add" makes, and read with the reader as the control: the person on the page is signed in
 * through Zitadel, so a key that cannot find them is a key that cannot see accounts, whatever
 * status code it came back with.
 */
const deps = { issuer: "https://id.example.test", token: "pat" };
const reader = { authMode: "provider" as const, readerEmail: "Florin@Example.ro" };

function answering(respond: () => Response | Promise<Response>) {
  const calls: Array<{ url: string; body: unknown; signal: AbortSignal | null | undefined }> = [];
  const call = (async (url: string, init: RequestInit) => {
    calls.push({ url, body: init.body ? JSON.parse(String(init.body)) : null, signal: init.signal });
    return respond();
  }) as unknown as typeof fetch;
  return { call, calls };
}

const listing = (users: Array<Record<string, unknown>>) =>
  new Response(JSON.stringify({ details: { totalResult: users.length }, result: users }), { status: 200 });

describe("§288 the invitation key, tested rather than merely present", () => {
  it("asks for the organization's human users, once, with the bearer token and a timeout", async () => {
    const { call, calls } = answering(() => listing([{ userId: "1", human: { email: { email: "florin@example.ro" } } }]));
    const check = await checkInviteKey(reader, { ...deps, fetch: call });
    expect(check.kind).toBe("ok");
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("https://id.example.test/v2/users");
    expect(calls[0].body).toEqual({ query: { limit: 200 }, queries: [{ typeQuery: { type: "TYPE_HUMAN" } }] });
    // Bounded: a provider that hangs must not take the page down with it.
    expect(calls[0].signal).toBeInstanceOf(AbortSignal);
  });

  it("is green when the key finds the reader, and then says of each row whether its account exists", async () => {
    const { call } = answering(() =>
      listing([
        {
          userId: "1",
          username: "florin@example.ro",
          preferredLoginName: "florin@example.ro@club.zitadel.cloud",
          loginNames: ["florin@example.ro@club.zitadel.cloud"],
          human: { email: { email: "Florin@Example.ro" } },
        },
        { userId: "2", username: "dani", loginNames: ["dani@club.zitadel.cloud"], human: { email: { email: "dani@example.ro" } } },
      ]),
    );
    const check = await checkInviteKey(reader, { ...deps, fetch: call });
    expect(check.kind).toBe("ok");
    expect(hasNoAccount(check, "dani@example.ro")).toBe(false);
    // Case is not identity here: Echipa stores lowercase, Zitadel stores what was typed.
    expect(hasNoAccount(check, "DANI@example.ro")).toBe(false);
    // A person created by hand with a username that is not their address still counts, by login name.
    expect(hasNoAccount(check, "dani@club.zitadel.cloud")).toBe(false);
    expect(hasNoAccount(check, "ghost@example.ro")).toBe(true);
  });

  it("reads 200 with nobody — not even the reader — as a key without the membership, never as an empty club", async () => {
    // What the club's own instance answered for two days: authenticated, and shown no users.
    const { call } = answering(() => listing([]));
    expect(await checkInviteKey(reader, { ...deps, fetch: call })).toEqual({ kind: "blind", seen: 0 });

    // And a listing from some other organization: people in it, but not the reader.
    const elsewhere = answering(() => listing([{ userId: "9", human: { email: { email: "someone@else.test" } } }]));
    const check = await checkInviteKey(reader, { ...deps, fetch: elsewhere.call });
    expect(check).toEqual({ kind: "blind", seen: 1 });
    // Nothing is claimed about anybody from a blind key.
    expect(hasNoAccount(check, "ghost@example.ro")).toBe(false);
  });

  it("carries Zitadel's own refusal — 401 for a dead token, 403 for one without permission", async () => {
    const revoked = answering(() => new Response(JSON.stringify({ code: 16, message: "invalid token" }), { status: 401 }));
    expect(await checkInviteKey(reader, { ...deps, fetch: revoked.call })).toEqual({ kind: "refused", reason: "401 invalid token" });

    const forbidden = answering(
      () => new Response(JSON.stringify({ code: 7, message: "membership not found (AUTHZ-cdgFk)" }), { status: 403 }),
    );
    expect(await checkInviteKey(reader, { ...deps, fetch: forbidden.call })).toEqual({
      kind: "refused",
      reason: "403 membership not found (AUTHZ-cdgFk)",
    });

    // A body that is not JSON still names the status.
    const plain = answering(() => new Response("Forbidden", { status: 403 }));
    expect(await checkInviteKey(reader, { ...deps, fetch: plain.call })).toEqual({ kind: "refused", reason: "403" });
  });

  it("answers unreachable, never throws, when the network fails or the call times out", async () => {
    const down = answering(() => {
      throw new TypeError("fetch failed");
    });
    expect(await checkInviteKey(reader, { ...deps, fetch: down.call })).toEqual({
      kind: "unreachable",
      reason: "TypeError: fetch failed",
    });

    const slow = answering(() => {
      throw new DOMException("The operation was aborted due to timeout", "TimeoutError");
    });
    expect(await checkInviteKey(reader, { ...deps, fetch: slow.call })).toEqual({
      kind: "unreachable",
      reason: "TimeoutError: The operation was aborted due to timeout",
    });

    // An answer that is not JSON at all: no verdict on the key from it either.
    const garbled = answering(() => new Response("<html>gateway</html>", { status: 200 }));
    expect((await checkInviteKey(reader, { ...deps, fetch: garbled.call })).kind).toBe("unreachable");
  });

  it("really gives up on a provider that hangs, within the timeout it was given", async () => {
    // A fetch that honours the signal and never answers otherwise: the page must not wait.
    const hanging = (async (_url: string, init: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init.signal?.addEventListener("abort", () => reject(init.signal?.reason));
      })) as unknown as typeof fetch;
    const check = await checkInviteKey(reader, { ...deps, fetch: hanging, timeoutMs: 20 });
    expect(check.kind).toBe("unreachable");
    expect((check as { reason: string }).reason).toContain("TimeoutError");
  });

  it("calls nothing without a key, and nothing where the development switcher is the provider", async () => {
    const never = answering(() => {
      throw new Error("must not be called");
    });
    expect(await checkInviteKey(reader, { issuer: "https://id.example.test", token: "", fetch: never.call })).toEqual({
      kind: "unconfigured",
    });
    expect(await checkInviteKey({ authMode: "dev-switcher", readerEmail: "x@y.ro" }, { ...deps, fetch: never.call })).toEqual({
      kind: "inapplicable",
    });
    expect(await checkInviteKey({ authMode: "disabled", readerEmail: "x@y.ro" }, { ...deps, fetch: never.call })).toEqual({
      kind: "inapplicable",
    });
    expect(never.calls).toHaveLength(0);
  });
});
