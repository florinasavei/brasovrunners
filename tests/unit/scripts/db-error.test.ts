import { describe, expect, it } from "vitest";
import { causesOf, describeError, remedyOf } from "../../../scripts/db-error.mjs";

/**
 * BR-REQ-090-02 — a failed migration names its cause (§NNN). On 2026-10-28 three QA migration runs printed only drizzle's
 * «Failed query: select to_regclass('drizzle.__drizzle_migrations') is not null as present»; the cause, Neon's quota
 * suspension, was one `.cause` deeper.
 */
const wrapped = (cause: object) => Object.assign(new Error("Failed query: select to_regclass('drizzle.__drizzle_migrations') is not null as present\nparams: "), { cause });

describe("BR-REQ-090-02 a database error names its cause and what to do (§NNN)", () => {
  it("prints every level of the cause chain with its code", () => {
    const error = wrapped({ code: "53000", message: "Your account or project has exceeded the compute time quota. Upgrade your plan to increase limits." });
    const text = describeError(error);
    expect(text).toMatch(/^Failed query: select to_regclass/);
    expect(text).toMatch(/caused by: 53000 Your account or project has exceeded the compute time quota/);
    expect(text).toMatch(/what to do: Neon suspended this project/);
    expect(causesOf(error)).toHaveLength(2);
  });

  it("recognises the causes met so far, and says nothing it cannot back", () => {
    expect(remedyOf(wrapped({ code: "53000", message: "quota exceeded" }))).toMatch(/set it to 0, start the compute, set it back/);
    expect(remedyOf(wrapped({ code: "28P01", message: "password authentication failed for user" }))).toMatch(/password/);
    expect(remedyOf(Object.assign(new Error("getaddrinfo ENOTFOUND ep-x.neon.tech"), { code: "ENOTFOUND" }))).toMatch(/host name/);
    expect(remedyOf(new Error("relation «x» does not exist"))).toBeNull();
    expect(describeError(new Error("plain"))).toBe("plain");
  });

  it("stops on a cause chain that loops", () => {
    const a: { message: string; cause?: unknown } = { message: "a" };
    a.cause = a;
    expect(causesOf(a)).toEqual(["a"]);
  });
});
