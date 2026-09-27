import { describe, expect, it } from "vitest";
import {
  inviteZitadelUser,
  listZitadelHumanAccounts,
  resendZitadelInvite,
  sendZitadelPasswordReset,
  setZitadelUserActive,
} from "@/modules/staff-identity/zitadel-users";

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
    const outcome = await inviteZitadelUser({ email: "mihai@example.ro", displayName: "Mihai Pop", locale: "ro" }, { ...deps, fetch: call });
    expect(outcome).toEqual({ kind: "invited" });
    expect(calls[0].url).toBe("https://id.example.test/v2/users/human");
    expect(calls[0].body).toMatchObject({
      username: "mihai@example.ro",
      profile: { givenName: "Mihai", familyName: "Pop", displayName: "Mihai Pop", preferredLanguage: "ro" },
      email: { email: "mihai@example.ro", isVerified: true },
    });
    expect(calls[1].url).toBe("https://id.example.test/v2/users/42/invite_code");
    expect(calls[1].body).toEqual({ sendCode: { applicationName: "Brașov Runners" } });
  });

  /**
   * §171. A 409 used to end the story — the row joined the allowlist, the screen said "they
   * already have an account", and nobody ever sent them the link that lets them set a password.
   * An existing account gets the same invitation a new one does, and the outcome still says
   * "exists" so the screen can word it honestly.
   */
  it("invites an account that already exists rather than leaving it without a password link", async () => {
    const exists = fakeFetch({
      "/v2/users/human": () => new Response(JSON.stringify({ message: "User already exists" }), { status: 409 }),
      "/v2/users": () => new Response(JSON.stringify({ result: [{ userId: "42" }] }), { status: 200 }),
      "/v2/users/42/invite_code": () => new Response("{}", { status: 200 }),
    });
    expect(await inviteZitadelUser({ email: "a@b.ro", displayName: "A", locale: "en" }, { ...deps, fetch: exists.call })).toEqual({ kind: "exists" });
    expect(exists.calls.at(-1)?.url).toBe("https://id.example.test/v2/users/42/invite_code");
  });

  it("reports a refusal with its reason, and a missing key as unconfigured", async () => {
    const exists = fakeFetch({ "/v2/users/human": () => new Response(JSON.stringify({ message: "User already exists" }), { status: 409 }) });

    const refused = fakeFetch({ "/v2/users/human": () => new Response(JSON.stringify({ message: "permission denied" }), { status: 403 }) });
    expect(await inviteZitadelUser({ email: "a@b.ro", displayName: "A", locale: "en" }, { ...deps, fetch: refused.call })).toEqual({
      kind: "failed",
      reason: "403 permission denied",
    });

    expect(await inviteZitadelUser({ email: "a@b.ro", displayName: "A", locale: "en" }, { issuer: "", token: "", fetch: exists.call })).toEqual({ kind: "unconfigured" });
  });

  /**
   * §170. The lookup was by login name alone, and Zitadel scopes a login name to the
   * organization's primary domain — so a colleague created as `mihai@example.ro` has the login
   * name `mihai@example.ro@<org>.zitadel.cloud`, an equality match on the address finds nobody,
   * and "Retrimite invitația" told the owner there was no account for somebody who had one.
   */
  it("resends by looking the account up by its email address", async () => {
    const { call, calls } = fakeFetch({
      "/v2/users": () => new Response(JSON.stringify({ result: [{ userId: "7" }] }), { status: 200 }),
      "/v2/users/7/invite_code": () => new Response("{}", { status: 200 }),
    });
    expect(await resendZitadelInvite("mihai@example.ro", { ...deps, fetch: call })).toEqual({ kind: "invited" });
    expect(calls[0].body).toMatchObject({ queries: [{ emailQuery: { emailAddress: "mihai@example.ro" } }] });
    // One search was enough: the fallback below is not paid for when the first one answers.
    expect(calls.filter((entry) => entry.url.endsWith("/v2/users")).length).toBe(1);
  });

  /** A person created by hand with a username that is not their address is still found. */
  it("falls back to the login name, and says plainly when there is no account at all", async () => {
    let searches = 0;
    const { call, calls } = fakeFetch({
      "/v2/users": () => {
        searches += 1;
        return new Response(JSON.stringify({ result: searches === 1 ? [] : [{ userId: "9" }] }), { status: 200 });
      },
      "/v2/users/9/invite_code": () => new Response("{}", { status: 200 }),
    });
    expect(await resendZitadelInvite("mihai@example.ro", { ...deps, fetch: call })).toEqual({ kind: "invited" });
    expect(calls[1].body).toMatchObject({ queries: [{ loginNameQuery: { loginName: "mihai@example.ro" } }] });

    const nobody = fakeFetch({ "/v2/users": () => new Response(JSON.stringify({ result: [] }), { status: 200 }) });
    expect(await resendZitadelInvite("ghost@example.ro", { ...deps, fetch: nobody.call })).toEqual({
      kind: "failed",
      reason: "no account with this address at the identity provider",
    });
  });
});

/**
 * §171 — the rest of the account workflow the owner asked for: "I must invite users and stuff,
 * and I can also deactivate, send password resets, etc".
 */
describe("the account verbs", () => {
  it("asks Zitadel to email a password link, and says when there is nobody to email", async () => {
    const { call, calls } = fakeFetch({
      "/v2/users": () => new Response(JSON.stringify({ result: [{ userId: "42" }] }), { status: 200 }),
      "/v2/users/42/password_reset": () => new Response("{}", { status: 200 }),
    });
    expect(await sendZitadelPasswordReset("mihai@example.ro", { ...deps, fetch: call })).toEqual({ kind: "done" });
    expect(calls.at(-1)?.url).toBe("https://id.example.test/v2/users/42/password_reset");
    // The link, not a code handed back to us: nothing here ever holds a password or its code.
    expect(calls.at(-1)?.body).toEqual({ sendLink: { notificationType: "NOTIFICATION_TYPE_Email" } });

    const nobody = fakeFetch({ "/v2/users": () => new Response(JSON.stringify({ result: [] }), { status: 200 }) });
    expect(await sendZitadelPasswordReset("ghost@example.ro", { ...deps, fetch: nobody.call })).toEqual({ kind: "missing" });
  });

  it("deactivates and reactivates the account, and needs the key for either", async () => {
    const off = fakeFetch({
      "/v2/users": () => new Response(JSON.stringify({ result: [{ userId: "42" }] }), { status: 200 }),
      "/v2/users/42/deactivate": () => new Response("{}", { status: 200 }),
    });
    expect(await setZitadelUserActive("mihai@example.ro", false, { ...deps, fetch: off.call })).toEqual({ kind: "done" });
    expect(off.calls.at(-1)?.url).toBe("https://id.example.test/v2/users/42/deactivate");

    const on = fakeFetch({
      "/v2/users": () => new Response(JSON.stringify({ result: [{ userId: "42" }] }), { status: 200 }),
      "/v2/users/42/reactivate": () => new Response("{}", { status: 200 }),
    });
    expect(await setZitadelUserActive("mihai@example.ro", true, { ...deps, fetch: on.call })).toEqual({ kind: "done" });
    expect(on.calls.at(-1)?.url).toBe("https://id.example.test/v2/users/42/reactivate");

    // Without the key nothing is attempted: "not configured" is an answer, not a failure.
    expect(await setZitadelUserActive("mihai@example.ro", false, { issuer: "", token: "", fetch: off.call })).toEqual({
      kind: "unconfigured",
    });
    expect(await sendZitadelPasswordReset("mihai@example.ro", { issuer: "", token: "", fetch: off.call })).toEqual({
      kind: "unconfigured",
    });
  });

  it("refuses with the provider's own reason when the call fails", async () => {
    const refused = fakeFetch({
      "/v2/users": () => new Response(JSON.stringify({ result: [{ userId: "42" }] }), { status: 200 }),
      "/v2/users/42/deactivate": () => new Response(JSON.stringify({ message: "permission denied" }), { status: 403 }),
    });
    expect(await setZitadelUserActive("mihai@example.ro", false, { ...deps, fetch: refused.call })).toEqual({
      kind: "failed",
      reason: "403 permission denied",
    });
  });
});

/**
 * §288 — the check `SETUP.md` §37 recommends, made a function: what human accounts does the key
 * see? Every name each one answers to, lowercased, so a caller can ask about a row without a
 * second call; the count too, so an empty answer can be told from a short one.
 */
describe("the accounts the key can see", () => {
  it("lists the organization's human users by address, username and login name, lowercased", async () => {
    const { call, calls } = fakeFetch({
      "/v2/users": () =>
        new Response(
          JSON.stringify({
            result: [
              { userId: "1", username: "Florin@Example.ro", loginNames: ["Florin@Example.ro@club.zitadel.cloud"], human: { email: { email: "Florin@Example.ro" } } },
              { userId: "2", username: "mihai", preferredLoginName: "mihai@club.zitadel.cloud", human: { email: { email: "mihai@example.ro" } } },
              { userId: "3" },
            ],
          }),
          { status: 200 },
        ),
    });
    const listed = await listZitadelHumanAccounts({ ...deps, fetch: call });
    expect(listed.kind).toBe("listed");
    if (listed.kind !== "listed") return;
    expect(listed.count).toBe(3);
    expect([...listed.accounts].sort()).toEqual([
      "florin@example.ro",
      "florin@example.ro@club.zitadel.cloud",
      "mihai",
      "mihai@club.zitadel.cloud",
      "mihai@example.ro",
    ]);
    expect(calls[0].body).toEqual({ query: { offset: 0, limit: 200, asc: true }, sortingColumn: "USER_FIELD_NAME_CREATION_DATE", queries: [{ typeQuery: { type: "TYPE_HUMAN" } }] });
    expect((calls[0] as { url: string }).url).toBe("https://id.example.test/v2/users");
    // A short first page is the whole listing: one call, not capped.
    expect(calls).toHaveLength(1);
    expect(listed.capped).toBe(false);
  });

  /*
    §524: every club member is a human account too, so the organization outgrows one page. The
    listing pages with offset/limit until a short page, and says `capped` at its ceiling rather
    than handing back a set that is silently short.
  */
  it("pages through Zitadel's search until a short page", async () => {
    const pages: Record<number, Array<Record<string, unknown>>> = {
      0: [{ human: { email: { email: "a@x.ro" } } }, { human: { email: { email: "b@x.ro" } } }],
      2: [{ human: { email: { email: "c@x.ro" } } }],
    };
    const { call, calls } = fakeFetch({
      "/v2/users": (init) => {
        const { query } = JSON.parse(String(init.body)) as { query: { offset: number } };
        return new Response(JSON.stringify({ result: pages[query.offset] ?? [] }), { status: 200 });
      },
    });
    const listed = await listZitadelHumanAccounts({ ...deps, fetch: call, pageSize: 2 });
    expect(calls.map((c) => (c.body as { query: unknown }).query)).toEqual([
      { offset: 0, limit: 2, asc: true },
      { offset: 2, limit: 2, asc: true },
    ]);
    expect(listed).toMatchObject({ kind: "listed", count: 3, capped: false });
    if (listed.kind === "listed") expect([...listed.accounts].sort()).toEqual(["a@x.ro", "b@x.ro", "c@x.ro"]);
  });

  it("stops at its ceiling and says so, and a failed page is the listing's failure", async () => {
    const full = fakeFetch({
      "/v2/users": () => new Response(JSON.stringify({ result: [{ username: "p" }, { username: "q" }] }), { status: 200 }),
    });
    const capped = await listZitadelHumanAccounts({ ...deps, fetch: full.call, pageSize: 2, max: 4 });
    expect(full.calls).toHaveLength(2);
    expect(capped).toMatchObject({ kind: "listed", count: 4, capped: true });

    let page = 0;
    const second = fakeFetch({
      "/v2/users": () =>
        page++ === 0
          ? new Response(JSON.stringify({ result: [{ username: "p" }, { username: "q" }] }), { status: 200 })
          : new Response(JSON.stringify({ message: "boom" }), { status: 500 }),
    });
    expect(await listZitadelHumanAccounts({ ...deps, fetch: second.call, pageSize: 2 })).toEqual({ kind: "refused", reason: "500 boom" });
  });

  it("needs the key, and says so without calling anything", async () => {
    const never = fakeFetch({});
    expect(await listZitadelHumanAccounts({ issuer: "", token: "", fetch: never.call })).toEqual({ kind: "unconfigured" });
    expect(never.calls).toHaveLength(0);
  });
});
