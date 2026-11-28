import { describe, expect, it } from "vitest";
import { ACS_THROTTLE_RETRY_MS, classifyAcsFailure, withoutBrackets } from "@/infrastructure/email/acs-adapter";
import { ACS_DELIVERY_REPORT, deliveryEventsOf, EVENT_GRID_VALIDATION, validationCodeOf } from "@/modules/notifications/acs-event";
import { envSchema } from "@/shared/config/env";

/** AGENTS.md §16 — the Azure Communication Services road (`docs/AZURE.md` Part 1). */
const now = new Date("2026-12-02T10:00:00.000Z");
const to = "ana@example.test";

describe("Azure SMTP failures, classified for the outbox", () => {
  it("a 5.1.1 to the runner is the bounce it is", () => {
    const error = { code: "EENVELOPE", responseCode: 550, response: "550 5.1.1 mailbox unavailable", rejected: [to], rejectedErrors: [{ recipient: to, responseCode: 550, response: "550 5.1.1 mailbox unavailable" }] };
    const result = classifyAcsFailure(to, error, now);
    expect(result.outcome).toBe("permanent_failure");
    expect(result.outcome === "permanent_failure" && result.notTheAddress).toBeFalsy();
  });

  it("a refused login is the account's, fixable and retried by a person, never BOUNCED", () => {
    const result = classifyAcsFailure(to, { code: "EAUTH", responseCode: 535, command: "AUTH LOGIN" }, now);
    expect(result).toMatchObject({ outcome: "permanent_failure", notTheAddress: true });
  });

  it("a 4xx before the message was taken — Azure's quota — waits a minute and spends no attempt", () => {
    const result = classifyAcsFailure(to, { code: "EENVELOPE", responseCode: 451, response: "451 4.5.127 Excessive message rate", command: "MAIL FROM" }, now);
    expect(result).toMatchObject({ outcome: "throttled", rateRefused: true });
    expect(result.outcome === "throttled" && result.retryAfter?.getTime()).toBe(now.getTime() + ACS_THROTTLE_RETRY_MS);
  });

  it("any other 5xx is a refusal of the account or the message", () => {
    const result = classifyAcsFailure(to, { code: "EMESSAGE", responseCode: 550, response: "550 5.7.1 sender not verified", command: "DATA" }, now);
    expect(result).toMatchObject({ outcome: "permanent_failure", notTheAddress: true });
  });

  it("a connection never made is retried; one broken after the body may have been taken", () => {
    expect(classifyAcsFailure(to, { code: "ECONNREFUSED" }, now)).toEqual({ outcome: "transient_failure", error: "acs: smtp ECONNREFUSED" });
    expect(classifyAcsFailure(to, { code: "ECONNECTION", command: "CONN", message: "Connection closed unexpectedly" }, now)).toMatchObject({
      outcome: "transient_failure",
      mayHaveBeenAccepted: true,
    });
  });

  it("stores the Message-ID without its brackets, as the webhook compares it", () => {
    expect(withoutBrackets("<abc.123@mail.example.test>")).toBe("abc.123@mail.example.test");
  });
});

describe("Event Grid's delivery reports", () => {
  const report = (status: string, extra: Record<string, unknown> = {}) => ({
    eventType: ACS_DELIVERY_REPORT,
    eventTime: "2026-12-02T09:59:00Z",
    data: { recipient: to, messageId: "op-1", internetMessageId: "<abc@mail.example.test>", status, deliveryAttemptTimestamp: "2026-12-02T09:58:00Z", ...extra },
  });

  it("answers the subscription's validation handshake with its own code", () => {
    expect(validationCodeOf([{ eventType: EVENT_GRID_VALIDATION, data: { validationCode: "CODE-1" } }])).toBe("CODE-1");
    expect(validationCodeOf([report("Delivered")])).toBeNull();
  });

  it("maps Delivered onto the outbox's delivered event, by the stored Message-ID", () => {
    const [event] = deliveryEventsOf([report("Delivered")], now);
    expect(event).toMatchObject({ event: "delivered", providerMessageId: "abc@mail.example.test", recipient: to });
    expect(event?.occurredAt?.toISOString()).toBe("2026-12-02T09:58:00.000Z");
  });

  it("makes Bounced, Suppressed, FilteredSpam and Quarantined final failures", () => {
    for (const status of ["Bounced", "Suppressed", "FilteredSpam", "Quarantined"]) {
      expect(deliveryEventsOf([report(status)], now)[0]).toMatchObject({ event: "failed", severity: "permanent" });
    }
    expect(deliveryEventsOf([report("Suppressed")], now)[0]?.cause).toBe("suppressed");
  });

  it("changes nothing for Expanded, Failed or an event with no id", () => {
    expect(deliveryEventsOf([report("Expanded"), report("Failed"), report("Delivered", { internetMessageId: null, messageId: null })], now)).toEqual([]);
  });

  it("falls back to Azure's own operation id when no Message-ID came", () => {
    expect(deliveryEventsOf([report("Delivered", { internetMessageId: undefined })], now)[0]?.providerMessageId).toBe("op-1");
  });

  it("redacts the recipient out of the server's words", () => {
    const [event] = deliveryEventsOf([report("Bounced", { deliveryStatusDetails: { statusMessage: `550 5.1.1 ${to} does not exist` } })], now);
    expect(event?.detail ?? "").not.toContain(to);
  });
});

describe("Azure's variables at startup", () => {
  const acs = { ACS_SMTP_USERNAME: "user", ACS_SMTP_PASSWORD: "secret", EMAIL_FROM_ADDRESS: "noreply@mail.example.test" };

  it("lets a transmitting mode start on Azure alone, without Mailgun", () => {
    expect(() => envSchema.parse({ APP_ENV: "qa", EMAIL_DELIVERY_MODE: "allowlist", EMAIL_ALLOWLIST: "*", ...acs })).not.toThrow();
  });

  it("refuses one of the two SMTP variables without the other", () => {
    expect(() => envSchema.parse({ ACS_SMTP_USERNAME: "user", EMAIL_FROM_ADDRESS: acs.EMAIL_FROM_ADDRESS })).toThrow(/set together/);
  });

  it("refuses Azure without a verified From address", () => {
    expect(() => envSchema.parse({ ACS_SMTP_USERNAME: "user", ACS_SMTP_PASSWORD: "secret" })).toThrow(/EMAIL_FROM_ADDRESS/);
  });

  it("still refuses a transmitting mode with neither provider", () => {
    expect(() => envSchema.parse({ APP_ENV: "qa", EMAIL_DELIVERY_MODE: "allowlist", EMAIL_ALLOWLIST: "*" })).toThrow(/ACS_SMTP_USERNAME/);
  });
});
