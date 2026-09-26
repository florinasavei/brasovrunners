import { afterEach, describe, expect, it } from "vitest";
import {
  DEFAULT_SHOWN_CONTACT_ADDRESS,
  joinContactAddresses,
  replyToHeader,
  resolveShownContactAddresses,
  shownContactAddressSchema,
} from "@/modules/contact/domain/shown-address";
import { createEmailSenderForEnvironment } from "@/infrastructure/email/sender";
import { clubFactsFromEnv, fillClubFacts } from "@/modules/legal-documents/templates/club-facts";

/**
 * §442 — «Adresa de contact afișată»: the mailbox on the Mailgun domain (the default, from the
 * environment), the club's Gmail, or both; one list shown on the site, written into the legal
 * prefill and set as every email's Reply-To, while the sender stays on the Mailgun domain.
 */
const MAILBOX = "contact@mail.example.test";
const GMAIL = "club@gmail.example.test";

describe("the shown contact address, three modes", () => {
  it("defaults to the environment's mailbox, and to nothing without it", () => {
    expect(DEFAULT_SHOWN_CONTACT_ADDRESS.mode).toBe("mailbox");
    expect(resolveShownContactAddresses(null, MAILBOX)).toEqual([MAILBOX]);
    expect(resolveShownContactAddresses(null, undefined)).toEqual([]);
  });

  it("shows the Gmail alone, or the Gmail first and then the mailbox", () => {
    expect(resolveShownContactAddresses({ mode: "gmail", gmail: GMAIL }, MAILBOX)).toEqual([GMAIL]);
    expect(resolveShownContactAddresses({ mode: "both", gmail: GMAIL }, MAILBOX)).toEqual([GMAIL, MAILBOX]);
    // Both on a deployment with no mailbox is the Gmail alone; the same address twice is one.
    expect(resolveShownContactAddresses({ mode: "both", gmail: GMAIL }, undefined)).toEqual([GMAIL]);
    expect(resolveShownContactAddresses({ mode: "both", gmail: MAILBOX.toUpperCase() }, MAILBOX)).toEqual([MAILBOX.toUpperCase()]);
    // The mailbox mode ignores a Gmail kept from an earlier choice.
    expect(resolveShownContactAddresses({ mode: "mailbox", gmail: GMAIL }, MAILBOX)).toEqual([MAILBOX]);
  });

  it("validates the Gmail, and asks for it only where it is shown", () => {
    expect(shownContactAddressSchema.parse({ mode: "mailbox", gmail: "" })).toEqual({ mode: "mailbox", gmail: null });
    expect(shownContactAddressSchema.parse({ mode: "gmail", gmail: `  ${GMAIL} ` })).toEqual({ mode: "gmail", gmail: GMAIL });
    const missing = shownContactAddressSchema.safeParse({ mode: "both", gmail: "" });
    expect(missing.success).toBe(false);
    expect(missing.error?.issues[0].path).toEqual(["gmail"]);
    expect(shownContactAddressSchema.safeParse({ mode: "gmail", gmail: "club at gmail" }).success).toBe(false);
    expect(shownContactAddressSchema.safeParse({ mode: "everything", gmail: GMAIL }).success).toBe(false);
    expect(shownContactAddressSchema.safeParse({ mode: "gmail", gmail: GMAIL, extra: 1 }).success).toBe(false);
  });

  it("reads «a sau b» in Romanian, \"a or b\" in English, and one Reply-To header", () => {
    expect(joinContactAddresses([GMAIL, MAILBOX], "ro")).toBe(`${GMAIL} sau ${MAILBOX}`);
    expect(joinContactAddresses([GMAIL, MAILBOX], "en")).toBe(`${GMAIL} or ${MAILBOX}`);
    expect(replyToHeader([GMAIL, MAILBOX])).toBe(`${GMAIL}, ${MAILBOX}`);
    expect(replyToHeader([])).toBeUndefined();
  });
});

describe("the legal club-email placeholder", () => {
  const facts = (addresses?: string[]) =>
    clubFactsFromEnv(
      { CLUB_LEGAL_NAME: undefined, CLUB_REGISTRATION_NUMBER: undefined, CLUB_REGISTERED_ADDRESS: undefined, EMAIL_REPLY_TO: MAILBOX },
      addresses,
    );
  const body = { sections: [{ paragraphs: ["Scrie la <EMAIL DE CONTACT>.", "Write to <CONTACT EMAIL>."] }] };

  it("is the environment's mailbox without a setting, and both addresses joined per language with one", () => {
    expect(fillClubFacts(body, facts()).sections[0].paragraphs).toEqual([`Scrie la ${MAILBOX}.`, `Write to ${MAILBOX}.`]);
    expect(fillClubFacts(body, facts([GMAIL, MAILBOX])).sections[0].paragraphs).toEqual([
      `Scrie la ${GMAIL} sau ${MAILBOX}.`,
      `Write to ${GMAIL} or ${MAILBOX}.`,
    ]);
    // No address in force leaves the placeholder standing for the Administrator to type.
    expect(fillClubFacts(body, facts([])).sections[0].paragraphs).toEqual(body.sections[0].paragraphs);
  });
});

describe("the Reply-To every email carries", () => {
  const originalFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("follows the setting while the sender stays on the Mailgun domain", async () => {
    const forms: FormData[] = [];
    globalThis.fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
      forms.push(init?.body as FormData);
      return new Response(JSON.stringify({ id: "<1@mail.example.test>", message: "Queued" }), { status: 200 });
    }) as typeof fetch;
    const config = {
      APP_ENV: "production" as const,
      EMAIL_DELIVERY_MODE: "live" as const,
      EMAIL_ALLOWLIST: [],
      MAILGUN_API_KEY: "key-not-a-real-key",
      MAILGUN_DOMAIN: "mail.example.test",
      MAILGUN_API_BASE_URL: "https://api.example.test/v3",
      EMAIL_FROM_ADDRESS: undefined,
      EMAIL_FROM_NAME: "Club",
      EMAIL_REPLY_TO: MAILBOX,
      // No Gmail account: every message takes Mailgun's road (§443, the transport setting).
      CONTACT_SMTP_HOST: "smtp.gmail.com",
      CONTACT_SMTP_PORT: 465,
      CONTACT_SMTP_USER: undefined,
      CONTACT_SMTP_PASSWORD: undefined,
    };
    const message = { to: "ana@example.ro", subject: "S", html: "<p>x</p>", text: "x", locale: "ro" as const, idempotencyKey: "k" };

    await createEmailSenderForEnvironment(config, { replyTo: replyToHeader([GMAIL, MAILBOX]) }).sender.send(message);
    await createEmailSenderForEnvironment(config).sender.send(message);

    expect(forms[0].get("h:Reply-To")).toBe(`${GMAIL}, ${MAILBOX}`);
    expect(forms[0].get("from")).toBe('"Club" <noreply@mail.example.test>');
    // No override is the environment's mailbox, as before.
    expect(forms[1].get("h:Reply-To")).toBe(MAILBOX);
  });
});
