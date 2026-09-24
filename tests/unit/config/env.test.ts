import { describe, expect, it, vi } from "vitest";
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

  it("drops a trailing slash once, so every `${APP_BASE_URL}${pathname}` join reads the same", () => {
    // Typed by a person into a dashboard; `z.url()` accepts `https://host/`, and some forty
    // call sites concatenate a pathname onto the value. Normalised here, once, not at each.
    expect(envSchema.parse({ APP_BASE_URL: "https://example.test/" }).APP_BASE_URL).toBe("https://example.test");
    expect(envSchema.parse({ APP_BASE_URL: "https://example.test//" }).APP_BASE_URL).toBe("https://example.test");
    // A path prefix is kept; only the slash at the end goes.
    expect(envSchema.parse({ APP_BASE_URL: "https://example.test/site/" }).APP_BASE_URL).toBe("https://example.test/site");
    // The join the call sites make, on the value they are given.
    const base = envSchema.parse({ APP_BASE_URL: "https://example.test/" }).APP_BASE_URL;
    expect(`${base}/ro/evenimente`).toBe("https://example.test/ro/evenimente");
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

  it("sends on a deployment with the sender and its password; the recipients are the club's", () => {
    const parsed = envSchema.parse({ APP_ENV: "production", ...SMTP });
    expect(parsed.CONTACT_FORM_MODE).toBe("smtp");
    expect(parsed.CONTACT_FORM_TO).toEqual(["club@example.com", "colleague@example.org"]);
    expect(parsed.CONTACT_SMTP_HOST).toBe("smtp.gmail.com");
    expect(parsed.CONTACT_SMTP_PORT).toBe(465);

    // Since §164 the mode is about the transport alone: the recipients live in
    // `platform_settings`, which a startup-time derivation cannot see, so an empty
    // `CONTACT_FORM_TO` is no longer `off` — `contact/delivery.ts` decides who it reaches.
    for (const missing of ["CONTACT_SMTP_USER", "CONTACT_SMTP_PASSWORD"]) {
      const partial = { ...SMTP, [missing]: undefined };
      expect(envSchema.parse({ APP_ENV: "qa", ...partial }).CONTACT_FORM_MODE, missing).toBe("off");
    }
    expect(envSchema.parse({ APP_ENV: "qa", ...SMTP, CONTACT_FORM_TO: undefined }).CONTACT_FORM_MODE).toBe("smtp");
  });

  it("names a recipient that is not an address, because the operator typed it", () => {
    expect(() => envSchema.parse({ APP_ENV: "qa", ...SMTP, CONTACT_FORM_TO: "club@example.com; nope" })).toThrow(
      /CONTACT_FORM_TO entry is not a valid address/,
    );
    expect(() => envSchema.parse({ APP_ENV: "qa", ...SMTP, CONTACT_SMTP_USER: "not-an-address" })).toThrow();
  });
});

/**
 * `DECISIONS.md` §163 — the star is an allowlist entry, and the schema must let a deployment
 * carrying it boot: the QA build of 2026-09-20 failed because the per-entry address check
 * refused it.
 */
describe("EMAIL_ALLOWLIST accepts the star", () => {
  const base = {
    APP_ENV: "qa",
    DATABASE_URL: "postgres://u:p@h/db",
    APP_BASE_URL: "https://qa.example.test",
    MAILGUN_API_KEY: "key",
    MAILGUN_DOMAIN: "mail.example.test",
    MAILGUN_API_BASE_URL: "https://api.example.test",
  };
  it("parses in allowlist mode and refuses it anywhere else", () => {
    const ok = envSchema.safeParse({ ...base, EMAIL_DELIVERY_MODE: "allowlist", EMAIL_ALLOWLIST: "*" });
    expect(ok.success, ok.success ? "" : JSON.stringify(ok.error.issues)).toBe(true);
    const mixed = envSchema.safeParse({ ...base, EMAIL_DELIVERY_MODE: "allowlist", EMAIL_ALLOWLIST: "ana@dev.test, *" });
    expect(mixed.success).toBe(true);
    const captured = envSchema.safeParse({ ...base, EMAIL_DELIVERY_MODE: "capture", EMAIL_ALLOWLIST: "*" });
    expect(captured.success).toBe(false);
    const rubbish = envSchema.safeParse({ ...base, EMAIL_DELIVERY_MODE: "allowlist", EMAIL_ALLOWLIST: "not-an-address" });
    expect(rubbish.success).toBe(false);
  });
});

/**
 * §NNN (Neon limits) — `E2E_DISABLE_NEON` keeps the end-to-end suite's server off the real Neon
 * API, and nothing else: on production it would switch off the 80% quota warning the owner kept
 * production capped for (§327), so a production process ignores it and says so in the log.
 */
describe("E2E_DISABLE_NEON never reaches production", () => {
  const NEON = { NEON_API_KEY: "napi_test", NEON_PROJECT_ID: "project-test" };

  it("blanks both Neon variables where the suite runs", () => {
    for (const APP_ENV of ["local", "test", "qa"] as const) {
      const parsed = envSchema.parse({ APP_ENV, ...NEON, E2E_DISABLE_NEON: "true" });
      expect(parsed.NEON_API_KEY, APP_ENV).toBeUndefined();
      expect(parsed.NEON_PROJECT_ID, APP_ENV).toBeUndefined();
      expect(parsed.E2E_DISABLE_NEON, APP_ENV).toBe(true);
    }
  });

  it("is ignored on production, with a warning, and the key stays", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const parsed = envSchema.parse({ APP_ENV: "production", ...NEON, E2E_DISABLE_NEON: "true" });
    expect(parsed.NEON_API_KEY).toBe("napi_test");
    expect(parsed.NEON_PROJECT_ID).toBe("project-test");
    expect(parsed.E2E_DISABLE_NEON).toBe(false);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).toContain("E2E_DISABLE_NEON");
    // The warning names the variable, never its neighbour's value.
    expect(String(warn.mock.calls[0][0])).not.toContain("napi_test");
    warn.mockRestore();
  });

  it("says nothing when it is not set", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    expect(envSchema.parse({ APP_ENV: "production", ...NEON }).NEON_API_KEY).toBe("napi_test");
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });
});
