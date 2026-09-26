import { afterEach, describe, expect, it } from "vitest";
import en from "../../../messages/en.json";
import ro from "../../../messages/ro.json";
import {
  DEFAULT_SHOWN_CONTACT_ADDRESS,
  defaultShownContactAddress,
  joinContactAddresses,
  replyToHeader,
  configuredGmailAddress,
  effectiveGmail,
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
  it("defaults to the environment's mailbox where no Gmail is configured, and to nothing without it", () => {
    expect(DEFAULT_SHOWN_CONTACT_ADDRESS.mode).toBe("mailbox");
    expect(resolveShownContactAddresses(null, MAILBOX)).toEqual([MAILBOX]);
    expect(resolveShownContactAddresses(null, MAILBOX, null)).toEqual([MAILBOX]);
    expect(resolveShownContactAddresses(null, undefined)).toEqual([]);
  });

  it("§442 as amended: defaults to the configured Gmail (CONTACT_SMTP_USER) until the club chooses", () => {
    expect(defaultShownContactAddress(GMAIL)).toEqual({ mode: "gmail", gmail: GMAIL });
    expect(defaultShownContactAddress(`  ${GMAIL} `)).toEqual({ mode: "gmail", gmail: GMAIL });
    expect(resolveShownContactAddresses(null, MAILBOX, GMAIL)).toEqual([GMAIL]);
    expect(replyToHeader(resolveShownContactAddresses(null, MAILBOX, GMAIL))).toBe(GMAIL);
    // No Gmail, or one that is not an address: the mailbox, as before.
    expect(defaultShownContactAddress(undefined)).toEqual(DEFAULT_SHOWN_CONTACT_ADDRESS);
    expect(defaultShownContactAddress("")).toEqual(DEFAULT_SHOWN_CONTACT_ADDRESS);
    expect(defaultShownContactAddress("not an address")).toEqual(DEFAULT_SHOWN_CONTACT_ADDRESS);
    // A saved choice wins over the default, the mailbox included.
    expect(resolveShownContactAddresses({ mode: "mailbox", gmail: null }, MAILBOX, GMAIL)).toEqual([MAILBOX]);
    // The Gmail is the configuration's: a typed one kept in an older row gives way to it.
    expect(resolveShownContactAddresses({ mode: "both", gmail: GMAIL }, MAILBOX, "other@gmail.example.test")).toEqual([
      "other@gmail.example.test",
      MAILBOX,
    ]);
  });

  it("§442 as amended: the Gmail comes from configuration; a legacy typed one only where none is configured", () => {
    expect(effectiveGmail(GMAIL, GMAIL)).toBe(GMAIL);
    expect(effectiveGmail("typed@gmail.example.test", GMAIL)).toBe(GMAIL);
    expect(effectiveGmail(null, GMAIL)).toBe(GMAIL);
    expect(effectiveGmail("typed@gmail.example.test", undefined)).toBe("typed@gmail.example.test");
    expect(effectiveGmail(null, "not an address")).toBeNull();
    expect(configuredGmailAddress(` ${GMAIL} `)).toBe(GMAIL);
    expect(resolveShownContactAddresses({ mode: "gmail", gmail: null }, MAILBOX, GMAIL)).toEqual([GMAIL]);
    // A Gmail mode with no Gmail anywhere falls back to the mailbox.
    expect(resolveShownContactAddresses({ mode: "gmail", gmail: null }, MAILBOX, null)).toEqual([MAILBOX]);
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
    // The Gmail is no longer typed, so a mode without one parses; the configuration supplies it.
    expect(shownContactAddressSchema.parse({ mode: "both", gmail: "" })).toEqual({ mode: "both", gmail: null });
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

describe("the panel's words for the configured Gmail, both languages", () => {
  const words = (locale: "ro" | "en") => (locale === "ro" ? ro : en).Admin.emails.shownAddress;

  it("names the Gmail from configuration, read-only, in Romanian and English", () => {
    expect(words("ro").modes.gmail).toBe("Gmail-ul clubului (din configurație): {gmail} — implicit");
    expect(words("en").modes.gmail).toBe("The club's Gmail (from configuration): {gmail} — default");
    expect(words("ro").gmailConfigured).toContain("Gmail-ul clubului (din configurație): {gmail}");
    expect(words("en").gmailConfigured).toContain("The club's Gmail (from configuration): {gmail}");
    for (const locale of ["ro", "en"] as const) {
      expect(words(locale).modes.both).toContain("{gmail}");
      expect(words(locale).gmailMissing).toContain("CONTACT_SMTP_USER");
      // No typed field any more.
      expect(words(locale)).not.toHaveProperty("gmailHelp");
    }
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
