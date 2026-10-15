import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { platformSettings } from "@/db/schema/platform-settings";
import { type StaffUser, staffUsers } from "@/db/schema/staff-users";
import type { SendResult } from "@/infrastructure/email/adapter";
import { countHeldBack, HELD_BACK_SETTING_KEY } from "@/modules/contact/held-back";
import { readContactRecipients, updateContactRecipients } from "@/modules/contact/recipients";
import { DEFAULT_FEEDBACK_SETTINGS } from "@/modules/feedback/domain/branches";
import { type FeedbackDeps, submitFeedback as queueFeedback } from "@/modules/feedback/service";
import { type ContactDelivery, type ContactScreening, submitContactMessage as queueContact } from "@/modules/contact/service";
import { isDomainError } from "@/shared/errors/domain-error";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";
import { type SmtpCapture, smtpCapture } from "../../helpers/relay";

/**
 * BR-REQ-070-04, `DECISIONS.md` §744 (amends §310) — the tick «Nu-mi trimite mesajele care par spam»
 * through the contact service with the SMTP capture: off, it is today's marked delivery; on, a
 * marked message is counted and not emailed, a clean one is delivered, the sender's answer is the
 * same, and only a timestamp and the form's name are kept. Every address is made up.
 */
const NOW = new Date("2026-10-13T10:00:00.000Z");
const RENDERED_AT = new Date(NOW.getTime() - 10_000).toISOString();
const PAGE = "http://localhost:47821/ro/contact";
const PERSON = { name: "Ana Popescu", email: "ana@example.com", message: "La ce oră începe alergarea?", locale: "ro" as const, renderedAt: RENDERED_AT };
const NO_TOKEN: ContactScreening = { botCheckOn: true, tokenPresent: false, turnstileVerdict: "unavailable", clubHost: null };
/** The same post as the action builds it: the tick is read with the recipients row and travels in the screening. */
const withTick = (screening: ContactScreening, on: boolean): ContactScreening => ({ ...screening, holdBack: on });
const PASSED: ContactScreening = { botCheckOn: true, tokenPresent: true, turnstileVerdict: "passed", clubHost: null };

describe("BR-REQ-070-04 the tick that holds back suspected spam", () => {
  let db: TestDatabase;
  let close: () => Promise<void>;
  let admin: StaffUser;
  let organizer: StaffUser;

  beforeAll(async () => {
    ({ db, close } = await createTestDatabase());
  });
  afterAll(async () => close());
  beforeEach(async () => {
    await resetTables(db);
    [admin] = await db.insert(staffUsers).values({ email: "admin@dev.test", displayName: "Admin", role: "ADMIN" }).returning();
    [organizer] = await db.insert(staffUsers).values({ email: "org@dev.test", displayName: "Org", role: "MODERATOR" }).returning();
  });

  /*
    §778: the forms queue their message and the relay carries it. These tests read what the club's Gmail was handed, so every
    post is followed by one pass of the relay with Gmail answering into the capture — and Mailgun into `mailgun.send`.
  */
  const mailgun = { send: vi.fn(async () => ({ outcome: "sent", providerMessageId: "mailgun:1" }) as SendResult) };
  const mailgunAnswer = () => mailgun.send();
  let current: SmtpCapture | null = null;
  const capturing = () => (current = smtpCapture(undefined, mailgunAnswer));
  const submitContactMessage: typeof queueContact = async (...args) => {
    const outcome = await queueContact(...args);
    await current?.deliver(db, new Date(NOW.getTime() + 1_000));
    return outcome;
  };
  const submitFeedback: typeof queueFeedback = async (...args) => {
    const outcome = await queueFeedback(...args);
    await current?.deliver(db, new Date(NOW.getTime() + 1_000));
    return outcome;
  };

  const delivery = (capture: SmtpCapture): ContactDelivery => ({
    ...((current = capture), {}),
    from: { name: "Club", address: "club@example.com" },
    to: ["club@example.com"],
    appEnv: "production",
  });
  const tick = (on: boolean) => updateContactRecipients(db, admin, { to: ["club@example.com"], holdBackSuspected: on }, NOW);
  const quietly = async <T>(run: () => Promise<T>): Promise<T> => {
    const log = vi.spyOn(console, "info").mockImplementation(() => {});
    try {
      return await run();
    } finally {
      log.mockRestore();
    }
  };

  it("unticked, a suspicious message is delivered marked exactly as before, and nothing is counted", async () => {
    const capture = capturing();
    expect(await quietly(() => submitContactMessage(db, delivery(capture), PERSON, NOW, PAGE, NO_TOKEN))).toEqual({ outcome: "sent" });
    expect(capture.messages).toHaveLength(1);
    expect(capture.messages[0]?.subject).toBe("[contact][posibil spam] Mesaj de pe site: Ana Popescu");
    expect(await countHeldBack(db, NOW)).toBe(0);
    expect(await db.select().from(platformSettings)).toHaveLength(0);
  });

  it("ticked, a suspicious message is counted and not emailed, and the sender is answered the same", async () => {
    await tick(true);
    const capture = capturing();
    expect(await quietly(() => submitContactMessage(db, delivery(capture), PERSON, NOW, PAGE, withTick(NO_TOKEN, true)))).toEqual({ outcome: "sent" });
    expect(capture.messages).toHaveLength(0);
    expect(await countHeldBack(db, NOW)).toBe(1);

    // Only a timestamp and the form's name are kept: nothing the sender typed.
    const [row] = await db.select().from(platformSettings).where(eq(platformSettings.key, HELD_BACK_SETTING_KEY));
    expect(row?.value).toEqual({ entries: [{ at: NOW.toISOString(), form: "contact" }] });
    const kept = JSON.stringify(row?.value);
    for (const typed of [PERSON.name, PERSON.email, PERSON.message, "Popescu"]) expect(kept).not.toContain(typed);
  });

  it("ticked, a message that is not suspicious is delivered untouched", async () => {
    await tick(true);
    const capture = capturing();
    expect(await submitContactMessage(db, delivery(capture), PERSON, NOW, PAGE, withTick(PASSED, true))).toEqual({ outcome: "sent" });
    expect(capture.messages).toHaveLength(1);
    expect(capture.messages[0]?.subject).toBe("[contact] Mesaj de pe site: Ana Popescu");
    expect(await countHeldBack(db, NOW)).toBe(0);
  });

  it("counts the last thirty days only", async () => {
    await tick(true);
    const capture = capturing();
    await quietly(() => submitContactMessage(db, delivery(capture), PERSON, NOW, PAGE, withTick(NO_TOKEN, true)));
    expect(await countHeldBack(db, new Date(NOW.getTime() + 29 * 86_400_000))).toBe(1);
    expect(await countHeldBack(db, new Date(NOW.getTime() + 31 * 86_400_000))).toBe(0);
  });

  it("is saved by an Administrator and refused to anybody else, audited, and defaults to off", async () => {
    expect((await readContactRecipients(db)).holdBackSuspected).toBe(false);
    await tick(true);
    expect((await readContactRecipients(db)).holdBackSuspected).toBe(true);
    await tick(false);
    expect((await readContactRecipients(db)).holdBackSuspected).toBe(false);
    await expect(updateContactRecipients(db, organizer, { to: ["club@example.com"], holdBackSuspected: true }, NOW)).rejects.toSatisfy(
      (error) => isDomainError(error) && error.code === "FORBIDDEN",
    );
  });

  it("covers the feedback forms too: ticked, a marked suggestion is counted and not emailed; unticked, delivered marked", async () => {
    await tick(true);
    const capture = capturing();
    const deps: FeedbackDeps = {
      settings: { ...DEFAULT_FEEDBACK_SETTINGS, suggestion: { on: true, to: "ideas@example.org", via: "gmail" } },
      noticeDescribes: true,
      safetyGmailDescribed: true,
      namedDescribed: true,
      clubFallback: ["club@example.com"],
      roads: { gmail: true, mailgun: false },
      appEnv: "production",
      screening: withTick(NO_TOKEN, true),
      eventTitle: async () => null,
    };
    const suggestion = { locale: "ro", renderedAt: RENDERED_AT, branch: "suggestion", identity: "named", name: "Ana Pop", message: "Alergări seara.", email: "ana@example.org" };
    expect(await quietly(() => submitFeedback(db, deps, suggestion, NOW))).toEqual({ outcome: "sent" });
    expect(capture.messages).toHaveLength(0);
    expect(await countHeldBack(db, NOW)).toBe(1);

    await tick(false);
    expect(await quietly(() => submitFeedback(db, { ...deps, screening: withTick(NO_TOKEN, false) }, suggestion, NOW))).toEqual({ outcome: "sent" });
    expect(capture.messages).toHaveLength(1);
    expect(capture.messages[0]?.subject).toContain("[posibil spam]");
  });

  it("never holds back the safety branch: ticked, a suspicious named report for the club is delivered marked and not counted", async () => {
    await tick(true);
    const capture = capturing();
    const deps: FeedbackDeps = {
      settings: { ...DEFAULT_FEEDBACK_SETTINGS, safety: { on: true, to: "safety@example.org", via: "mailgun", name: "Maria", fallbackToGmail: false } },
      noticeDescribes: true,
      safetyGmailDescribed: true,
      namedDescribed: true,
      clubFallback: ["club@example.com"],
      roads: { gmail: true, mailgun: true },
      appEnv: "production",
      screening: withTick(NO_TOKEN, true),
      eventTitle: async () => null,
    };
    const report = { locale: "ro", renderedAt: RENDERED_AT, branch: "safety", identity: "named", name: "Ana Pop", audience: "club", message: "Cineva m-a urmărit.", whereWhen: "Parcul, joi", contact: "" };
    expect(await quietly(() => submitFeedback(db, deps, report, NOW))).toEqual({ outcome: "sent", audience: "club" });
    expect(capture.messages).toHaveLength(1);
    expect(capture.messages[0]?.text).toContain("Cineva m-a urmărit.");
    expect(await countHeldBack(db, NOW)).toBe(0);

    // The anonymous report to the safety person goes by Mailgun, which the tick never touches.
    const anonymous = { ...report, identity: "anonymous", audience: "" };
    expect(await quietly(() => submitFeedback(db, deps, anonymous, NOW))).toEqual({ outcome: "sent" });
    expect(mailgun.send).toHaveBeenCalledTimes(1);
    expect(await countHeldBack(db, NOW)).toBe(0);
  });

  it("a held-back feedback post does not use one of the branch's thirty an hour", async () => {
    await tick(true);
    const capture = capturing();
    const deps: FeedbackDeps = {
      settings: { ...DEFAULT_FEEDBACK_SETTINGS, suggestion: { on: true, to: "ideas@example.org", via: "gmail" } },
      noticeDescribes: true,
      safetyGmailDescribed: true,
      namedDescribed: true,
      clubFallback: ["club@example.com"],
      roads: { gmail: true, mailgun: false },
      appEnv: "production",
      screening: withTick(NO_TOKEN, true),
      eventTitle: async () => null,
    };
    const suggestion = { locale: "ro", renderedAt: RENDERED_AT, branch: "suggestion", identity: "named", name: "Ana Pop", message: "Alergări seara.", email: "ana@example.org" };
    for (let i = 0; i < 35; i += 1) {
      expect(await quietly(() => submitFeedback(db, deps, suggestion, NOW))).toEqual({ outcome: "sent" });
    }
    expect(await countHeldBack(db, NOW)).toBe(35);
    // A real person, with the token, still gets through: the held posts took nothing from the thirty.
    const real = await quietly(() => submitFeedback(db, { ...deps, screening: withTick(PASSED, true) }, suggestion, NOW));
    expect(real).toEqual({ outcome: "sent" });
    expect(capture.messages).toHaveLength(1);
  });
});
