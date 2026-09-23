import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { rateLimitBuckets } from "@/db/schema/rate-limit";
import { QA_SUBJECT_PREFIX } from "@/infrastructure/email/delivery";
import { createCaptureSmtpTransport, type SmtpTransport } from "@/infrastructure/email/smtp-adapter";
import { capturedContactMessages, contactDeliveryFor } from "@/modules/contact/delivery";
import { renderContactMessage } from "@/modules/contact/message";
import { type ContactDelivery, type ContactScreening, submitContactMessage } from "@/modules/contact/service";
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

  it("answers a bot as sent and sends nothing — the trap field, or an instant post", async () => {
    const capture = createCaptureSmtpTransport();
    expect(await submitContactMessage(db, delivery(capture), { ...PERSON, honeypot: "http://spam.example" }, NOW, PAGE)).toEqual({ outcome: "ignored" });
    // Posted in the same instant the page rendered: inside the one-second floor (§217).
    expect(await submitContactMessage(db, delivery(capture), { ...PERSON, renderedAt: NOW.toISOString() }, NOW, PAGE)).toEqual({ outcome: "ignored" });
    expect(capture.messages).toHaveLength(0);
  });

  it("sends a message that carries no render time at all (§217)", async () => {
    /*
      This used to be treated as a bot. What actually loses the timestamp is a page restored
      from the back-forward cache, an extension that rewrites the DOM, or a tab left open since
      yesterday — and this form is the escape hatch somebody reaches for *because* the rest of
      the site would not take them (§205). Refusing it silently is the worst possible failure
      on the one page that exists to catch the others.
    */
    const capture = createCaptureSmtpTransport();
    expect(await submitContactMessage(db, delivery(capture), { ...PERSON, renderedAt: undefined }, NOW, PAGE)).toEqual({ outcome: "sent" });
    expect(capture.messages).toHaveLength(1);
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

  /**
   * The owner, 2026-09-23: "primesc spam cu SEO stuff", with a sample from
   * `domains@search-<the club's domain>` that came through the production form. A script that
   * posts no token, leaves the trap empty and waits out the timer passes every gate by design —
   * a person with JavaScript off does the same (§205, §216) — so it is delivered, marked, and
   * answered exactly like anybody else. `club.example` stands for the club's domain.
   */
  describe("what the gates let through and still looks like a program's", () => {
    const SCRIPT_POST = {
      ...PERSON,
      name: "Jaqueline Denehy",
      email: "domains@search-club.example",
      message: "Feature club.example in Google's Search Index … https://searchregister.net/submit",
    };
    const NO_TOKEN: ContactScreening = { botCheckOn: true, tokenPresent: false, turnstileVerdict: "unavailable", clubHost: "club.example" };
    const PASSED: ContactScreening = { botCheckOn: true, tokenPresent: true, turnstileVerdict: "passed", clubHost: "club.example" };
    const IPV4 = /\b\d{1,3}(?:\.\d{1,3}){3}\b/;

    it("delivers it marked, answers 'sent' as for anyone, keeps Reply-To the sender's, and stores no IP", async () => {
      const capture = createCaptureSmtpTransport();
      const log = vi.spyOn(console, "info").mockImplementation(() => {});
      try {
        // The same answer, to the byte, as a person's: a script learns nothing from it (AGENTS.md §19.4).
        expect(await submitContactMessage(db, delivery(capture), SCRIPT_POST, NOW, PAGE, NO_TOKEN)).toEqual({ outcome: "sent" });

        expect(capture.messages).toHaveLength(1);
        const [message] = capture.messages;
        expect(message.subject).toBe("[posibil spam] Mesaj de pe site: Jaqueline Denehy");
        expect(message.to).toEqual(["club@example.com", "amalia@example.org"]);
        expect(message.replyTo).toEqual({ name: "Jaqueline Denehy", address: "domains@search-club.example" });
        expect(message.text).toContain(SCRIPT_POST.message);
        expect(message.text).toContain("• Verificarea anti-bot nu a rulat: formularul a fost trimis fără token — de obicei un program, nu un om.");
        expect(message.text).toContain("• Adresa expeditorului imită domeniul clubului: search-club.example.");
        // Ten seconds between the render and the post, the one link's host, the trap empty.
        expect(message.text).toContain("Semnale: trimis la 10 s după deschiderea paginii · 1 link: searchregister.net · câmpul ascuns gol");

        // The log line names the reasons and nothing about the sender.
        expect(log).toHaveBeenCalledWith("[contact] delivered marked as possible spam:", "no-token,imitates-club");
        expect(JSON.stringify(log.mock.calls)).not.toContain("search-club");
      } finally {
        log.mockRestore();
      }

      // No IP in what the club receives or in what the platform keeps: the one row is the
      // throttle's, a hash of the identity (the address itself is never stored either).
      const [message] = capture.messages;
      for (const part of [message.subject, message.text, message.html, JSON.stringify(message.replyTo)]) {
        expect(part).not.toMatch(IPV4);
      }
      const rows = await db.select().from(rateLimitBuckets);
      expect(rows).toHaveLength(1);
      expect(rows[0]?.key).toMatch(/^[0-9a-f]{64}$/);
      expect(JSON.stringify(rows)).not.toMatch(IPV4);
      expect(JSON.stringify(rows)).not.toContain("search-club");
    });

    it("marks a person's message whose browser never ran the widget, and still sends it (§205)", async () => {
      const capture = createCaptureSmtpTransport();
      const log = vi.spyOn(console, "info").mockImplementation(() => {});
      try {
        expect(await submitContactMessage(db, delivery(capture), PERSON, NOW, PAGE, NO_TOKEN)).toEqual({ outcome: "sent" });
      } finally {
        log.mockRestore();
      }
      expect(capture.messages[0]?.subject).toBe("[posibil spam] Mesaj de pe site: Ana Popescu");
      // Reply still reaches her.
      expect(capture.messages[0]?.replyTo).toEqual({ name: "Ana Popescu", address: "ana@example.com" });
    });

    it("leaves an ordinary message exactly as it was: passed, off, or a Cloudflare that did not answer", async () => {
      const expected = renderContactMessage(
        { name: PERSON.name, email: PERSON.email, message: PERSON.message, locale: PERSON.locale, pageUrl: PAGE },
        delivery(createCaptureSmtpTransport()),
      );
      for (const screening of [
        PASSED,
        { ...PASSED, turnstileVerdict: "unavailable" as const },
        { botCheckOn: false, tokenPresent: false, turnstileVerdict: "not_configured" as const, clubHost: "club.example" },
        // The rule off on a laptop's host, whatever the sender looks like.
        { ...NO_TOKEN, botCheckOn: false, turnstileVerdict: "not_configured" as const, clubHost: "localhost" },
      ]) {
        await resetTables(db);
        const capture = createCaptureSmtpTransport();
        expect(await submitContactMessage(db, delivery(capture), PERSON, NOW, PAGE, screening)).toEqual({ outcome: "sent" });
        const [sent] = capture.messages;
        expect({ ...sent, providerMessageId: undefined, capturedAt: undefined }).toEqual({
          ...expected,
          providerMessageId: undefined,
          capturedAt: undefined,
        });
      }
    });

    it("leaves the trap where it was: a filled trap is still answered 'sent' and sent nowhere, before any mark", async () => {
      const capture = createCaptureSmtpTransport();
      expect(
        await submitContactMessage(db, delivery(capture), { ...SCRIPT_POST, honeypot: "http://spam.example" }, NOW, PAGE, NO_TOKEN),
      ).toEqual({ outcome: "ignored" });
      expect(capture.messages).toHaveLength(0);
    });
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

    const configured = contactDeliveryFor(base, { to: ["club@example.com"], cc: ["amalia@example.org"], bcc: ["arhiva@example.org"] });
    expect(configured?.to).toEqual(["club@example.com"]);
    expect(configured?.cc).toEqual(["amalia@example.org"]);
    expect(configured?.bcc).toEqual(["arhiva@example.org"]);

    await submitContactMessage(db, configured, PERSON, NOW, PAGE);
    const [sent] = capturedContactMessages();
    expect(sent?.to).toEqual(["club@example.com"]);
    expect(sent?.cc).toEqual(["amalia@example.org"]);
    // The hidden copies reach the transport as `bcc` (2026-09-22): an envelope recipient the
    // SMTP adapter hands to Nodemailer under that name, so no header names them.
    expect(sent?.bcc).toEqual(["arhiva@example.org"]);
    // The visitor still answers "Reply", whoever else was copied.
    expect(sent?.replyTo).toEqual({ name: "Ana Popescu", address: "ana@example.com" });

    // No "to" in the setting: the environment answers, and both copy lists still apply — minus
    // the environment's own address, which is a recipient already.
    const fallback = contactDeliveryFor(base, { to: [], cc: ["amalia@example.org"], bcc: ["OLD@example.com", "arhiva@example.org"] });
    expect(fallback?.to).toEqual(["old@example.com"]);
    expect(fallback?.cc).toEqual(["amalia@example.org"]);
    expect(fallback?.bcc).toEqual(["arhiva@example.org"]);

    // Neither, on a deployment: nobody to send to is the same answer as no way to send.
    const nobody = contactDeliveryFor({ ...base, CONTACT_FORM_MODE: "smtp", CONTACT_FORM_TO: [] }, { to: [], cc: [], bcc: [] });
    expect(nobody).toBeNull();
    expect(await submitContactMessage(db, nobody, PERSON, NOW, PAGE)).toEqual({ outcome: "unavailable" });
  });
});
