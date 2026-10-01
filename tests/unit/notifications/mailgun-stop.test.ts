import { describe, expect, it } from "vitest";
import { classifyMailgunFailure } from "@/infrastructure/email/mailgun-adapter";
import { RATE_PAUSE_ERROR_PREFIX } from "@/modules/notifications/domain/hourly-pace";
import {
  ALLOWANCE_DEFERRED_ERROR_PREFIX,
  FALLBACK_RETRY_MS,
  FALLBACK_WAITING_ERROR_PREFIX,
  fallbackActive,
  fallbackRetryAt,
  fallbackSwitchOn,
  fallbackUnavailable,
  heldByMailgun,
  routeWhileStopped,
  stopInForce,
} from "@/modules/notifications/domain/mailgun-stop";
import { DEFAULT_EMAIL_TRANSPORT, emailTransportSettingSchema } from "@/modules/notifications/domain/email-transport";
import { MAX_RETRY_DELAY_MS, MAX_SEND_ATTEMPTS, nextAttemptDelayMs } from "@/modules/notifications/domain/retry";

/**
 * BR-REQ-080-02 (§NNN) — email fail-safes, the pure half: which refusal ends a message and which
 * never does, what a stop is, and which road a due Mailgun row takes while Mailgun says stop.
 */
const NOW = new Date("2026-10-01T09:30:00.000Z");
const MINUTE = 60_000;
const PAUSE = { kind: "paused" as const, until: new Date(NOW.getTime() + 15 * MINUTE) };
const ALLOWANCE = { kind: "allowance" as const, until: new Date("2026-10-02T00:05:00.000Z") };

describe("§NNN the classification: only a refusal of the message ends it", () => {
  it("keeps a transient refusal retrying past the sixth attempt, hourly", () => {
    // The backoff's own ceiling is the hourly turn a row keeps once past the six attempts.
    expect(nextAttemptDelayMs(MAX_SEND_ATTEMPTS + 1)).toBe(MAX_RETRY_DELAY_MS);
    expect(nextAttemptDelayMs(MAX_SEND_ATTEMPTS + 20)).toBe(60 * MINUTE);
    expect(classifyMailgunFailure(503, "Service Unavailable").outcome).toBe("transient_failure");
    expect(classifyMailgunFailure(404, "").outcome).toBe("transient_failure");
  });

  it("calls the account's and the message's refusals FAILED, not the address's", () => {
    expect(classifyMailgunFailure(401, "Forbidden")).toEqual({ outcome: "permanent_failure", notTheAddress: true });
    expect(classifyMailgunFailure(403, "Forbidden")).toEqual({ outcome: "permanent_failure", notTheAddress: true });
    expect(classifyMailgunFailure(400, "Domain example.test is not allowed to send: domain is not verified")).toEqual({
      outcome: "permanent_failure",
      notTheAddress: true,
    });
    expect(classifyMailgunFailure(400, "Need at least one of 'text' or 'html' parameters specified")).toEqual({
      outcome: "permanent_failure",
      notTheAddress: true,
    });
  });

  it("calls a refused sender the club's configuration, FAILED — not a bounce", () => {
    expect(classifyMailgunFailure(400, "'from' parameter is not a valid address. please check documentation")).toEqual({
      outcome: "permanent_failure",
      notTheAddress: true,
    });
  });

  it("keeps an address problem a bounce", () => {
    expect(classifyMailgunFailure(400, "'to' parameter is not a valid address. please check documentation")).toEqual({ outcome: "permanent_failure" });
    expect(classifyMailgunFailure(400, "'ana@example.org' is not among the authorized recipients")).toEqual({ outcome: "permanent_failure" });
  });

  it("still calls a pause a pause and a spent allowance a deferral", () => {
    expect(classifyMailgunFailure(429, "", undefined, NOW)).toMatchObject({ outcome: "throttled", paced: true, rateRefused: true });
    expect(classifyMailgunFailure(420, "recipient limit exceeded")).toEqual({ outcome: "throttled" });
  });
});

describe("§NNN the stop and its marks", () => {
  it("reads a row Mailgun held back by its mark, and no other", () => {
    expect(heldByMailgun(`${RATE_PAUSE_ERROR_PREFIX}mailgun 429: slow down`)).toBe(true);
    expect(heldByMailgun(`${ALLOWANCE_DEFERRED_ERROR_PREFIX}mailgun 420: limit exceeded`)).toBe(true);
    expect(heldByMailgun(`${FALLBACK_WAITING_ERROR_PREFIX}gmail daily cap: deferred`)).toBe(false);
    expect(heldByMailgun("mailgun 502: bad gateway")).toBe(false);
    expect(heldByMailgun(null)).toBe(false);
  });

  it("puts a pause before the allowance, and neither once it has ended", () => {
    expect(stopInForce({ pausedUntil: PAUSE.until, allowanceUntil: ALLOWANCE.until }, NOW)).toEqual(PAUSE);
    expect(stopInForce({ pausedUntil: new Date(NOW.getTime() - MINUTE), allowanceUntil: ALLOWANCE.until }, NOW)).toEqual(ALLOWANCE);
    expect(stopInForce({ pausedUntil: null, allowanceUntil: new Date(NOW.getTime() - 1) }, NOW)).toBeNull();
  });

  it("acts on the switch only where Gmail is configured, and reads a value stored before it as on", () => {
    expect(fallbackActive({}, true, true)).toBe(true);
    expect(fallbackActive({ fallbackToGmail: true }, false, true)).toBe(false);
    expect(fallbackActive({ fallbackToGmail: false }, true, true)).toBe(false);
    expect(fallbackSwitchOn({})).toBe(true);
    expect(fallbackSwitchOn({ fallbackToGmail: false })).toBe(false);
    expect(DEFAULT_EMAIL_TRANSPORT.fallbackToGmail).toBe(true);
    // A value stored before the switch existed still reads: the field is optional, and absent is on.
    const stored: Record<string, unknown> = { ...DEFAULT_EMAIL_TRANSPORT };
    delete stored.fallbackToGmail;
    expect(emailTransportSettingSchema.safeParse(stored).success).toBe(true);
  });

  /*
    The notice's gate (§NNN, §443): a participant's message leaves through Google only under a privacy
    notice that names `{{gmailFallback}}` — the switch on, Gmail configured and the notice: three states.
  */
  it("acts only while the notice in force names the fallback, whatever the switch says", () => {
    // 1. the notice does not name it: off, even with the switch on and the account configured — greyed for the notice.
    expect(fallbackActive({}, true, false)).toBe(false);
    expect(fallbackActive({ fallbackToGmail: true }, true, false)).toBe(false);
    expect(fallbackUnavailable(true, false)).toBe("noticeMissing");
    // 2. the notice names it and the switch is absent or on: on.
    expect(fallbackActive({}, true, true)).toBe(true);
    expect(fallbackUnavailable(true, true)).toBeNull();
    // 3. the notice names it, the club turned the switch off: off, and not greyed — it is the club's choice.
    expect(fallbackActive({ fallbackToGmail: false }, true, true)).toBe(false);
    // Gmail not configured is said first: no notice makes an absent account carry.
    expect(fallbackActive({}, false, true)).toBe(false);
    expect(fallbackUnavailable(false, false)).toBe("gmailUnconfigured");
  });

  it("holds a row Gmail could not carry until Gmail's room or a quarter of an hour, never past Mailgun's return", () => {
    expect(fallbackRetryAt(NOW, PAUSE, undefined)).toEqual(new Date(NOW.getTime() + FALLBACK_RETRY_MS));
    expect(fallbackRetryAt(NOW, PAUSE, new Date(NOW.getTime() + 5 * MINUTE))).toEqual(new Date(NOW.getTime() + 5 * MINUTE));
    expect(fallbackRetryAt(NOW, { ...PAUSE, until: new Date(NOW.getTime() + 3 * MINUTE) }, undefined)).toEqual(new Date(NOW.getTime() + 3 * MINUTE));
    expect(fallbackRetryAt(NOW, ALLOWANCE, new Date("2026-10-02T08:00:00.000Z"))).toEqual(ALLOWANCE.until);
  });
});

describe("§NNN the route while Mailgun is stopped: stopped × switch × Gmail's room", () => {
  const base = { fallbackToGmail: true, noticeNamesFallback: true, gmailConfigured: true, gmailRoom: 50 };

  it("is Mailgun's road while Mailgun is not stopped, whatever the switch", () => {
    expect(routeWhileStopped({ ...base, stop: null })).toEqual({ road: "mailgun" });
    expect(routeWhileStopped({ ...base, stop: null, fallbackToGmail: false, gmailRoom: 0 })).toEqual({ road: "mailgun" });
  });

  it("is Gmail's while stopped with the switch on and room in Gmail's day — a pause or a spent allowance alike", () => {
    expect(routeWhileStopped({ ...base, stop: PAUSE })).toEqual({ road: "gmail", stop: PAUSE });
    expect(routeWhileStopped({ ...base, stop: ALLOWANCE })).toEqual({ road: "gmail", stop: ALLOWANCE });
  });

  it("waits, naming the remedy, when the switch is off or Gmail has no room or no account", () => {
    expect(routeWhileStopped({ ...base, stop: PAUSE, fallbackToGmail: false })).toEqual({ road: "wait", stop: PAUSE, reason: "fallbackOff" });
    expect(routeWhileStopped({ ...base, stop: PAUSE, gmailRoom: 0 })).toEqual({ road: "wait", stop: PAUSE, reason: "gmailCapSpent" });
    expect(routeWhileStopped({ ...base, stop: ALLOWANCE, gmailRoom: 3, needed: 4 })).toEqual({ road: "wait", stop: ALLOWANCE, reason: "gmailCapSpent" });
    // The notice not naming the fallback (§NNN): its own reason, the remedy being the notice, after the switch's.
    expect(routeWhileStopped({ ...base, stop: PAUSE, noticeNamesFallback: false })).toEqual({ road: "wait", stop: PAUSE, reason: "noticeMissing" });
    expect(routeWhileStopped({ ...base, stop: PAUSE, noticeNamesFallback: false, fallbackToGmail: false })).toEqual({ road: "wait", stop: PAUSE, reason: "fallbackOff" });
    // Not configured is said before the switch: a deployment without the account cannot turn it on.
    expect(routeWhileStopped({ ...base, stop: PAUSE, gmailConfigured: false, fallbackToGmail: false })).toEqual({
      road: "wait",
      stop: PAUSE,
      reason: "gmailUnconfigured",
    });
  });
});
