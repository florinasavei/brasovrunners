import { describe, expect, it, vi } from "vitest";

/**
 * AGENTS.md §16.2 — the job endpoints' scoped-secret check.
 *
 * `env` is mocked because `isAuthorizedJobRequest` reads `env.JOB_SECRET` directly, and this
 * repository's `env` is parsed once from `process.env` at import time (`shared/config/env.ts`)
 * — the same reasoning `tests/unit/config/env.test.ts` documents for testing that module via
 * `envSchema.parse` instead of mutating `process.env` after the fact.
 */
vi.mock("@/shared/config/env", () => ({ env: { JOB_SECRET: "correct-secret-value" } }));

const { isAuthorizedJobRequest } = await import("@/modules/jobs/auth");

function requestWith(authorization?: string): Request {
  return new Request("https://example.test/api/internal/jobs/x", {
    method: "POST",
    headers: authorization ? { authorization } : {},
  });
}

describe("job request authorization", () => {
  it("accepts the correct bearer secret", () => {
    expect(isAuthorizedJobRequest(requestWith("Bearer correct-secret-value"))).toBe(true);
  });

  it("refuses a missing Authorization header", () => {
    expect(isAuthorizedJobRequest(requestWith())).toBe(false);
  });

  it("refuses the wrong secret", () => {
    expect(isAuthorizedJobRequest(requestWith("Bearer wrong-secret"))).toBe(false);
  });

  it("refuses a secret of a different length without throwing", () => {
    expect(isAuthorizedJobRequest(requestWith("Bearer short"))).toBe(false);
  });

  it("is case-insensitive about the Bearer prefix", () => {
    expect(isAuthorizedJobRequest(requestWith("bearer correct-secret-value"))).toBe(true);
  });
});
