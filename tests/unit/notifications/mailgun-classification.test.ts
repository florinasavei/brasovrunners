import { describe, expect, it } from "vitest";
import { classifyMailgunFailure } from "@/infrastructure/email/mailgun-adapter";
import { nextAllowanceResetAt } from "@/modules/notifications/domain/retry";

/**
 * BR-REQ-080-02, BR-REQ-080-03 — which Mailgun refusals are final, and which are the allowance.
 *
 * This mapping had a defect with a date on it. Mailgun refuses a send whose account allowance
 * is spent with the **same 400** it uses for a malformed message, and the adapter treated every
 * 400 as permanent — so on the one day the club most needs its email, a race opening entries
 * against a 100/day allowance (`docs/PLATFORM.md`, limit 1), every message queued after the cap
 * would have been marked BOUNCED and thrown away. The tests below are the fence around that.
 *
 * The two directions are not symmetric and the tests say so. Calling an allowance refusal
 * permanent loses a participant's confirmation. Calling a genuine rejection throttled retries a
 * refused message once a day forever, which is how a sending domain's reputation is spent
 * (§16.1, §16.5). Both halves are asserted; neither may be relaxed to make the other pass.
 */
describe("BR-REQ-080-03 Mailgun failure classification", () => {
  describe("the allowance is spent — retry when it resets", () => {
    it("maps Mailgun's own 420 for a refused send", () => {
      expect(
        classifyMailgunFailure(420, "Domain example.test is not allowed to send: recipient limit exceeded"),
      ).toBe("throttled");
    });

    it("maps a 402, which the account owes money rather than the message being bad", () => {
      expect(classifyMailgunFailure(402, "Payment Required")).toBe("throttled");
    });

    it("maps a 400 whose body says the limit is what refused it", () => {
      // The case the old mapping got wrong: a 400, and not the caller's fault.
      expect(
        classifyMailgunFailure(400, "Domain example.test is not allowed to send: recipient limit exceeded"),
      ).toBe("throttled");
    });

    it("matches the daily-limit wording too", () => {
      expect(classifyMailgunFailure(400, "you have exceeded your daily limit")).toBe("throttled");
    });
  });

  describe("the message is refused — never retried", () => {
    it("keeps an unauthorized sandbox recipient permanent", () => {
      // No amount of waiting authorizes a recipient. This must not drift into `throttled`
      // when the limit pattern is next widened.
      expect(
        classifyMailgunFailure(400, "'ana@example.org' is not among the authorized recipients"),
      ).toBe("permanent_failure");
    });

    it("keeps the sandbox refusal permanent", () => {
      expect(
        classifyMailgunFailure(
          400,
          "Sandbox subdomains are for test purposes only. Please add your own domain or add the address to authorized recipients in Account Settings.",
        ),
      ).toBe("permanent_failure");
    });

    it("keeps a malformed message permanent", () => {
      expect(classifyMailgunFailure(400, "to parameter is not a valid address")).toBe(
        "permanent_failure",
      );
    });

    it("keeps bad credentials and an unverified domain permanent", () => {
      expect(classifyMailgunFailure(401, "Forbidden")).toBe("permanent_failure");
      expect(classifyMailgunFailure(403, "Forbidden")).toBe("permanent_failure");
    });
  });

  describe("try again shortly", () => {
    it("keeps 429 transient, not throttled", () => {
      // Mailgun's 429 is the per-hour rate limit, which clears within the hour. Deferring it
      // to the next daily reset would delay a confirmation by a day to avoid waiting a minute.
      expect(classifyMailgunFailure(429, "Too Many Requests")).toBe("transient_failure");
    });

    it("keeps outages and unrecognised statuses transient", () => {
      expect(classifyMailgunFailure(500, "Internal Server Error")).toBe("transient_failure");
      expect(classifyMailgunFailure(503, "")).toBe("transient_failure");
      expect(classifyMailgunFailure(404, "Not Found")).toBe("transient_failure");
    });
  });
});

describe("BR-REQ-080-02 when a throttled message is tried again", () => {
  it("waits for the next UTC day, not for the ordinary backoff", () => {
    const afternoon = new Date("2026-09-05T14:22:00.000Z");
    const next = nextAllowanceResetAt(afternoon);

    expect(next.toISOString()).toBe("2026-09-06T00:05:00.000Z");
  });

  it("crosses a month boundary", () => {
    expect(nextAllowanceResetAt(new Date("2026-09-30T23:59:00.000Z")).toISOString()).toBe(
      "2026-10-01T00:05:00.000Z",
    );
  });

  it("outlasts the whole ordinary retry schedule", () => {
    // The point of the distinction: six attempts of exponential backoff are spent in about an
    // hour, so a daily cap would mark a good message FAILED before the allowance ever reset.
    const now = new Date("2026-09-05T14:22:00.000Z");
    const oneHourLater = now.getTime() + 60 * 60_000;

    expect(nextAllowanceResetAt(now).getTime()).toBeGreaterThan(oneHourLater);
  });
});
