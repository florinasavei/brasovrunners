import { describe, expect, it } from "vitest";
import { DEADLINE_RULES, DEFAULT_DEADLINES, deadlinesSettingSchema, readDeadlinesValue } from "@/modules/deadlines/domain/deadlines";
import {
  AUTOMATIC_SEND_KEYS,
  CONFIRMATION_RETRY_RUN_CAP,
  type ConfirmationRetryCandidate,
  type ConfirmationRetryPlan,
  dueConfirmationRetries,
  isConfirmationRetry,
  isConfirmationRetryDue,
  planConfirmationRetries,
  type VerificationEmailRow,
} from "@/modules/notifications/domain/automatic-sends";
import { buildTemplateContent } from "@/modules/notifications/templates";

/** §653 — who is owed the verification email once more, and from when to when: the pure formula. */
const T = new Date("2026-10-03T08:00:00.000Z");
const HOUR = 60 * 60_000;
const at = (hours: number) => new Date(T.getTime() + hours * HOUR);

function candidate(overrides: Partial<ConfirmationRetryCandidate> = {}): ConfirmationRetryCandidate {
  return { registrationId: "r1", participantId: "p1", eventId: "e1", linkExpiresAt: at(48), startsAt: at(24 * 30), ...overrides };
}

function email(overrides: Partial<VerificationEmailRow> = {}): VerificationEmailRow {
  return { id: "m1", registrationId: "r1", participantId: "p1", eventId: "e1", status: "SENT", sentAt: T, createdAt: T, startsDeadline: true, isRetry: false, ...overrides };
}

/** A later email for the address: a re-sent one, the person's «Retrimite» or a staff resend — all the same to the count. */
const later = (id: string, hours: number, overrides: Partial<VerificationEmailRow> = {}) =>
  email({ id, sentAt: at(hours), createdAt: at(hours), startsDeadline: false, ...overrides });

const settings = { verificationRetryHours: 20, verificationRetries: 1 };

describe("§653 the verification email re-sent: the formula", () => {
  it("is due the club's hours after the email left, until the link has an hour left", () => {
    const [plan] = planConfirmationRetries([candidate()], [email()], settings);
    expect(plan).toMatchObject({ registrationId: "r1", attempt: 1, at: at(20), latest: at(47) });
    expect(isConfirmationRetryDue(plan, at(19.9))).toBe(false);
    expect(isConfirmationRetryDue(plan, at(20))).toBe(true);
    expect(isConfirmationRetryDue(plan, at(47))).toBe(true);
    expect(isConfirmationRetryDue(plan, at(47.1))).toBe(false);
  });

  it("plans nothing at 0 times, before an email left, while one waits to leave, or after a bounce or a complaint", () => {
    expect(planConfirmationRetries([candidate()], [email()], { ...settings, verificationRetries: 0 })).toEqual([]);
    expect(planConfirmationRetries([candidate()], [], settings)).toEqual([]);
    expect(planConfirmationRetries([candidate()], [email({ status: "PENDING", sentAt: null })], settings)).toEqual([]);
    expect(planConfirmationRetries([candidate()], [email(), later("m2", 1, { status: "PROCESSING", sentAt: null })], settings)).toEqual([]);
    expect(planConfirmationRetries([candidate()], [email({ status: "BOUNCED" })], settings)).toEqual([]);
    expect(planConfirmationRetries([candidate()], [email(), later("m2", 1, { status: "COMPLAINED" })], settings)).toEqual([]);
    expect(planConfirmationRetries([candidate()], [email({ status: "FAILED", sentAt: null })], settings)).toEqual([]);
  });

  it("never to an address that bounced or complained on any other message", () => {
    expect(planConfirmationRetries([candidate()], [email()], settings, new Set(["p1"]))).toEqual([]);
    expect(planConfirmationRetries([candidate()], [email()], settings, new Set(["p2"]))).toHaveLength(1);
  });

  it("counts every email for the address and the event: a resend uses up an attempt", () => {
    // One re-send allowed: the person's own «Retrimite» was it.
    expect(planConfirmationRetries([candidate()], [email(), later("m2", 5)], settings)).toEqual([]);
    // Two allowed: one more, the club's hours after the resend, as the third email.
    const [plan] = planConfirmationRetries([candidate()], [email(), later("m2", 5)], { ...settings, verificationRetries: 2 });
    expect(plan).toMatchObject({ attempt: 2, at: at(25) });
    // …and the step stops at one plus the club's number.
    expect(planConfirmationRetries([candidate()], [email(), later("m2", 5), later("m3", 25)], { ...settings, verificationRetries: 2 })).toEqual([]);
  });

  it("a re-sent email that ended FAILED used up its attempt: nothing is owed, and a later key never repeats it", () => {
    const failed = later("m2", 20, { status: "FAILED", sentAt: null, isRetry: true });
    // One allowed, and the failed one was it: no plan, so nothing for the job's plan to wake for.
    expect(planConfirmationRetries([candidate()], [email(), failed], settings)).toEqual([]);
    // Two allowed: the next one, the club's hours after the failed one was queued, under the next key.
    const [plan] = planConfirmationRetries([candidate()], [email(), failed], { ...settings, verificationRetries: 2 });
    expect(plan).toMatchObject({ attempt: 2, at: at(40) });
    // A FAILED email that was not a re-send (the first, a «Retrimite») still counts as nothing.
    expect(planConfirmationRetries([candidate()], [email(), later("m2", 5, { status: "FAILED", sentAt: null })], settings)).toHaveLength(1);
  });

  it("three at most, each the club's hours after the last", () => {
    const three = { verificationRetryHours: 10, verificationRetries: 3 };
    const rows = [email()];
    const ats: Date[] = [];
    for (let n = 1; n <= 4; n += 1) {
      const [plan] = planConfirmationRetries([candidate()], rows, three);
      if (!plan) break;
      expect(plan.attempt).toBe(n);
      ats.push(plan.at);
      rows.push(later(`m${n + 1}`, (plan.at.getTime() - T.getTime()) / HOUR));
    }
    expect(ats).toEqual([at(10), at(20), at(30)]);
  });

  it("a restarted registration's first email starts a new count, and its key never repeats an earlier one", () => {
    const rows = [email(), later("m2", 20), email({ id: "m3", sentAt: at(60), createdAt: at(60) })];
    const [plan] = planConfirmationRetries([candidate({ linkExpiresAt: at(108) })], rows, settings);
    expect(plan).toMatchObject({ attempt: 3, at: at(80) });
  });

  it("is left out when the window is empty: the link would have under an hour, or the event starts first", () => {
    expect(planConfirmationRetries([candidate({ linkExpiresAt: at(20.5) })], [email()], settings)).toEqual([]);
    expect(planConfirmationRetries([candidate({ startsAt: at(18) })], [email()], settings)).toEqual([]);
  });

  it("one per address and event: a family's one email confirms everybody waiting there (§588)", () => {
    const rows = [email(), email({ id: "m2", registrationId: "r2", sentAt: at(1), createdAt: at(1), startsDeadline: false })];
    const plans = planConfirmationRetries([candidate(), candidate({ registrationId: "r2" })], rows, { ...settings, verificationRetries: 2 });
    // Both count from the last email the address got, the sibling's.
    expect(plans.map((plan) => plan.at)).toEqual([at(21), at(21)]);
    expect(dueConfirmationRetries(plans, at(21)).map((plan) => plan.registrationId)).toEqual(["r1"]);
  });

  it("one run queues at most the cap, oldest due first", () => {
    const plans: ConfirmationRetryPlan[] = Array.from({ length: CONFIRMATION_RETRY_RUN_CAP + 10 }, (_, i) => ({
      registrationId: `r${String(i).padStart(3, "0")}`,
      participantId: `p${i}`,
      eventId: "e1",
      attempt: 1,
      at: at(20 - i / 100),
      latest: at(47),
    }));
    const due = dueConfirmationRetries(plans, at(21));
    expect(due).toHaveLength(CONFIRMATION_RETRY_RUN_CAP);
    expect(due[0].registrationId).toBe(`r${String(CONFIRMATION_RETRY_RUN_CAP + 9).padStart(3, "0")}`);
    expect(due.every((plan, i) => i === 0 || due[i - 1].at.getTime() <= plan.at.getTime())).toBe(true);
  });

  it("keys each re-sent email by the attempt it follows, and marks its payload", () => {
    expect(AUTOMATIC_SEND_KEYS.confirmationRetry("r1", 1)).toBe("registration:r1:verify-retry:1");
    expect(isConfirmationRetry({ confirmationRetry: true })).toBe(true);
    expect(isConfirmationRetry({ startsDeadline: true })).toBe(false);
    expect(isConfirmationRetry(null)).toBe(false);
  });
});

const text = (content: ReturnType<typeof buildTemplateContent>) =>
  content.paragraphs.map((part) => (typeof part === "string" ? part : JSON.stringify(part))).join("\n");

describe("§653 the re-sent email's sentence", () => {
  it("says why it came and the deadline its first email started, in the inbox only", () => {
    const data = {
      participantName: "Ana",
      eventTitle: "Crosul",
      confirmationRetry: true,
      confirmationRetryDeadline: "joi, 1 octombrie 2026, la 18:30",
      confirmationRetryDeadlineOther: "Thursday, 1 October 2026, at 18:30",
    };
    const inbox = buildTemplateContent("VERIFY_REGISTRATION_EMAIL", "ro", data, "https://example.org/x");
    expect(text(inbox)).toContain(
      "Nu am primit încă confirmarea adresei tale, așa că îți retrimitem linkul. Termenul curge de la primul email: **joi, 1 octombrie 2026, la 18:30**.",
    );
    const english = buildTemplateContent("VERIFY_REGISTRATION_EMAIL", "en", { ...data, confirmationRetryDeadline: data.confirmationRetryDeadlineOther }, "https://example.org/x");
    expect(text(english)).toContain(
      "We have not received your address confirmation yet, so we are sending you the link again. The deadline runs from the first email: **Thursday, 1 October 2026, at 18:30**.",
    );
    const copy = buildTemplateContent("VERIFY_REGISTRATION_EMAIL", "ro", { ...data, clubCopy: true }, "https://example.org/x");
    expect(text(copy)).not.toContain("îți retrimitem linkul");
  });
});

describe("§653 the two «Termene» numbers", () => {
  it("default to twenty hours and once, within their bounds", () => {
    expect(DEFAULT_DEADLINES.verificationRetryHours).toBe(20);
    expect(DEFAULT_DEADLINES.verificationRetries).toBe(1);
    expect(DEADLINE_RULES.verificationRetryHours).toMatchObject({ unit: "hours", min: 2, max: 72 });
    expect(DEADLINE_RULES.verificationRetries).toMatchObject({ unit: "count", min: 0, max: 3 });
  });

  it("a stored value without them reads the defaults; a save refuses one out of bounds", () => {
    expect(readDeadlinesValue({ holdMinutes: 20 })).toMatchObject({ verificationRetryHours: 20, verificationRetries: 1 });
    expect(deadlinesSettingSchema.safeParse({ ...DEFAULT_DEADLINES, verificationRetryHours: 1 }).success).toBe(false);
    expect(deadlinesSettingSchema.safeParse({ ...DEFAULT_DEADLINES, verificationRetryHours: 73 }).success).toBe(false);
    expect(deadlinesSettingSchema.safeParse({ ...DEFAULT_DEADLINES, verificationRetries: 4 }).success).toBe(false);
    expect(deadlinesSettingSchema.safeParse({ ...DEFAULT_DEADLINES, verificationRetries: 0 }).success).toBe(true);
  });
});
