import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { platformSettings } from "@/db/schema/platform-settings";
import { type StaffUser, staffUsers } from "@/db/schema/staff-users";
import { createCaptureSmtpTransport } from "@/infrastructure/email/smtp-adapter";
import { countHeldBack, HELD_BACK_SETTING_KEY } from "@/modules/contact/held-back";
import { readContactRecipients, updateContactRecipients } from "@/modules/contact/recipients";
import { DEFAULT_FEEDBACK_SETTINGS } from "@/modules/feedback/domain/branches";
import { type FeedbackDeps, submitFeedback } from "@/modules/feedback/service";
import { type ContactDelivery, type ContactScreening, submitContactMessage } from "@/modules/contact/service";
import { isDomainError } from "@/shared/errors/domain-error";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";

/**
 * BR-REQ-070-04, `DECISIONS.md` §NNN (amends §310) — the tick «Nu-mi trimite mesajele care par spam»
 * through the contact service with the SMTP capture: off, it is today's marked delivery; on, a
 * marked message is counted and not emailed, a clean one is delivered, the sender's answer is the
 * same, and only a timestamp and the form's name are kept. Every address is made up.
 */
const NOW = new Date("2026-10-13T10:00:00.000Z");
const RENDERED_AT = new Date(NOW.getTime() - 10_000).toISOString();
const PAGE = "http://localhost:47821/ro/contact";
const PERSON = { name: "Ana Popescu", email: "ana@example.com", message: "La ce oră începe alergarea?", locale: "ro" as const, renderedAt: RENDERED_AT };
const NO_TOKEN: ContactScreening = { botCheckOn: true, tokenPresent: false, turnstileVerdict: "unavailable", clubHost: null };
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

  const delivery = (capture: ReturnType<typeof createCaptureSmtpTransport>): ContactDelivery => ({
    transport: capture,
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
    const capture = createCaptureSmtpTransport();
    expect(await quietly(() => submitContactMessage(db, delivery(capture), PERSON, NOW, PAGE, NO_TOKEN))).toEqual({ outcome: "sent" });
    expect(capture.messages).toHaveLength(1);
    expect(capture.messages[0]?.subject).toBe("[posibil spam] Mesaj de pe site: Ana Popescu");
    expect(await countHeldBack(db, NOW)).toBe(0);
    expect(await db.select().from(platformSettings)).toHaveLength(0);
  });

  it("ticked, a suspicious message is counted and not emailed, and the sender is answered the same", async () => {
    await tick(true);
    const capture = createCaptureSmtpTransport();
    expect(await quietly(() => submitContactMessage(db, delivery(capture), PERSON, NOW, PAGE, NO_TOKEN))).toEqual({ outcome: "sent" });
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
    const capture = createCaptureSmtpTransport();
    expect(await submitContactMessage(db, delivery(capture), PERSON, NOW, PAGE, PASSED)).toEqual({ outcome: "sent" });
    expect(capture.messages).toHaveLength(1);
    expect(capture.messages[0]?.subject).toBe("Mesaj de pe site: Ana Popescu");
    expect(await countHeldBack(db, NOW)).toBe(0);
  });

  it("counts the last thirty days only", async () => {
    await tick(true);
    const capture = createCaptureSmtpTransport();
    await quietly(() => submitContactMessage(db, delivery(capture), PERSON, NOW, PAGE, NO_TOKEN));
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
    const capture = createCaptureSmtpTransport();
    const deps: FeedbackDeps = {
      settings: { ...DEFAULT_FEEDBACK_SETTINGS, suggestion: { on: true, to: "ideas@example.org" } },
      noticeDescribes: true,
      namedDescribed: true,
      clubFallback: ["club@example.com"],
      smtp: { transport: capture, from: { name: "Club", address: "club@example.com" }, appEnv: "production" },
      mailgun: null,
      appEnv: "production",
      screening: NO_TOKEN,
      eventTitle: async () => null,
    };
    const suggestion = { locale: "ro", renderedAt: RENDERED_AT, branch: "suggestion", identity: "named", name: "Ana Pop", message: "Alergări seara.", email: "ana@example.org" };
    expect(await quietly(() => submitFeedback(db, deps, suggestion, NOW))).toEqual({ outcome: "sent" });
    expect(capture.messages).toHaveLength(0);
    expect(await countHeldBack(db, NOW)).toBe(1);

    await tick(false);
    expect(await quietly(() => submitFeedback(db, deps, suggestion, NOW))).toEqual({ outcome: "sent" });
    expect(capture.messages).toHaveLength(1);
    expect(capture.messages[0]?.subject).toContain("[posibil spam]");
  });
});
