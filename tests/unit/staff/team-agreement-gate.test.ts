import { describe, expect, it } from "vitest";
import { STAFF_ROLES } from "@/modules/staff-identity/domain/roles";
import {
  gateRequestOf,
  isTeamAgreementPath,
  localeOfPath,
  signInMomentOf,
  TEAM_AGREEMENT_NAME_MAX,
  TEAM_AGREEMENT_PATH,
  TEAM_AGREEMENT_REFUSAL,
  teamAgreementName,
  teamAgreementOwedThisSession,
  teamAgreementReturnTo,
} from "@/modules/staff-identity/domain/team-agreement";

/**
 * §1006 BR-REQ-060-01 — the team's undertaking at sign-in, the parts that are rules rather than reads: whether this session owes
 * it (§NNN: at every sign-in, amending §1006's once per account), the moment a session was signed in, which request is a page
 * being drawn (sent to the undertaking) and which is refused (a Server Action, a route handler), where a refused page wanted to
 * go — a same-site path only —, the undertaking's own address, and the full name typed under it.
 */
const headers = (entries: Record<string, string>) => new Headers(entries);

describe("§NNN the undertaking is owed once per sign-in, not once per account", () => {
  const SIGNED_IN = new Date("2026-11-21T07:00:00.000Z");
  const at = (offsetMs: number) => new Date(SIGNED_IN.getTime() + offsetMs);
  const owed = (lastAcceptedAt: Date | null, signedInAt: Date | null = SIGNED_IN, role: (typeof STAFF_ROLES)[number] = "CONTRIBUTOR", inForce = true) =>
    teamAgreementOwedThisSession({ subject: role, inForce, signedInAt, lastAcceptedAt });

  it("is owed when the account accepted the version in force before this session was signed in — at the previous sign-in", () => {
    expect(owed(at(-1))).toBe(true);
    expect(owed(at(-86_400_000))).toBe(true);
  });

  it("is not owed once accepted at or after the sign-in — on this sign-in, or on another device signed in since", () => {
    expect(owed(at(0))).toBe(false);
    expect(owed(at(1))).toBe(false);
    expect(owed(at(3_600_000))).toBe(false);
  });

  it("is owed when the account never accepted the version in force at a sign-in", () => {
    expect(owed(null)).toBe(true);
  });

  it("asks a session signed in before §NNN — it carries no moment — once: owed until an acceptance at a sign-in, then not", () => {
    // The per-sign-in record holds only acceptances made since §NNN shipped: any one answers such a session.
    expect(owed(null, null)).toBe(true);
    expect(owed(at(-86_400_000), null)).toBe(false);
  });

  it("never asks the Administrators, as §1006 has them, a member, or anybody while no version is in force", () => {
    for (const role of STAFF_ROLES) {
      const asked = role === "CONTRIBUTOR" || role === "COPYWRITER" || role === "MODERATOR" || role === "DEV";
      expect(owed(null, SIGNED_IN, role), role).toBe(asked);
      expect(owed(at(-1), SIGNED_IN, role), role).toBe(asked);
      expect(owed(null, SIGNED_IN, role, false), role).toBe(false);
    }
    // A subject as the session hands it — the actor, with its grants — is read by its role alone.
    expect(teamAgreementOwedThisSession({ subject: { role: "ADMIN" }, inForce: true, signedInAt: SIGNED_IN, lastAcceptedAt: null })).toBe(false);
    expect(teamAgreementOwedThisSession({ subject: { role: "MODERATOR" }, inForce: true, signedInAt: SIGNED_IN, lastAcceptedAt: null })).toBe(true);
  });
});

describe("§NNN the moment a session was signed in, as its claim carries it", () => {
  it("reads milliseconds since the epoch — a number in Auth.js's token, digits in the development sign-in's cookie", () => {
    const ms = Date.parse("2026-11-21T07:00:00.000Z");
    expect(signInMomentOf(ms)?.toISOString()).toBe("2026-11-21T07:00:00.000Z");
    expect(signInMomentOf(String(ms))?.toISOString()).toBe("2026-11-21T07:00:00.000Z");
  });

  it("is no moment for a session from before §NNN, nor for anything that is not a whole, positive number of milliseconds", () => {
    for (const claim of [undefined, null, "", "abc", "12.5", "-5", " 1", "1e12", "9".repeat(16), 0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, {}, [1]]) {
      expect(signInMomentOf(claim), String(claim)).toBeNull();
    }
  });
});

describe("§1006 which request the gate sends to the undertaking, and which it refuses", () => {
  it("sends a page being drawn, the path the proxy wrote kept", () => {
    expect(gateRequestOf(headers({ "x-br-path": "/ro/admin/checkin/ABC123" }))).toEqual({ kind: "page", path: "/ro/admin/checkin/ABC123" });
    // A router request is a page too (`RSC: 1`), its own parameter dropped later by the way back.
    expect(gateRequestOf(headers({ "x-br-path": "/ro/admin/guide?_rsc=1x2y", rsc: "1" }))).toEqual({ kind: "page", path: "/ro/admin/guide?_rsc=1x2y" });
  });

  it("refuses a Server Action, whatever page it was posted from", () => {
    expect(gateRequestOf(headers({ "x-br-path": "/ro/admin/checkin", "next-action": "7f3a" }))).toEqual({ kind: "refuse" });
  });

  it("refuses a route handler: the proxy does not run on /api, so no path reaches one", () => {
    expect(gateRequestOf(headers({}))).toEqual({ kind: "refuse" });
    expect(gateRequestOf(headers({ "x-br-path": "" }))).toEqual({ kind: "refuse" });
  });

  it("says, for the logs, what to do — never who", () => {
    expect(TEAM_AGREEMENT_REFUSAL).toMatch(/accept it on \/admin\/acord/);
    expect(TEAM_AGREEMENT_REFUSAL).not.toMatch(/@/);
  });
});

describe("§1006 the undertaking's own page", () => {
  it("is /admin/acord, with or without its locale, its query or a trailing slash", () => {
    expect(TEAM_AGREEMENT_PATH).toBe("/admin/acord");
    for (const path of ["/admin/acord", "/ro/admin/acord", "/en/admin/acord", "/ro/admin/acord?returnTo=%2Fro%2Fadmin", "/ro/admin/acord/"]) {
      expect(isTeamAgreementPath(path), path).toBe(true);
    }
  });

  it("is no other page", () => {
    for (const path of ["/ro/admin", "/ro/admin/acordx", "/ro/admin/checkin", "/ro/acord", "/ro/admin/acord/more", null, undefined, ""]) {
      expect(isTeamAgreementPath(path), String(path)).toBe(false);
    }
  });
});

describe("§1006 the way back — a same-site path only", () => {
  it("keeps where a page wanted to go, its query included", () => {
    expect(teamAgreementReturnTo("/ro/admin/checkin/ABC123")).toBe("/ro/admin/checkin/ABC123");
    expect(teamAgreementReturnTo("/ro/admin/checkin?eventId=e1&q=Ana")).toBe("/ro/admin/checkin?eventId=e1&q=Ana");
    expect(teamAgreementReturnTo("/ro/devs")).toBe("/ro/devs");
  });

  it("drops the router's own parameter and a fragment", () => {
    expect(teamAgreementReturnTo("/ro/admin/guide?_rsc=abc")).toBe("/ro/admin/guide");
    expect(teamAgreementReturnTo("/ro/admin/checkin?eventId=e1&_rsc=abc#row")).toBe("/ro/admin/checkin?eventId=e1");
  });

  it("refuses anything that is not a path on this site — never an open redirect", () => {
    for (const value of [
      "https://example.test/ro/admin",
      "//example.test/ro/admin",
      "/\\example.test",
      "/ro/admin\\..\\x",
      "ro/admin",
      "javascript:alert(1)",
      "/ro/admin\n/next",
      `/${"a".repeat(600)}`,
      "",
      null,
      undefined,
    ]) {
      expect(teamAgreementReturnTo(value), String(value)).toBeNull();
    }
  });

  it("is never the undertaking itself: a way back to the page you are on is none", () => {
    expect(teamAgreementReturnTo("/ro/admin/acord")).toBeNull();
    expect(teamAgreementReturnTo("/ro/admin/acord?returnTo=%2Fro%2Fadmin")).toBeNull();
  });

  it("reads the locale a path starts with", () => {
    expect(localeOfPath("/en/admin/checkin")).toBe("en");
    expect(localeOfPath("/ro")).toBe("ro");
    expect(localeOfPath("/ro?x=1")).toBe("ro");
    expect(localeOfPath("/admin")).toBeNull();
    expect(localeOfPath(null)).toBeNull();
  });
});

describe("§1006 the full name typed under the undertaking", () => {
  it("is trimmed, its spaces collapsed, 1 to 200 characters", () => {
    expect(teamAgreementName("  Ana   Maria\tPop ")).toBe("Ana Maria Pop");
    expect(teamAgreementName("A")).toBe("A");
    expect(teamAgreementName("x".repeat(TEAM_AGREEMENT_NAME_MAX))).toHaveLength(200);
  });

  it("is nothing when empty, only spaces, too long or not a string", () => {
    expect(TEAM_AGREEMENT_NAME_MAX).toBe(200);
    for (const value of ["", "   ", "\n\t", "x".repeat(201), undefined, null, 42]) {
      expect(teamAgreementName(value), String(value)).toBeNull();
    }
  });
});
