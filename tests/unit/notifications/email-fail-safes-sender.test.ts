import { describe, expect, it } from "vitest";
import type { EmailAdapter, OutgoingEmail, SendResult } from "@/infrastructure/email/adapter";
import { createEmailSender } from "@/infrastructure/email/delivery";
import { GMAIL_CAP_DEFERRED_ERROR, gmailAdmission, type GmailLedger } from "@/modules/notifications/domain/email-transport";

/**
 * §NNN — the sender's side of «Gmail preia când Mailgun se oprește» (BR-REQ-080-02): `gmailOnly`
 * never reaches Mailgun, a refused message spills to Gmail carrying Mailgun's stop, and a bulk
 * message is never spilled. Stub adapters and ledger; no database.
 */
const NOW = new Date("2026-10-01T09:30:00.000Z");
const RETRY = new Date("2026-10-01T09:45:00.000Z");

function ledger(sentLastDay: number): GmailLedger {
  return {
    async admit(request) {
      return gmailAdmission(
        { configured: true, sentLastDay, lastSentAt: null, oldestInWindowAt: sentLastDay > 0 ? new Date(NOW.getTime() - 3_600_000) : null },
        { gmailDailyCap: request.dailyCap, gmailPaceSeconds: 0 },
        request.clock(),
        request.recipients,
        0,
      );
    },
    async accepted() {},
  };
}

function fake(answer: SendResult): EmailAdapter & { sent: number } {
  const adapter = {
    name: "fake",
    sent: 0,
    async send(): Promise<SendResult> {
      adapter.sent += 1;
      return answer;
    },
  };
  return adapter;
}

function build(options: { mailgun: SendResult; gmail?: SendResult; sentLastDay?: number; atGmailCap?: "defer" | "mailgun"; down?: boolean }) {
  const mailgun = fake(options.mailgun);
  const gmail = fake(options.gmail ?? { outcome: "sent", providerMessageId: "gm" });
  const failing = options.down ? fake({ outcome: "transient_failure", error: "gmail: login refused" }) : gmail;
  const sender = createEmailSender({
    appEnv: "production",
    mode: "live",
    allowlist: [],
    capture: fake({ outcome: "sent", providerMessageId: "cap" }),
    live: () => mailgun,
    gmail: {
      adapter: () => failing,
      ledger: ledger(options.sentLastDay ?? 0),
      dailyCap: 50,
      paceSeconds: 0,
      atGmailCap: options.atGmailCap ?? "defer",
      overflowToGmail: true,
      now: () => NOW,
      random: () => 0,
    },
  });
  return { sender, mailgun, gmail };
}

const message = (extra: Partial<OutgoingEmail> = {}): OutgoingEmail => ({
  to: "ana@example.ro",
  subject: "Salut",
  html: "<p>x</p>",
  text: "x",
  locale: "ro",
  idempotencyKey: "k",
  ...extra,
});

const paused: SendResult = { outcome: "throttled", error: "mailgun 429", paced: true, rateRefused: true, retryAfter: RETRY };

describe("§NNN the sender while Mailgun is stopped", () => {
  it("hands a gmailOnly message back at Gmail's cap, even when the club chose Mailgun at the cap, and never calls Mailgun", async () => {
    const { sender, mailgun, gmail } = build({ mailgun: { outcome: "sent", providerMessageId: "mg" }, sentLastDay: 50, atGmailCap: "mailgun" });
    const result = await sender.send(message({ transport: "gmail", gmailOnly: true }));
    expect(result).toMatchObject({ outcome: "throttled", error: GMAIL_CAP_DEFERRED_ERROR });
    expect(mailgun.sent).toBe(0);
    expect(gmail.sent).toBe(0);
  });

  it("hands a gmailOnly message back when Gmail is refusing, and never calls Mailgun", async () => {
    const { sender, mailgun } = build({ mailgun: { outcome: "sent", providerMessageId: "mg" }, down: true });
    const result = await sender.send(message({ transport: "gmail", gmailOnly: true }));
    expect(result.outcome).toBe("throttled");
    expect(mailgun.sent).toBe(0);
  });

  it("sends through Gmail what Mailgun's 429 refused, and carries the pause on the answer", async () => {
    const { sender, mailgun, gmail } = build({ mailgun: paused });
    const result = await sender.send(message());
    expect(mailgun.sent).toBe(1);
    expect(gmail.sent).toBe(1);
    expect(result).toMatchObject({ outcome: "sent", transport: "gmail", mailgunStopped: { kind: "paused", until: RETRY } });
  });

  it("does the same for a spent allowance (420), as kind «allowance»", async () => {
    const { sender, gmail } = build({ mailgun: { outcome: "throttled", error: "mailgun 420" } });
    const result = await sender.send(message());
    expect(gmail.sent).toBe(1);
    expect(result).toMatchObject({ outcome: "sent", transport: "gmail", mailgunStopped: { kind: "allowance" } });
  });

  it("never spills a bulk message to Gmail: the newsletter's refusal stands", async () => {
    const { sender, gmail } = build({ mailgun: paused });
    const result = await sender.send(message({ bulk: true }));
    expect(gmail.sent).toBe(0);
    expect(result.outcome).toBe("throttled");
  });
});
