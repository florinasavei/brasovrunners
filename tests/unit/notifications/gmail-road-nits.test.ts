import { beforeEach, describe, expect, it, vi } from "vitest";
import type { EmailAdapter, OutgoingEmail, SendResult } from "@/infrastructure/email/adapter";
import { gmailAdmission, type GmailLedger } from "@/modules/notifications/domain/email-transport";

/**
 * §NNN — the Gmail road's nits after §443:
 *
 * - one pooled SMTP connection per batch, closed when the batch ends — not a TLS handshake and a
 *   login per message;
 * - an address Gmail refuses for good (a `5.1.x`) is the bounce it is: not handed to Mailgun, not a
 *   Gmail failure, and the next message still goes through Gmail;
 * - Google's own limit or a policy refusal (`5.4.5`, `5.7.x`) is still Mailgun's to try.
 *
 * Nodemailer is replaced by a transporter that records what it was built with and answers what
 * each test tells it to.
 */
const smtp = vi.hoisted(() => ({
  built: [] as Array<Record<string, unknown>>,
  closed: 0,
  answer: null as null | ((message: { to: string; bcc?: string[] }) => unknown),
}));

vi.mock("nodemailer", () => ({
  default: {
    createTransport: (options: Record<string, unknown>) => {
      smtp.built.push(options);
      return {
        sendMail: async (message: { to: string; bcc?: string[] }) => {
          const answer = smtp.answer?.(message);
          if (answer instanceof Error) throw answer;
          return answer ?? { accepted: [message.to], rejected: [], messageId: "<gm-1>" };
        },
        close: () => {
          smtp.closed += 1;
        },
      };
    },
  },
}));

const { createGmailAdapter, enhancedStatusOf, gmailRefusedTheAddress, refusalOf } = await import("@/infrastructure/email/gmail-adapter");
const { createEmailSender } = await import("@/infrastructure/email/delivery");

const NOW = new Date("2026-10-08T10:00:00.000Z");

/** Nodemailer's error for a refused command, as `smtp-connection` formats it. */
function smtpError(code: string, response: string, extra: Record<string, unknown> = {}): Error {
  return Object.assign(new Error(response), { code, response, responseCode: Number(response.slice(0, 3)), command: "RCPT TO", ...extra });
}

function message(to = "ana@example.ro", extra: Partial<OutgoingEmail> = {}): OutgoingEmail {
  return { to, subject: "Salut", html: "<p>x</p>", text: "x", locale: "ro", idempotencyKey: `k:${to}`, transport: "gmail", ...extra };
}

const adapterConfig = { host: "smtp.example.org", port: 465, user: "club@example.org", password: "app-password", from: { name: "Club", address: "club@example.org" } };

beforeEach(() => {
  smtp.built.length = 0;
  smtp.closed = 0;
  smtp.answer = null;
});

describe("§NNN the Gmail adapter", () => {
  it("keeps one pooled connection, never re-sends a message its connection dropped, and lets it go on close", async () => {
    const adapter = createGmailAdapter(adapterConfig);
    await adapter.send(message("a@example.ro"));
    await adapter.send(message("b@example.ro"));
    expect(smtp.built).toHaveLength(1);
    expect(smtp.built[0]).toMatchObject({ pool: true, maxConnections: 1, maxRequeues: 0, secure: true });
    adapter.close?.();
    expect(smtp.closed).toBe(1);
  });

  it("bounces an address Gmail refuses for good — alone, or with the club's copy accepted", async () => {
    const adapter = createGmailAdapter(adapterConfig);
    const refused = smtpError("EENVELOPE", "550 5.1.1 The email account that you tried to reach does not exist.", { recipient: "gone@example.ro" });
    smtp.answer = () => smtpError("EENVELOPE", "550 5.1.1 The email account that you tried to reach does not exist.", { rejected: ["gone@example.ro"], rejectedErrors: [refused] });
    expect(await adapter.send(message("gone@example.ro"))).toEqual({ outcome: "permanent_failure", error: "gmail: smtp EENVELOPE 5.1.1" });

    // The copy went, the runner's address did not: never "sent".
    smtp.answer = (sent) => ({ accepted: sent.bcc ?? [], rejected: [sent.to], rejectedErrors: [refused], messageId: "<gm-2>" });
    expect(await adapter.send(message("gone@example.ro", { bcc: ["club@example.org"] }))).toMatchObject({ outcome: "permanent_failure", acceptedRecipients: 1 });
  });

  it("leaves a refusal about the account or the moment to Mailgun, and a temporary refusal of the address to the outbox", async () => {
    const adapter = createGmailAdapter(adapterConfig);
    const quota = smtpError("EENVELOPE", "550 5.4.5 Daily user sending limit exceeded.", {
      rejected: ["a@example.ro"],
      rejectedErrors: [smtpError("EENVELOPE", "550 5.4.5 Daily user sending limit exceeded.", { recipient: "a@example.ro" })],
    });
    smtp.answer = () => quota;
    expect(await adapter.send(message("a@example.ro"))).toEqual({ outcome: "transient_failure", error: "gmail: smtp EENVELOPE" });

    smtp.answer = () => smtpError("EAUTH", "535 5.7.8 Username and Password not accepted.");
    expect(await adapter.send(message("a@example.ro"))).toEqual({ outcome: "transient_failure", error: "gmail: smtp EAUTH" });

    const later = Object.assign(smtpError("EENVELOPE", "450 4.2.1 Try again later."), { recipient: "a@example.ro" });
    smtp.answer = (sent) => ({ accepted: sent.bcc ?? [], rejected: [sent.to], rejectedErrors: [later], messageId: "<gm-3>" });
    expect(await adapter.send(message("a@example.ro", { bcc: ["club@example.org"] }))).toMatchObject({
      outcome: "transient_failure",
      mayHaveBeenAccepted: true,
      addressRefusedForNow: true,
      acceptedRecipients: 1,
    });
  });

  it("reads the enhanced status without keeping the reply, and judges only the runner's own refusal", () => {
    expect(enhancedStatusOf({ response: "550-5.1.1 The email account…" })).toBe("5.1.1");
    expect(enhancedStatusOf({ response: "250 OK" })).toBeNull();
    expect(gmailRefusedTheAddress({ responseCode: 553, response: "553 5.1.2 bad destination" })).toBe(true);
    expect(gmailRefusedTheAddress({ responseCode: 550, response: "550 5.7.1 policy" })).toBe(false);
    expect(gmailRefusedTheAddress({ responseCode: 451, response: "451 4.1.1 later" })).toBe(false);
    const copyOnly = { rejected: ["club@example.org"], rejectedErrors: [{ recipient: "club@example.org", responseCode: 550, response: "550 5.1.1 x" }] };
    expect(refusalOf("Ana@Example.ro", copyOnly)).toBeNull();
    expect(refusalOf("Ana@Example.ro", { rejected: ["ana@example.ro"], rejectedErrors: [] })).toEqual({});
  });
});

/** What the ledger was told Gmail took: recipients per send. */
const credited: number[] = [];

/** A ledger that admits every message at once. */
const openLedger: GmailLedger = {
  async admit(request) {
    return gmailAdmission(
      { configured: true, sentLastDay: 0, lastSentAt: null, oldestInWindowAt: null },
      { gmailDailyCap: request.dailyCap, gmailPaceSeconds: 0 },
      request.clock(),
      request.recipients,
      0,
    );
  },
  async accepted(recipients) {
    credited.push(recipients);
  },
};

function fake(name: string, answers: SendResult[] = []): EmailAdapter & { sent: string[]; closed: number } {
  const adapter = {
    name,
    sent: [] as string[],
    closed: 0,
    async send(outgoing: OutgoingEmail): Promise<SendResult> {
      adapter.sent.push(outgoing.to);
      return answers.shift() ?? { outcome: "sent", providerMessageId: `${name}:${adapter.sent.length}` };
    },
    close() {
      adapter.closed += 1;
    },
  };
  return adapter;
}

describe("§NNN the sender's Gmail road", () => {
  function setup(gmailAnswers: SendResult[] = []) {
    credited.length = 0;
    const gmail = fake("gmail", gmailAnswers);
    const mailgun = fake("mailgun");
    const failures: string[] = [];
    let built = 0;
    const sender = createEmailSender({
      appEnv: "production",
      mode: "live",
      allowlist: [],
      capture: fake("capture"),
      live: () => mailgun,
      gmail: {
        adapter: () => {
          built += 1;
          return gmail;
        },
        ledger: openLedger,
        dailyCap: 100,
        paceSeconds: 0,
        atGmailCap: "defer",
        overflowToGmail: false,
        now: () => NOW,
        random: () => 0,
        onFailure: async (error) => {
          failures.push(error);
        },
      },
    });
    return { sender, gmail, mailgun, failures, built: () => built };
  }

  it("builds the Gmail adapter once for the batch and closes it once at the end", async () => {
    const { sender, gmail, built } = setup();
    for (const to of ["a@example.ro", "b@example.ro", "c@example.ro"]) await sender.send(message(to));
    expect(built()).toBe(1);
    expect(gmail.sent).toHaveLength(3);
    sender.close?.();
    sender.close?.();
    expect(gmail.closed).toBe(1);
  });

  it("returns a bounced address as the bounce — no Mailgun, no Gmail failure, and Gmail keeps the rest of the batch", async () => {
    const { sender, gmail, mailgun, failures } = setup([{ outcome: "permanent_failure", error: "gmail: smtp EENVELOPE 5.1.1" }]);
    expect(await sender.send(message("gone@example.ro"))).toEqual({ outcome: "permanent_failure", error: "gmail: smtp EENVELOPE 5.1.1" });
    expect(mailgun.sent).toEqual([]);
    expect(failures).toEqual([]);
    expect(await sender.send(message("b@example.ro"))).toMatchObject({ outcome: "sent", transport: "gmail" });
    expect(gmail.sent).toEqual(["gone@example.ro", "b@example.ro"]);
  });

  it("credits the day's ledger with the club's copies Gmail took before refusing the address", async () => {
    const { sender } = setup([{ outcome: "permanent_failure", error: "gmail: the address was refused (5.1.1)", acceptedRecipients: 2 }]);
    expect(await sender.send(message("gone@example.ro"))).toMatchObject({ outcome: "permanent_failure" });
    expect(credited).toEqual([2]);
  });

  it("returns an address refused for now to the outbox — Gmail not marked down, no Gmail failure, the copies counted", async () => {
    const refusedForNow: SendResult = {
      outcome: "transient_failure",
      error: "gmail: the address was refused for now",
      mayHaveBeenAccepted: true,
      addressRefusedForNow: true,
      acceptedRecipients: 1,
    };
    const { sender, gmail, mailgun, failures } = setup([refusedForNow]);
    expect(await sender.send(message("later@example.ro"))).toEqual(refusedForNow);
    expect(failures).toEqual([]);
    expect(credited).toEqual([1]);
    // The account works: the next message still leaves through Gmail, never Mailgun.
    expect(await sender.send(message("b@example.ro"))).toMatchObject({ outcome: "sent", transport: "gmail" });
    expect(gmail.sent).toEqual(["later@example.ro", "b@example.ro"]);
    expect(mailgun.sent).toEqual([]);
  });

  it("closes nothing on a sender that never took the Gmail road", () => {
    const { sender, built } = setup();
    sender.close?.();
    expect(built()).toBe(0);
  });
});
