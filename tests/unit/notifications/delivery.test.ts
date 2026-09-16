import { describe, expect, it } from "vitest";
import {
  decideDelivery,
  markSubjectForEnvironment,
  QA_SUBJECT_PREFIX,
} from "@/infrastructure/email/delivery";

/**
 * BR-REQ-080-03 criteria 1 and 2, as pure rules. The integration test runs them through a real
 * outbox batch; these state what "captured", "allowlisted" and "marked" mean.
 */
describe("BR-REQ-080-03 which recipients may be transmitted to", () => {
  const allowlist = ["qa.tester@example.ro", "ana@gmail.com"];

  it("captures everything in capture mode, allowlist or not", () => {
    expect(decideDelivery("capture", "qa.tester@example.ro", allowlist)).toBe("capture");
    expect(decideDelivery("capture", "stranger@example.ro", allowlist)).toBe("capture");
  });

  it("sends everything in live mode", () => {
    expect(decideDelivery("live", "stranger@example.ro", [])).toBe("send");
  });

  it("sends to an allowlisted address and captures the rest", () => {
    expect(decideDelivery("allowlist", "qa.tester@example.ro", allowlist)).toBe("send");
    expect(decideDelivery("allowlist", "stranger@example.ro", allowlist)).toBe("capture");
  });

  it("compares by canonical identity, not by string", () => {
    // AGENTS.md §10.4 and the rule table in CLAUDE.md: never a raw string compare. All three
    // of these reach the same inbox as the allowlisted `ana@gmail.com`.
    expect(decideDelivery("allowlist", "a.n.a@gmail.com", allowlist)).toBe("send");
    expect(decideDelivery("allowlist", "ana+qa@googlemail.com", allowlist)).toBe("send");
    expect(decideDelivery("allowlist", "  ANA@GMAIL.COM  ", allowlist)).toBe("send");
  });

  it("does not treat a dotted custom-domain address as the same person", () => {
    // On a custom domain those may be two humans, so the allowlist must not widen.
    expect(decideDelivery("allowlist", "qa.tester@example.ro", ["qatester@example.ro"])).toBe(
      "capture",
    );
  });

  it("captures an address it cannot canonicalize rather than attempting to send", () => {
    expect(decideDelivery("allowlist", "not-an-address", allowlist)).toBe("capture");
    expect(decideDelivery("allowlist", "", allowlist)).toBe("capture");
  });

  it("captures everything when the allowlist is empty", () => {
    expect(decideDelivery("allowlist", "qa.tester@example.ro", [])).toBe("capture");
  });

  it("ignores a malformed allowlist entry instead of failing open", () => {
    expect(decideDelivery("allowlist", "qa.tester@example.ro", ["not-an-address"])).toBe("capture");
  });
});

describe("BR-REQ-080-03 criterion 2 — a QA message is visibly marked", () => {
  it("prefixes the subject in QA", () => {
    expect(markSubjectForEnvironment("Confirmă-ți înscrierea", "qa")).toBe(
      `${QA_SUBJECT_PREFIX}Confirmă-ți înscrierea`,
    );
  });

  it("leaves every other environment's subject alone", () => {
    for (const appEnv of ["local", "test", "production"] as const) {
      expect(markSubjectForEnvironment("Confirmă-ți înscrierea", appEnv)).toBe(
        "Confirmă-ți înscrierea",
      );
    }
  });

  it("does not stack prefixes when a QA message is resent", () => {
    const once = markSubjectForEnvironment("Confirmă-ți înscrierea", "qa");

    expect(markSubjectForEnvironment(once, "qa")).toBe(once);
  });
});
