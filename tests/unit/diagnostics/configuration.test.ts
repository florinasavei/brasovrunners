import { describe, expect, it } from "vitest";
import {
  type ConfigurationFacts,
  describeConfiguration,
  worstStatus,
} from "@/modules/diagnostics/configuration";

/**
 * BR-REQ-090-04 — a deployment can say what it is configured to do.
 *
 * Every case below is one somebody has actually hit, or one that would cost an afternoon if
 * they did. The two that matter most are the quiet ones: capture mode on a hosted environment,
 * where registration looks broken because nobody ever receives the confirmation, and a missing
 * `JOB_SECRET`, where the symptom is not an error anywhere but email that never leaves.
 */
function facts(overrides: Partial<ConfigurationFacts> = {}): ConfigurationFacts {
  return {
    appEnv: "local",
    emailDeliveryMode: "capture",
    staffAuthMode: "dev-switcher",
    allowlistCount: 0,
    present: { JOB_SECRET: true, DATABASE_URL: true },
    ...overrides,
  };
}

const check = (result: ReturnType<typeof describeConfiguration>, key: string) =>
  result.find((entry) => entry.key === key);

describe("BR-REQ-090-04 email, where every misconfiguration has landed", () => {
  it("calls capture correct locally and limited on a deployment", () => {
    // The distinction is the whole point: the same mode is right on a laptop and a silent
    // failure on QA, because a serverless process's memory is not a mailbox anybody can read.
    expect(check(describeConfiguration(facts()), "emailCaptureLocal")?.status).toBe("ok");

    const deployed = describeConfiguration(facts({ appEnv: "qa" }));
    expect(check(deployed, "emailCaptureDeployed")?.status).toBe("limited");
  });

  it("blocks allowlist mode that is missing the provider variables, and names them", () => {
    const result = describeConfiguration(
      facts({ appEnv: "qa", emailDeliveryMode: "allowlist", allowlistCount: 1 }),
    );
    const email = check(result, "emailAllowlist");

    expect(email?.status).toBe("blocked");
    expect(email?.requires.filter((entry) => !entry.present).map((entry) => entry.variable)).toEqual(
      ["MAILGUN_API_KEY", "MAILGUN_DOMAIN", "MAILGUN_API_BASE_URL"],
    );
  });

  it("blocks allowlist mode with nobody on the list", () => {
    // It would transmit to nobody while looking like delivery — the exact combination
    // `env.ts` refuses at startup, reported here before a deploy rather than after.
    const result = describeConfiguration(
      facts({
        appEnv: "qa",
        emailDeliveryMode: "allowlist",
        allowlistCount: 0,
        present: {
          JOB_SECRET: true,
          MAILGUN_API_KEY: true,
          MAILGUN_DOMAIN: true,
          MAILGUN_API_BASE_URL: true,
        },
      }),
    );

    expect(check(result, "emailAllowlist")?.status).toBe("blocked");
  });

  it("passes a fully configured allowlist deployment", () => {
    const result = describeConfiguration(
      facts({
        appEnv: "qa",
        emailDeliveryMode: "allowlist",
        allowlistCount: 2,
        present: {
          JOB_SECRET: true,
          MAILGUN_API_KEY: true,
          MAILGUN_DOMAIN: true,
          MAILGUN_API_BASE_URL: true,
          MAILGUN_WEBHOOK_SIGNING_KEY: true,
          MAP_LINK_BASE_URL: true,
        },
      }),
    );

    expect(check(result, "emailAllowlist")?.status).toBe("ok");
    expect(worstStatus(result)).toBe("ok");
  });
});

describe("BR-REQ-090-04 the subsystems whose failure is silence", () => {
  it("blocks when JOB_SECRET is absent, because then nothing runs at all", () => {
    const result = describeConfiguration(facts({ present: { DATABASE_URL: true } }));
    expect(check(result, "jobs")?.status).toBe("blocked");
  });

  it("flags a missing webhook key only where mail is actually going out", () => {
    // In capture mode there are no bounces to receive, so it is not worth a warning.
    expect(check(describeConfiguration(facts()), "webhook")?.status).toBe("ok");

    const transmitting = describeConfiguration(
      facts({
        appEnv: "qa",
        emailDeliveryMode: "allowlist",
        allowlistCount: 1,
        present: {
          JOB_SECRET: true,
          MAILGUN_API_KEY: true,
          MAILGUN_DOMAIN: true,
          MAILGUN_API_BASE_URL: true,
        },
      }),
    );
    expect(check(transmitting, "webhook")?.status).toBe("limited");
  });

  it("blocks provider sign-in that is missing its credentials", () => {
    const result = describeConfiguration(facts({ staffAuthMode: "provider" }));
    expect(check(result, "staffProvider")?.status).toBe("blocked");
  });

  it("treats an absent auth mode as disabled rather than as a fault", () => {
    // No way in at all is a legitimate configuration: every staff route answers 404.
    const result = describeConfiguration(facts({ staffAuthMode: undefined }));
    expect(check(result, "staffDisabled")?.status).toBe("limited");
  });
});

describe("BR-REQ-090-04 the report cannot carry a value", () => {
  it("emits nothing but known variable names", () => {
    /**
     * The structural guarantee, asserted rather than trusted: the report is built from a set of
     * booleans and three enums, so there is no path from a secret into it. If somebody later
     * widens `ConfigurationFacts` to carry a value, this fails.
     */
    const KNOWN = new Set([
      "MAILGUN_API_KEY",
      "MAILGUN_DOMAIN",
      "MAILGUN_API_BASE_URL",
      "MAILGUN_WEBHOOK_SIGNING_KEY",
      "EMAIL_FROM_ADDRESS",
      "EMAIL_REPLY_TO",
      "AUTH_SECRET",
      "AUTH_ZITADEL_ID",
      "AUTH_ZITADEL_SECRET",
      "AUTH_ZITADEL_ISSUER",
      "JOB_SECRET",
      "MAP_LINK_BASE_URL",
      "DATABASE_URL",
    ]);

    const result = describeConfiguration(
      facts({ appEnv: "production", emailDeliveryMode: "live", staffAuthMode: "provider" }),
    );

    for (const entry of result) {
      for (const requirement of entry.requires) {
        expect(KNOWN.has(requirement.variable), requirement.variable).toBe(true);
      }
      // The state is a mode token, never free text from configuration.
      expect(entry.state.length).toBeLessThan(24);
    }
  });
});

describe("BR-REQ-090-04 the headline", () => {
  it("reports the worst thing, because that is what somebody came to find", () => {
    expect(worstStatus([{ key: "a", status: "ok", state: "x", requires: [] }])).toBe("ok");
    expect(
      worstStatus([
        { key: "a", status: "ok", state: "x", requires: [] },
        { key: "b", status: "limited", state: "x", requires: [] },
      ]),
    ).toBe("limited");
    expect(
      worstStatus([
        { key: "a", status: "limited", state: "x", requires: [] },
        { key: "b", status: "blocked", state: "x", requires: [] },
      ]),
    ).toBe("blocked");
  });
});
