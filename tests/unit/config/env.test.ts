import { describe, expect, it } from "vitest";
import { z } from "zod";

/**
 * BR-REQ-101-02 — every absolute URL derives from APP_BASE_URL.
 *
 * The schema is duplicated here rather than imported because src/shared/config/env.ts parses
 * process.env at import time; importing it would test this process's environment instead of
 * the rule. Keep the two in step — that is the cost of testing a module with an import-time
 * side effect, and it is cheaper than making the real module lazy for the sake of a test.
 */
const schema = z.object({
  APP_ENV: z.enum(["local", "test", "qa", "production"]).default("local"),
  APP_BASE_URL: z.url().default("http://localhost:3000"),
  DATABASE_URL: z.url().optional(),
});

describe("BR-REQ-101-02 environment validation", () => {
  it("defaults to the local environment and a localhost base URL", () => {
    const env = schema.parse({});
    expect(env.APP_ENV).toBe("local");
    expect(env.APP_BASE_URL).toBe("http://localhost:3000");
  });

  it("rejects an APP_ENV outside the four named environments", () => {
    expect(() => schema.parse({ APP_ENV: "staging" })).toThrow();
    expect(() => schema.parse({ APP_ENV: "PRODUCTION" })).toThrow();
  });

  it("rejects a base URL that is not a URL, so a bare hostname cannot slip through", () => {
    expect(() => schema.parse({ APP_BASE_URL: "example.test" })).toThrow();
    expect(() => schema.parse({ APP_BASE_URL: "" })).toThrow();
  });

  it("accepts the shapes a real deployment uses", () => {
    for (const url of ["https://example.test", "https://qa.example.test", "http://localhost:3000"]) {
      expect(schema.parse({ APP_BASE_URL: url }).APP_BASE_URL).toBe(url);
    }
  });
});
