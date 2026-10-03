import { describe, expect, it } from "vitest";
import { DEADLINE_RULES, DEFAULT_DEADLINES, deadlinesSettingSchema, readDeadlinesValue } from "@/modules/deadlines/domain/deadlines";
import {
  AUTOMATIC_SEND_KEYS,
  type ConfirmationRetryCandidate,
  dueConfirmationRetries,
  isConfirmationRetry,
  isConfirmationRetryDue,
  planConfirmationRetries,
  type VerificationEmailRow,
} from "@/modules/notifications/domain/automatic-sends";

/** §NNN — who is owed the second verification email, and from when to when: the pure formula. */
const T = new Date("2026-10-03T08:00:00.000Z");
const HOUR = 60 * 60_000;
const at = (hours: number) => new Date(T.getTime() + hours * HOUR);

function candidate(overrides: Partial<ConfirmationRetryCandidate> = {}): ConfirmationRetryCandidate {
  return { registrationId: "r1", participantId: "p1", eventId: "e1", linkExpiresAt: at(48), startsAt: at(24 * 30), ...overrides };
}

function email(overrides: Partial<VerificationEmailRow> = {}): VerificationEmailRow {
  return { id: "m1", registrationId: "r1", participantId: "p1", eventId: "e1", status: "SENT", sentAt: T, createdAt: T, retry: false, ...overrides };
}

const settings = { confirmationRetryHours: 24, confirmationRetryLeftHours: 6 };

describe("§NNN the second verification email: the formula", () => {
  it("is due the club's hours after the email left, until the link has the club's least time left", () => {
    const [plan] = planConfirmationRetries([candidate()], [email()], settings);
    expect(plan).toMatchObject({ registrationId: "r1", anchorId: "m1", at: at(24), latest: at(42) });
    expect(isConfirmationRetryDue(plan, at(23.9))).toBe(false);
    expect(isConfirmationRetryDue(plan, at(24))).toBe(true);
    expect(isConfirmationRetryDue(plan, at(42))).toBe(true);
    expect(isConfirmationRetryDue(plan, at(42.1))).toBe(false);
  });

  it("plans nothing at 0 hours, before an email left, while one waits to leave, or after a bounce or a complaint", () => {
    expect(planConfirmationRetries([candidate()], [email()], { ...settings, confirmationRetryHours: 0 })).toEqual([]);
    expect(planConfirmationRetries([candidate()], [], settings)).toEqual([]);
    expect(planConfirmationRetries([candidate()], [email({ status: "PENDING", sentAt: null })], settings)).toEqual([]);
    expect(planConfirmationRetries([candidate()], [email(), email({ id: "m2", status: "PROCESSING", sentAt: null })], settings)).toEqual([]);
    expect(planConfirmationRetries([candidate()], [email({ status: "BOUNCED" })], settings)).toEqual([]);
    expect(planConfirmationRetries([candidate()], [email(), email({ id: "m2", status: "COMPLAINED" })], settings)).toEqual([]);
    expect(planConfirmationRetries([candidate()], [email({ status: "FAILED", sentAt: null })], settings)).toEqual([]);
  });

  it("never follows a second email, and none twice for the same email", () => {
    expect(planConfirmationRetries([candidate()], [email({ id: "m1", retry: true })], settings)).toEqual([]);
    expect(planConfirmationRetries([candidate()], [email(), email({ id: "m2", retry: true, sentAt: at(24), createdAt: at(24) })], settings)).toEqual([]);
  });

  it("follows the newest email the person or the club asked for, from its own departure", () => {
    const [plan] = planConfirmationRetries([candidate()], [email(), email({ id: "m3", sentAt: at(10), createdAt: at(10) })], settings);
    expect(plan).toMatchObject({ anchorId: "m3", at: at(34) });
  });

  it("is left out when the window is empty: the club's two numbers added up exceed the link", () => {
    expect(planConfirmationRetries([candidate({ linkExpiresAt: at(24) })], [email()], settings)).toEqual([]);
    // …or the event starts first.
    expect(planConfirmationRetries([candidate({ startsAt: at(20) })], [email()], settings)).toEqual([]);
  });

  it("one per address and event: a family's one email confirms everybody waiting there (§588)", () => {
    const rows = [email(), email({ id: "m2", registrationId: "r2", sentAt: at(1), createdAt: at(1) })];
    const plans = planConfirmationRetries([candidate(), candidate({ registrationId: "r2" })], rows, settings);
    // Both count from the last email the address got, the sibling's.
    expect(plans.map((plan) => plan.at)).toEqual([at(25), at(25)]);
    expect(dueConfirmationRetries(plans, at(25)).map((plan) => plan.registrationId)).toEqual(["r1"]);
    // Once a second email was queued for the address, the sibling is owed none after it.
    const after = [...rows, email({ id: "m3", retry: true, status: "SENT", sentAt: at(25), createdAt: at(25) })];
    expect(planConfirmationRetries([candidate({ registrationId: "r2" })], after, settings)).toEqual([]);
  });

  it("keys each second email by the email it follows, and marks its payload", () => {
    expect(AUTOMATIC_SEND_KEYS.confirmationRetry("r1", "m1")).toBe("registration:r1:verify-retry:m1");
    expect(isConfirmationRetry({ confirmationRetry: true })).toBe(true);
    expect(isConfirmationRetry({ startsDeadline: true })).toBe(false);
    expect(isConfirmationRetry(null)).toBe(false);
  });
});

describe("§NNN the two «Termene» numbers", () => {
  it("default to a day after and six hours left, within their bounds", () => {
    expect(DEFAULT_DEADLINES.confirmationRetryHours).toBe(24);
    expect(DEFAULT_DEADLINES.confirmationRetryLeftHours).toBe(6);
    expect(DEADLINE_RULES.confirmationRetryHours).toMatchObject({ min: 0, max: 72 });
    expect(DEADLINE_RULES.confirmationRetryLeftHours).toMatchObject({ min: 1, max: 48 });
  });

  it("a stored value without them reads the defaults; a save refuses one out of bounds", () => {
    expect(readDeadlinesValue({ holdMinutes: 20 })).toMatchObject({ confirmationRetryHours: 24, confirmationRetryLeftHours: 6 });
    expect(deadlinesSettingSchema.safeParse({ ...DEFAULT_DEADLINES, confirmationRetryHours: 73 }).success).toBe(false);
    expect(deadlinesSettingSchema.safeParse({ ...DEFAULT_DEADLINES, confirmationRetryLeftHours: 0 }).success).toBe(false);
    expect(deadlinesSettingSchema.safeParse({ ...DEFAULT_DEADLINES, confirmationRetryHours: 0 }).success).toBe(true);
  });
});
