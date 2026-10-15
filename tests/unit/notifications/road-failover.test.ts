import { describe, expect, it } from "vitest";
import type { SendResult } from "@/infrastructure/email/adapter";
import {
  otherRoad,
  planRoad,
  readRoadFailures,
  readRoadOutcome,
  RELAY_FAILOVER_AFTER,
  RELAY_PIN_RELEASE_AFTER,
  type Road,
  type RoadFailures,
  withFailure,
} from "@/modules/notifications/domain/road-failover";

/**
 * §NNN — which road carries a visitor's message next, and what a road's answer means. The rule is the owner's
 * («dacă pică un serviciu se trimite prin celălalt și invers») with its two safeguards: only the service's failures
 * count, never the recipient's, and a message that may already be with a service never goes to the other one.
 */
const BOTH = { gmail: true, mailgun: true } as const;
const failed = (count: number, ambiguous = false) => ({ count, ambiguous, lastError: "x" });
const plan = (chosen: Road, failures: RoadFailures, over: Partial<{ available: Record<Road, boolean>; fallbackAllowed: boolean }> = {}) =>
  planRoad({ chosen, failures, available: over.available ?? BOTH, fallbackAllowed: over.fallbackAllowed ?? true });

describe("§NNN planRoad: the chosen road keeps the message until it has failed it twice", () => {
  it("fails over after exactly two failures, and says so", () => {
    expect(RELAY_FAILOVER_AFTER).toBe(2);
    expect(plan("mailgun", {})).toEqual({ road: "mailgun", failedOver: false });
    expect(plan("mailgun", { mailgun: failed(1) })).toEqual({ road: "mailgun", failedOver: false });
    expect(plan("mailgun", { mailgun: failed(2) })).toEqual({ road: "gmail", failedOver: true });
  });

  it("works in both directions: Mailgun to Gmail and Gmail to Mailgun", () => {
    expect(plan("gmail", { gmail: failed(2) })).toEqual({ road: "mailgun", failedOver: true });
    expect(plan("gmail", { gmail: failed(1) })).toEqual({ road: "gmail", failedOver: false });
    expect(otherRoad("gmail")).toBe("mailgun");
    expect(otherRoad("mailgun")).toBe("gmail");
  });

  it("lets the two roads take turns once both have failed, the one that has failed less first", () => {
    expect(plan("mailgun", { mailgun: failed(2), gmail: failed(1) })).toEqual({ road: "gmail", failedOver: true });
    // Two each: back to the chosen road, which may have recovered.
    expect(plan("mailgun", { mailgun: failed(2), gmail: failed(2) })).toEqual({ road: "mailgun", failedOver: false });
    expect(plan("mailgun", { mailgun: failed(3), gmail: failed(2) })).toEqual({ road: "gmail", failedOver: true });
  });

  it("never leaves the chosen road when the message may not take the other (Girl Zone without the club's tick)", () => {
    expect(plan("mailgun", { mailgun: failed(5) }, { fallbackAllowed: false })).toEqual({ road: "mailgun", failedOver: false });
  });

  it("takes the other road at once when the chosen one does not exist or is stopped — and waits when it may not", () => {
    expect(plan("mailgun", {}, { available: { gmail: true, mailgun: false } })).toEqual({ road: "gmail", failedOver: true });
    expect(plan("gmail", {}, { available: { gmail: false, mailgun: true } })).toEqual({ road: "mailgun", failedOver: true });
    expect(plan("mailgun", {}, { available: { gmail: true, mailgun: false }, fallbackAllowed: false })).toEqual({ road: null, why: "none-available" });
    expect(plan("mailgun", {}, { available: { gmail: false, mailgun: false } })).toEqual({ road: null, why: "none-available" });
  });
});

describe("§NNN planRoad: a send that may have been accepted is pinned to its road, for a while", () => {
  it("pins the message to the road whose failure was ambiguous, until the road has failed it three times", () => {
    expect(RELAY_PIN_RELEASE_AFTER).toBe(3);
    expect(plan("mailgun", { mailgun: failed(1, true) })).toEqual({ road: "mailgun", failedOver: false });
    expect(plan("mailgun", { mailgun: failed(2, true) })).toEqual({ road: "mailgun", failedOver: false });
    expect(plan("gmail", { gmail: failed(2, true) })).toEqual({ road: "gmail", failedOver: false });
  });

  it("lets go after that: a hanging road no longer keeps the message, the other road carries it (both directions)", () => {
    expect(plan("mailgun", { mailgun: failed(3, true) })).toEqual({ road: "gmail", failedOver: true });
    expect(plan("gmail", { gmail: failed(3, true) })).toEqual({ road: "mailgun", failedOver: true });
    expect(plan("mailgun", { mailgun: failed(9, true) })).toEqual({ road: "gmail", failedOver: true });
  });

  it("lets go of a pin that is not on the chosen road in the same way: the roads take turns by their failures", () => {
    expect(plan("mailgun", { mailgun: failed(2), gmail: failed(2, true) })).toEqual({ road: "gmail", failedOver: true });
    expect(plan("mailgun", { mailgun: failed(2), gmail: failed(3, true) })).toEqual({ road: "mailgun", failedOver: false });
  });

  it("when the message may not take the other road the pin is moot: it stays on the chosen one", () => {
    expect(plan("mailgun", { mailgun: failed(9, true) }, { fallbackAllowed: false })).toEqual({ road: "mailgun", failedOver: false });
  });

  it("waits while the pinned road is stopped only when nothing else may carry the message", () => {
    const stopped = { gmail: true, mailgun: false };
    expect(plan("mailgun", { mailgun: failed(1, true) }, { available: stopped, fallbackAllowed: false })).toEqual({ road: null, why: "pinned-unavailable" });
    expect(plan("mailgun", { mailgun: failed(1, true) }, { available: { gmail: false, mailgun: false } })).toEqual({ road: null, why: "pinned-unavailable" });
    // The other road may carry it: a stopped road is not one to wait on.
    expect(plan("mailgun", { mailgun: failed(1, true) }, { available: stopped })).toEqual({ road: "gmail", failedOver: true });
  });
});

describe("§NNN withFailure and readRoadFailures", () => {
  it("counts one more, keeps the ambiguity once set, and shortens the error to a code", () => {
    const one = withFailure({}, "mailgun", { error: "mailgun 503", ambiguous: false });
    expect(one.mailgun).toEqual({ count: 1, ambiguous: false, lastError: "mailgun 503" });
    const two = withFailure(one, "mailgun", { error: "mailgun unreachable: TimeoutError", ambiguous: true });
    expect(two.mailgun).toEqual({ count: 2, ambiguous: true, lastError: "mailgun unreachable: TimeoutError" });
    const three = withFailure(two, "mailgun", { error: "mailgun 503", ambiguous: false });
    expect(three.mailgun?.ambiguous).toBe(true);
    expect(withFailure({}, "gmail", { error: "e".repeat(500), ambiguous: false }).gmail?.lastError).toHaveLength(200);
  });

  it("counts a road that said stop as all its attempts at once", () => {
    expect(withFailure({}, "mailgun", { error: "mailgun 420", ambiguous: false, immediate: true }).mailgun?.count).toBe(RELAY_FAILOVER_AFTER);
    expect(withFailure({ gmail: failed(5) }, "gmail", { error: "x", ambiguous: false, immediate: true }).gmail?.count).toBe(6);
  });

  it("reads a stored value defensively: anything it cannot read is no failures", () => {
    expect(readRoadFailures(null)).toEqual({});
    expect(readRoadFailures("nope")).toEqual({});
    expect(readRoadFailures({ gmail: { count: "3" }, mailgun: { count: -1 } })).toEqual({});
    expect(readRoadFailures({ gmail: { count: 2.9, ambiguous: true, lastError: "smtp EAUTH" }, other: { count: 1 } })).toEqual({
      gmail: { count: 2, ambiguous: true, lastError: "smtp EAUTH" },
    });
  });
});

describe("§NNN readRoadOutcome: what a road's answer means for one message", () => {
  const read = (result: SendResult) => readRoadOutcome(result);

  it("a send is a send", () => {
    expect(read({ outcome: "sent", providerMessageId: "m" })).toEqual({ kind: "sent" });
  });

  it("a refused address is the recipient's — no failover — and a refused account or message is the service's", () => {
    expect(read({ outcome: "permanent_failure", error: "gmail: the address was refused (5.1.1)" })).toEqual({ kind: "recipient", error: "gmail: the address was refused (5.1.1)" });
    expect(read({ outcome: "permanent_failure", error: "mailgun 401: Forbidden", notTheAddress: true })).toEqual({ kind: "service", error: "mailgun 401: Forbidden", immediate: false });
  });

  it("a transient failure is the service's, ambiguous when the connection broke where the service may have the message", () => {
    expect(read({ outcome: "transient_failure", error: "mailgun 503: x" })).toEqual({ kind: "service", error: "mailgun 503: x", immediate: false });
    expect(read({ outcome: "transient_failure", error: "gmail: smtp EAUTH" })).toEqual({ kind: "service", error: "gmail: smtp EAUTH", immediate: false });
    expect(read({ outcome: "transient_failure", error: "mailgun unreachable: TimeoutError", mayHaveBeenAccepted: true })).toEqual({
      kind: "ambiguous",
      error: "mailgun unreachable: TimeoutError",
    });
    // Gmail refused the address for now while a copy went: the copies are out, so the message stays on Gmail.
    expect(read({ outcome: "transient_failure", error: "gmail: the address was refused for now", addressRefusedForNow: true }).kind).toBe("ambiguous");
  });

  it("the club's own pace is not a failure; a road that says stop is, and counts as all the attempts at once", () => {
    const later = new Date("2026-10-15T12:00:00Z");
    expect(read({ outcome: "throttled", error: "gmail pace", paced: true, retryAfter: later })).toEqual({ kind: "paced", until: later });
    expect(read({ outcome: "throttled", error: "mailgun 429", paced: true, rateRefused: true, retryAfter: later })).toEqual({ kind: "service", error: "mailgun 429", immediate: true });
    expect(read({ outcome: "throttled", error: "mailgun 420: limit exceeded" })).toEqual({ kind: "service", error: "mailgun 420: limit exceeded", immediate: true });
  });
});
