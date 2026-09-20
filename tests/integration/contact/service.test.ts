import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { rateLimitBuckets } from "@/db/schema/rate-limit";
import { QA_SUBJECT_PREFIX } from "@/infrastructure/email/delivery";
import { createCaptureSmtpTransport, type SmtpTransport } from "@/infrastructure/email/smtp-adapter";
import { capturedContactMessages, contactDeliveryFor } from "@/modules/contact/delivery";
import { type ContactDelivery, submitContactMessage } from "@/modules/contact/service";
import { RATE_LIMITS } from "@/modules/rate-limit/service";
import { isDomainError } from "@/shared/errors/domain-error";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";

const NOW = new Date("2026-09-19T20:00:00.000Z");
const RENDERED_AT = new Date(NOW.getTime() - 10_000).toISOString();
const PAGE = "http://localhost:47821/ro/contact";

const PERSON = {
  name: "Ana Popescu",
  email: "ana@example.com",
  message: "La ce oră începe alergarea de duminică?",
  locale: "ro" as const,
  renderedAt: RENDERED_AT,
};

function delivery(transport: SmtpTransport, appEnv: ContactDelivery["appEnv"] = "production"): ContactDelivery {
  return { transport, from: { name: "Brașov Runners", address: "club@example.com" }, to: ["club@example.com", "amalia@example.org"], appEnv };
}

/**
 * BR-REQ-070-04 (`DECISIONS.md` §149) — the contact form's service: a person's message is
 * sent the moment it is posted, through the transport it is given and never the outbox; a
 * bot's is answered as sent and sent nowhere; too many from one identity are told so; a
 * deployment with no way out says so; and nothing is ever stored.
 */
describe("BR-REQ-070-04 the contact form", () => {
  let db: TestDatabase;
  let close: () => Promise<void>;

  beforeAll(async () => {
    ({ db, close } = await createTestDatabase());
  });
  afterAll(async () => close());
  beforeEach(async () => {
    await resetTables(db);
  });

  it("sends a person's message to every recipient, with Reply-To the sender, and stores nothing", async () => {
    const capture = createCaptureSmtpTransport();
    const outcome = await submitContactMessage(db, delivery(capture), PERSON, NOW, PAGE);

    expect(outcome).toEqual({ outcome: "sent" });
    expect(capture.messages).toHaveLength(1);
    const [message] = capture.messages;
    expect(message.to).toEqual(["club@example.com", "amalia@example.org"]);
    expect(message.replyTo).toEqual({ name: "Ana Popescu", address: "ana@example.com" });
    expect(message.subject).toBe("Mesaj de pe site: Ana Popescu");
    expect(message.text).toContain(PAGE);

    // Nothing of the message in the database: the throttle's row is a hash, never the address.
    const rows = await db.select({ key: rateLimitBuckets.key }).from(rateLimitBuckets);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.key).toMatch(/^[0-9a-f]{64}$/);
  });

  it("marks a QA message's subject, because the club's real mailboxes are on both projects", async () => {
    const capture = createCaptureSmtpTransport();
    await submitContactMessage(db, delivery(capture, "qa"), PERSON, NOW, PAGE);
    expect(capture.messages[0]?.subject).toBe(`${QA_SUBJECT_PREFIX}Mesaj de pe site: Ana Popescu`);
  });

  it("answers a bot as sent and sends nothing — the trap field, or a post faster than a person reads", async () => {
    const capture = createCaptureSmtpTransport();
    expect(await submitContactMessage(db, delivery(capture), { ...PERSON, honeypot: "http://spam.example" }, NOW, PAGE)).toEqual({ outcome: "ignored" });
    expect(await submitContactMessage(db, delivery(capture), { ...PERSON, renderedAt: NOW.toISOString() }, NOW, PAGE)).toEqual({ outcome: "ignored" });
    expect(await submitContactMessage(db, delivery(capture), { ...PERSON, renderedAt: undefined }, NOW, PAGE)).toEqual({ outcome: "ignored" });
    expect(capture.messages).toHaveLength(0);
  });

  it("tells a person who wrote too often, keyed on the canonical identity, and does not send", async () => {
    const capture = createCaptureSmtpTransport();
    const { limit } = RATE_LIMITS["contact-message"];
    for (let i = 0; i < limit; i += 1) {
      // A +tag is the same identity (§10.4; dots are not, §74): the fifth from a tagged variant still counts.
      const email = i === limit - 1 ? "ana+site@gmail.com" : "ana@gmail.com";
      expect(await submitContactMessage(db, delivery(capture), { ...PERSON, email }, NOW, PAGE)).toEqual({ outcome: "sent" });
    }
    const limited = await submitContactMessage(db, delivery(capture), { ...PERSON, email: "ana@gmail.com" }, NOW, PAGE);
    expect(limited.outcome).toBe("limited");
    if (limited.outcome === "limited") expect(limited.retryAfter).toBeGreaterThan(0);
    expect(capture.messages).toHaveLength(limit);

    // Somebody else is not affected by Ana's hour.
    expect(await submitContactMessage(db, delivery(capture), { ...PERSON, email: "ion@example.com" }, NOW, PAGE)).toEqual({ outcome: "sent" });
  });

  it("says the form has no way out when the deployment has none, before anything is counted", async () => {
    expect(await submitContactMessage(db, null, PERSON, NOW, PAGE)).toEqual({ outcome: "unavailable" });
    expect(await db.select().from(rateLimitBuckets)).toHaveLength(0);
  });

  it("reports a refused send, logs its code, and does not count it against the sender", async () => {
    const refusing: SmtpTransport = { name: "refusing", send: async () => ({ outcome: "failed", error: "smtp EAUTH" }) };
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      // A wrong-password day: more tries than the hour allows, every one "we could not send".
      const { limit } = RATE_LIMITS["contact-message"];
      for (let i = 0; i <= limit; i += 1) {
        expect(await submitContactMessage(db, delivery(refusing), PERSON, NOW, PAGE)).toEqual({ outcome: "delivery_failed" });
      }
      expect(log).toHaveBeenCalledWith("[contact] delivery failed", "smtp EAUTH");
      // The password fixed, the same person's message goes through at once.
      const capture = createCaptureSmtpTransport();
      expect(await submitContactMessage(db, delivery(capture), PERSON, NOW, PAGE)).toEqual({ outcome: "sent" });
    } finally {
      log.mockRestore();
    }
  });

  it("rejects an incomplete post with the boxes named, before any guard runs", async () => {
    const capture = createCaptureSmtpTransport();
    await expect(submitContactMessage(db, delivery(capture), { ...PERSON, email: "nope", message: "" }, NOW, PAGE)).rejects.toSatisfy(
      (error: unknown) => isDomainError(error) && error.code === "VALIDATION_ERROR" && error.fields.join(",") === "email,message",
    );
    expect(capture.messages).toHaveLength(0);
  });

  it("derives the delivery from the configuration: off is none, capture opens no socket and is readable", async () => {
    const base = {
      APP_ENV: "qa" as const,
      CONTACT_SMTP_HOST: "smtp.gmail.com",
      CONTACT_SMTP_PORT: 465,
      CONTACT_SMTP_USER: undefined,
      CONTACT_SMTP_PASSWORD: undefined,
      CONTACT_FORM_TO: [] as string[],
      EMAIL_FROM_NAME: "Brașov Runners",
    };
    expect(contactDeliveryFor({ ...base, CONTACT_FORM_MODE: "off" }, null)).toBeNull();

    const captured = contactDeliveryFor({ ...base, CONTACT_FORM_MODE: "capture" }, null);
    expect(captured?.transport.name).toBe("capture");
    await submitContactMessage(db, captured, { ...PERSON, message: "În memorie." }, NOW, PAGE);
    expect(capturedContactMessages()[0]?.text).toContain("În memorie.");

    // SMTP is only ever constructed — never connected — here: the socket opens on the first send.
    const smtp = contactDeliveryFor(
      {
        ...base,
        CONTACT_FORM_MODE: "smtp",
        CONTACT_SMTP_USER: "club@example.com",
        CONTACT_SMTP_PASSWORD: "abcd efgh ijkl mnop",
        CONTACT_FORM_TO: ["club@example.com"],
      },
      null,
    );
    expect(smtp?.transport.name).toBe("smtp");
    expect(smtp?.from).toEqual({ name: "Brașov Runners", address: "club@example.com" });
    expect(smtp?.appEnv).toBe("qa");
  });

  /**
   * §164 — the club's own recipients, the copy list among them (the owner: "I wanna allow CC
   * on the contact form so that Amalia can receive emails"). The setting wins over
   * `CONTACT_FORM_TO`, the copy list applies whichever of the two answered, and a deployment
   * that can send but has nobody to send to is as unavailable as one with no transport.
   */
  it("sends to the club's own list, with the Cc it set, and says so through the whole path", async () => {
    const base = {
      APP_ENV: "production" as const,
      CONTACT_FORM_MODE: "capture" as const,
      CONTACT_SMTP_HOST: "smtp.gmail.com",
      CONTACT_SMTP_PORT: 465,
      CONTACT_SMTP_USER: "club@example.com",
      CONTACT_SMTP_PASSWORD: "abcd efgh ijkl mnop",
      CONTACT_FORM_TO: ["old@example.com"],
      EMAIL_FROM_NAME: "Brașov Runners",
    };

    const configured = contactDeliveryFor(base, { to: ["club@example.com"], cc: ["amalia@example.org"] });
    expect(configured?.to).toEqual(["club@example.com"]);
    expect(configured?.cc).toEqual(["amalia@example.org"]);

    await submitContactMessage(db, configured, PERSON, NOW, PAGE);
    const [sent] = capturedContactMessages();
    expect(sent?.to).toEqual(["club@example.com"]);
    expect(sent?.cc).toEqual(["amalia@example.org"]);
    // The visitor still answers "Reply", whoever else was copied.
    expect(sent?.replyTo).toEqual({ name: "Ana Popescu", address: "ana@example.com" });

    // No "to" in the setting: the environment answers, and the copy list still applies.
    const fallback = contactDeliveryFor(base, { to: [], cc: ["amalia@example.org"] });
    expect(fallback?.to).toEqual(["old@example.com"]);
    expect(fallback?.cc).toEqual(["amalia@example.org"]);

    // Neither, on a deployment: nobody to send to is the same answer as no way to send.
    const nobody = contactDeliveryFor({ ...base, CONTACT_FORM_MODE: "smtp", CONTACT_FORM_TO: [] }, { to: [], cc: [] });
    expect(nobody).toBeNull();
    expect(await submitContactMessage(db, nobody, PERSON, NOW, PAGE)).toEqual({ outcome: "unavailable" });
  });
});
