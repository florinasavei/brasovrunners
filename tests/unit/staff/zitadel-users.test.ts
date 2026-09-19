import { describe, expect, it } from "vitest";
import { inviteZitadelUser, resendZitadelInvite } from "@/modules/staff-identity/zitadel-users";

/** BR-REQ-060-01 criterion 9 (`DECISIONS.md` §123) — "Add" on Echipa creates the account and sends the invitation. */
const deps = { issuer: "https://id.example.test/", token: "pat" };

function fakeFetch(handlers: Record<string, (init: RequestInit) => Response>) {
  const calls: Array<{ url: string; body: unknown }> = [];
  const call = (async (url: string, init: RequestInit) => {
    calls.push({ url, body: init.body ? JSON.parse(String(init.body)) : null });
    const handler = Object.entries(handlers).find(([path]) => url.endsWith(path))?.[1];
    if (!handler) return new Response("not found", { status: 404 });
    return handler(init);
  }) as unknown as typeof fetch;
  return { call, calls };
}

describe("the Zitadel invitation", () => {
  it("creates the user with a verified address and sends the invite code, with the bearer token", async () => {
    const { call, calls } = fakeFetch({
      "/v2/users/human": () => new Response(JSON.stringify({ userId: "42" }), { status: 201 }),
      "/v2/users/42/invite_code": () => new Response(JSON.stringify({ inviteCode: "" }), { status: 200 }),
    });
    const outcome = await inviteZitadelUser({ email: "dani@example.ro", displayName: "Dani Pop", locale: "ro" }, { ...deps, fetch: call });
    expect(outcome).toEqual({ kind: "invited" });
    expect(calls[0].url).toBe("https://id.example.test/v2/users/human");
    expect(calls[0].body).toMatchObject({
      username: "dani@example.ro",
      profile: { givenName: "Dani", familyName: "Pop", displayName: "Dani Pop", preferredLanguage: "ro" },
      email: { email: "dani@example.ro", isVerified: true },
    });
    expect(calls[1].url).toBe("https://id.example.test/v2/users/42/invite_code");
    expect(calls[1].body).toEqual({ sendCode: { applicationName: "Brașov Runners" } });
  });

  it("reports an account that exists, a refusal with its reason, and a missing key as unconfigured", async () => {
    const exists = fakeFetch({ "/v2/users/human": () => new Response(JSON.stringify({ message: "User already exists" }), { status: 409 }) });
    expect(await inviteZitadelUser({ email: "a@b.ro", displayName: "A", locale: "en" }, { ...deps, fetch: exists.call })).toEqual({ kind: "exists" });

    const refused = fakeFetch({ "/v2/users/human": () => new Response(JSON.stringify({ message: "permission denied" }), { status: 403 }) });
    expect(await inviteZitadelUser({ email: "a@b.ro", displayName: "A", locale: "en" }, { ...deps, fetch: refused.call })).toEqual({
      kind: "failed",
      reason: "403 permission denied",
    });

    expect(await inviteZitadelUser({ email: "a@b.ro", displayName: "A", locale: "en" }, { issuer: "", token: "", fetch: exists.call })).toEqual({ kind: "unconfigured" });
  });

  it("resends by looking the account up by its login name", async () => {
    const { call, calls } = fakeFetch({
      "/v2/users": () => new Response(JSON.stringify({ result: [{ userId: "7" }] }), { status: 200 }),
      "/v2/users/7/invite_code": () => new Response("{}", { status: 200 }),
    });
    expect(await resendZitadelInvite("dani@example.ro", { ...deps, fetch: call })).toEqual({ kind: "invited" });
    expect(calls[0].body).toMatchObject({ queries: [{ loginNameQuery: { loginName: "dani@example.ro" } }] });
  });
});
