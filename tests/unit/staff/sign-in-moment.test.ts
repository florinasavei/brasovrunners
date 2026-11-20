import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * §1026 BR-REQ-060-01 — the moment a session was signed in, the claim the team's undertaking is owed by (amending §1006: once per
 * sign-in, not once per account). Auth.js's `jwt` callback (`src/auth.ts`, over `staffTokenAt`) writes it at a Zitadel sign-in —
 * the one call that hands it `account` — and only then; every other call returns the token as it came, so a refresh keeps the
 * moment and nothing a browser posts to `/api/auth/session` can write or move it. The `session` callback hands it to the server.
 *
 * The real `src/auth.ts`, its NextAuth configuration captured; the allowlist's lookups stubbed — they have their own test
 * (`tests/integration/auth/zitadel-sign-in.test.ts`).
 */
type Token = Record<string, unknown>;
type JwtCallback = (params: { token: Token; account?: Record<string, unknown> | null; profile?: Record<string, unknown>; trigger?: string; session?: unknown }) => Promise<Token>;
type SessionCallback = (params: { session: Record<string, unknown>; token: Token }) => Promise<Record<string, unknown>>;

const captured = vi.hoisted(() => ({ callbacks: {} as { jwt?: JwtCallback; session?: SessionCallback } }));
const STAFF_ID = "aaaaaaaa-0000-4000-8000-0000000000aa";

vi.mock("next-auth", () => ({
  default: (config: { callbacks: typeof captured.callbacks }) => {
    captured.callbacks = config.callbacks;
    return { handlers: {}, auth: async () => null, signIn: async () => {}, signOut: async () => {} };
  },
}));
vi.mock("next-auth/providers/zitadel", () => ({ default: { id: "zitadel" } }));
vi.mock("@/db/client", () => ({ getDb: () => ({}) }));
vi.mock("@/modules/staff-identity/repository", () => ({
  findStaffUserByZitadelSubject: async (_db: unknown, subject: string) => (subject === "zitadel:vlad" ? { id: STAFF_ID } : undefined),
  findStaffUserByEmail: async () => undefined,
  recordFirstSignIn: async () => {},
}));

await import("@/auth");
const { staffTokenAt } = await import("@/modules/staff-identity/auth-callbacks");
const jwt = captured.callbacks.jwt as JwtCallback;
const session = captured.callbacks.session as SessionCallback;

const SIGN_IN = new Date("2026-11-21T07:00:00.000Z");
const zitadel = { provider: "zitadel", providerAccountId: "zitadel:vlad", type: "oidc" };

describe("§1026 the jwt callback writes the sign-in's moment at a sign-in and only then", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(SIGN_IN);
  });
  afterEach(() => vi.useRealTimers());

  it("writes the account's id and the moment of this sign-in when Zitadel signs the colleague in", async () => {
    const token = await jwt({ token: { sub: "zitadel:vlad" }, account: zitadel, profile: { email: "vlad@example.test" }, trigger: "signIn" });
    expect(token).toMatchObject({ sub: "zitadel:vlad", staffUserId: STAFF_ID, signedInAt: SIGN_IN.getTime() });
  });

  it("keeps the moment as the token is refreshed — a session read hours later carries the same one", async () => {
    const signedIn = await jwt({ token: {}, account: zitadel, profile: { email: "vlad@example.test" } });
    vi.setSystemTime(new Date(SIGN_IN.getTime() + 6 * 3_600_000));
    const refreshed = await jwt({ token: signedIn });
    expect(refreshed.signedInAt).toBe(SIGN_IN.getTime());
    expect(refreshed.staffUserId).toBe(STAFF_ID);
    expect(await jwt({ token: refreshed, account: null })).toEqual(refreshed);
  });

  it("lets nothing a browser posts as an update write or move it", async () => {
    const signedIn = await jwt({ token: {}, account: zitadel, profile: { email: "vlad@example.test" } });
    vi.setSystemTime(new Date(SIGN_IN.getTime() + 3_600_000));
    const updated = await jwt({ token: signedIn, trigger: "update", session: { signedInAt: Date.now(), staffUserId: "someone-else" } });
    expect(updated).toEqual(signedIn);
  });

  it("writes none on a refresh of a token from before §1026: such a session is asked once by the gate, never re-signed", async () => {
    const old = { sub: "zitadel:vlad", staffUserId: STAFF_ID };
    expect(await jwt({ token: old })).toEqual(old);
  });

  it("writes a new moment at the next sign-in", async () => {
    const first = await jwt({ token: {}, account: zitadel, profile: { email: "vlad@example.test" } });
    vi.setSystemTime(new Date(SIGN_IN.getTime() + 86_400_000));
    const second = await jwt({ token: {}, account: zitadel, profile: { email: "vlad@example.test" } });
    expect(second.signedInAt).toBe(SIGN_IN.getTime() + 86_400_000);
    expect(first.signedInAt).toBe(SIGN_IN.getTime());
  });

  it("writes nothing for another provider's account", async () => {
    expect(await jwt({ token: { sub: "x" }, account: { provider: "github", providerAccountId: "x" } })).toEqual({ sub: "x" });
  });

  it("hands the moment to the server's session, and none when the token has none", async () => {
    const signedIn = await jwt({ token: {}, account: zitadel, profile: { email: "vlad@example.test" } });
    expect(await session({ session: { user: {} }, token: signedIn })).toMatchObject({ staffUserId: STAFF_ID, signedInAt: SIGN_IN.getTime() });
    expect(await session({ session: { user: {} }, token: { staffUserId: STAFF_ID } })).not.toHaveProperty("signedInAt");
  });

  it("is the same rule as a pure function over any token", async () => {
    const token = { sub: "s", signedInAt: 5 };
    expect(await staffTokenAt({} as never, token, null, new Date())).toBe(token);
    expect(await staffTokenAt({} as never, token, { subject: "zitadel:vlad", email: null }, SIGN_IN)).toEqual({ sub: "s", staffUserId: STAFF_ID, signedInAt: SIGN_IN.getTime() });
  });
});
