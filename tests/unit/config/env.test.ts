import { describe, expect, it } from "vitest";
import { envSchema } from "@/shared/config/env";

/**
 * BR-REQ-101-02 — every absolute URL derives from APP_BASE_URL.
 *
 * The schema itself is imported rather than copied. `src/shared/config/env.ts` parses
 * `process.env` at import time, which is deliberate — an invalid environment must stop the
 * process — but it means importing this module runs that parse. It succeeds here because
 * every variable this test cares about has a safe default.
 *
 * The email delivery rules that also live in this schema are BR-REQ-080-03 and are asserted
 * in `tests/integration/notifications/modes.test.ts`, next to the outbox they govern.
 */
describe("BR-REQ-101-02 environment validation", () => {
  it("defaults to the local environment and a localhost base URL", () => {
    const env = envSchema.parse({});
    expect(env.APP_ENV).toBe("local");
    // The port `yarn dev` actually starts on (`scripts/dev.mjs`), not 3000.
    expect(env.APP_BASE_URL).toBe("http://localhost:47821");
  });

  it("rejects an APP_ENV outside the four named environments", () => {
    expect(() => envSchema.parse({ APP_ENV: "staging" })).toThrow();
    expect(() => envSchema.parse({ APP_ENV: "PRODUCTION" })).toThrow();
  });

  it("rejects a base URL that is not a URL, so a bare hostname cannot slip through", () => {
    expect(() => envSchema.parse({ APP_BASE_URL: "example.test" })).toThrow();
    expect(() => envSchema.parse({ APP_BASE_URL: "" })).toThrow();
  });

  it("accepts the shapes a real deployment uses", () => {
    for (const url of ["https://example.test", "https://qa.example.test", "http://localhost:3000"]) {
      expect(envSchema.parse({ APP_BASE_URL: url }).APP_BASE_URL).toBe(url);
    }
  });
});

/**
 * BR-REQ-060-01 criterion 7 — the development staff switcher never runs where real content
 * lives — plus the new `provider` mode's own startup guard (AGENTS.md §13.1, DECISIONS.md §26).
 */
describe("staff authentication mode", () => {
  const ZITADEL = {
    AUTH_SECRET: "not-a-real-secret",
    AUTH_ZITADEL_ID: "client-id",
    AUTH_ZITADEL_SECRET: "client-secret",
    AUTH_ZITADEL_ISSUER: "https://example.zitadel.cloud",
  };

  it("derives dev-switcher in local and test, and disabled everywhere else", () => {
    expect(envSchema.parse({ APP_ENV: "local" }).STAFF_AUTH_MODE).toBe("dev-switcher");
    expect(envSchema.parse({ APP_ENV: "test" }).STAFF_AUTH_MODE).toBe("dev-switcher");
    expect(envSchema.parse({ APP_ENV: "qa" }).STAFF_AUTH_MODE).toBe("disabled");
    expect(envSchema.parse({ APP_ENV: "production" }).STAFF_AUTH_MODE).toBe("disabled");
  });

  it("refuses the development switcher outside local and test", () => {
    for (const APP_ENV of ["qa", "production"] as const) {
      expect(() => envSchema.parse({ APP_ENV, STAFF_AUTH_MODE: "dev-switcher" })).toThrow(
        /development staff switcher is only permitted/,
      );
    }
  });

  it("accepts provider mode with every Zitadel credential present", () => {
    for (const APP_ENV of ["qa", "production"] as const) {
      expect(() =>
        envSchema.parse({ APP_ENV, STAFF_AUTH_MODE: "provider", ...ZITADEL }),
      ).not.toThrow();
    }
  });

  it("refuses provider mode missing any one Zitadel credential", () => {
    for (const missing of Object.keys(ZITADEL)) {
      const partial = { ...ZITADEL, [missing]: undefined };
      expect(() =>
        envSchema.parse({ APP_ENV: "qa", STAFF_AUTH_MODE: "provider", ...partial }),
      ).toThrow(/STAFF_AUTH_MODE=provider requires/);
    }
  });
});

/**
 * BR-REQ-070-04 — the contact form's way out (`DECISIONS.md` §149) is derived, never typed.
 *
 * A laptop and the test suite must never open an SMTP socket, whatever is set; a deployment
 * sends only with a sender, its password and somebody to send to; and `off` is a page that
 * shows the address, not a process that refuses to start.
 */
describe("BR-REQ-070-04 contact form mode", () => {
  const SMTP = {
    CONTACT_SMTP_USER: "club@example.com",
    CONTACT_SMTP_PASSWORD: "abcd efgh ijkl mnop",
    CONTACT_FORM_TO: "club@example.com, colleague@example.org",
  };

  it("captures locally and in tests even with every SMTP variable set", () => {
    for (const APP_ENV of ["local", "test"] as const) {
      expect(envSchema.parse({ APP_ENV, ...SMTP }).CONTACT_FORM_MODE).toBe("capture");
    }
  });

  it("sends on a deployment only with the sender, its password and a recipient", () => {
    const parsed = envSchema.parse({ APP_ENV: "production", ...SMTP });
    expect(parsed.CONTACT_FORM_MODE).toBe("smtp");
    expect(parsed.CONTACT_FORM_TO).toEqual(["club@example.com", "colleague@example.org"]);
    expect(parsed.CONTACT_SMTP_HOST).toBe("smtp.gmail.com");
    expect(parsed.CONTACT_SMTP_PORT).toBe(465);

    for (const missing of Object.keys(SMTP)) {
      const partial = { ...SMTP, [missing]: undefined };
      expect(envSchema.parse({ APP_ENV: "qa", ...partial }).CONTACT_FORM_MODE, missing).toBe("off");
    }
  });

  it("names a recipient that is not an address, because the operator typed it", () => {
    expect(() => envSchema.parse({ APP_ENV: "qa", ...SMTP, CONTACT_FORM_TO: "club@example.com; nope" })).toThrow(
      /CONTACT_FORM_TO entry is not a valid address/,
    );
    expect(() => envSchema.parse({ APP_ENV: "qa", ...SMTP, CONTACT_SMTP_USER: "not-an-address" })).toThrow();
  });
});
