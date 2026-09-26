import { describe, expect, it } from "vitest";
import { emailMessageType } from "@/db/schema/email-outbox";
import type { EmailAdapter, OutgoingEmail, SendResult } from "@/infrastructure/email/adapter";
import { createEmailSender, type GmailRoad } from "@/infrastructure/email/delivery";
import {
  DEFAULT_EMAIL_TRANSPORT,
  EMAIL_GROUP_OF,
  emailGroupOf,
  emailTransportSettingSchema,
  gmailAdmission,
  mailgunMessagesPerCompletedRegistration,
  preferredTransport,
  roadsByMessageType,
} from "@/modules/notifications/domain/email-transport";
import { messagesPerCompletedRegistration } from "@/modules/notifications/volume";

/**
 * §NNN — every email picks its road, Mailgun or the club's Gmail, by the club's setting per group,
 * with Gmail's daily cap and pace. The pure half: the groups, the setting, the admission; then the
 * sender's routing with fake adapters, a fake clock and a fake sleep.
 */
const NOW = new Date("2026-10-08T10:00:00.000Z");

describe("§NNN the message groups and the setting", () => {
  it("puts every message type in exactly one group", () => {
    for (const type of emailMessageType.enumValues) expect(EMAIL_GROUP_OF[type]).toBeDefined();
    expect(Object.keys(EMAIL_GROUP_OF).sort()).toEqual([...emailMessageType.enumValues].sort());
  });

  it("files a club copy under the club, whatever it copies", () => {
    expect(emailGroupOf("REGISTRATION_CONFIRMED", false)).toBe("confirmations");
    expect(emailGroupOf("REGISTRATION_CONFIRMED", true)).toBe("club");
    expect(emailGroupOf("VERIFY_REGISTRATION_EMAIL", false)).toBe("links");
    expect(emailGroupOf("ORGANIZER_MESSAGE", false)).toBe("event");
    expect(emailGroupOf("DECLARATION_ARCHIVE", false)).toBe("club");
  });

  it("defaults to the club's own mail through Gmail and everything a participant gets through Mailgun", () => {
    expect(preferredTransport(DEFAULT_EMAIL_TRANSPORT, "CLUB_CONFIRMATION_NOTICE", false)).toBe("gmail");
    expect(preferredTransport(DEFAULT_EMAIL_TRANSPORT, "REGISTRATION_CONFIRMED", true)).toBe("gmail");
    expect(preferredTransport(DEFAULT_EMAIL_TRANSPORT, "REGISTRATION_CONFIRMED", false)).toBe("mailgun");
    expect(preferredTransport(DEFAULT_EMAIL_TRANSPORT, "VERIFY_REGISTRATION_EMAIL", false)).toBe("mailgun");
    expect(DEFAULT_EMAIL_TRANSPORT.overflowToGmail).toBe(true);
  });

  it("refuses a cap above Gmail's own, a pace past ten seconds, and a road that is not one", () => {
    const valid = { ...DEFAULT_EMAIL_TRANSPORT, groups: { ...DEFAULT_EMAIL_TRANSPORT.groups } };
    expect(emailTransportSettingSchema.safeParse(valid).success).toBe(true);
    expect(emailTransportSettingSchema.safeParse({ ...valid, gmailDailyCap: 501 }).success).toBe(false);
    expect(emailTransportSettingSchema.safeParse({ ...valid, gmailDailyCap: 0 }).success).toBe(false);
    expect(emailTransportSettingSchema.safeParse({ ...valid, gmailPaceSeconds: 11 }).success).toBe(false);
    expect(emailTransportSettingSchema.safeParse({ ...valid, groups: { ...valid.groups, links: "sms" } }).success).toBe(false);
  });

  it("says Mailgun for every type while Gmail is not configured, whatever the setting", () => {
    const allGmail = { ...DEFAULT_EMAIL_TRANSPORT, groups: { links: "gmail", confirmations: "gmail", event: "gmail", club: "gmail" } } as const;
    const roads = roadsByMessageType(allGmail, false);
    expect(new Set(Object.values(roads))).toEqual(new Set(["mailgun"]));
    expect(roadsByMessageType(DEFAULT_EMAIL_TRANSPORT, true).STAFF_INVITATION).toBe("gmail");
    expect(roadsByMessageType(DEFAULT_EMAIL_TRANSPORT, true).EVENT_REMINDER).toBe("mailgun");
  });

  it("prices a registration for Mailgun as the whole of it without Gmail, and less the club's mail with it", () => {
    for (const input of [
      { archiveConfigured: false, participantBccCount: 0 },
      { archiveConfigured: true, participantBccCount: 2 },
    ]) {
      expect(mailgunMessagesPerCompletedRegistration(DEFAULT_EMAIL_TRANSPORT, false, input)).toBe(messagesPerCompletedRegistration(input));
    }
    // Club on Gmail: the runner's five stay Mailgun's; the copies, the notice and the archive go.
    expect(mailgunMessagesPerCompletedRegistration(DEFAULT_EMAIL_TRANSPORT, true, { archiveConfigured: true, participantBccCount: 2 })).toBe(5);
  });
});

describe("§NNN Gmail's admission", () => {
  const setting = { gmailDailyCap: 3, gmailPaceSeconds: 5 };

  it("takes nothing while unconfigured, and nothing at the cap", () => {
    expect(gmailAdmission({ configured: false, sentLastDay: 0, lastSentAt: null }, setting, NOW)).toEqual({ admitted: false, reason: "unconfigured" });
    expect(gmailAdmission({ configured: true, sentLastDay: 3, lastSentAt: null }, setting, NOW)).toEqual({ admitted: false, reason: "cap" });
  });

  it("waits out the pace since the last Gmail send, and not a millisecond more", () => {
    expect(gmailAdmission({ configured: true, sentLastDay: 1, lastSentAt: null }, setting, NOW)).toEqual({ admitted: true, waitMs: 0 });
    expect(gmailAdmission({ configured: true, sentLastDay: 1, lastSentAt: new Date(NOW.getTime() - 2_000) }, setting, NOW)).toEqual({ admitted: true, waitMs: 3_000 });
    expect(gmailAdmission({ configured: true, sentLastDay: 1, lastSentAt: new Date(NOW.getTime() - 9_000) }, setting, NOW)).toEqual({ admitted: true, waitMs: 0 });
  });
});

type Fake = EmailAdapter & { sent: OutgoingEmail[]; answer: SendResult };

function fakeAdapter(name: string, answer: SendResult = { outcome: "sent", providerMessageId: `${name}:1` }): Fake {
  const sent: OutgoingEmail[] = [];
  const fake: Fake = {
    name,
    sent,
    answer,
    async send(message) {
      sent.push(message);
      return fake.answer;
    },
  };
  return fake;
}

function message(transport: "mailgun" | "gmail" | undefined, to = "ana@example.ro"): OutgoingEmail {
  return { to, subject: "Salut", html: "<p>x</p>", text: "x", locale: "ro", idempotencyKey: `k:${to}`, ...(transport ? { transport } : {}) };
}

function setup(overrides: Partial<GmailRoad> = {}, mode: "live" | "allowlist" | "capture" = "live", allowlist: string[] = []) {
  const mailgun = fakeAdapter("mailgun");
  const gmail = fakeAdapter("gmail");
  const capture = fakeAdapter("capture");
  const slept: number[] = [];
  let clock = NOW.getTime();
  const sender = createEmailSender({
    appEnv: mode === "live" ? "production" : "qa",
    mode,
    allowlist,
    capture,
    live: () => mailgun,
    gmail: {
      adapter: () => gmail,
      usage: { configured: true, sentLastDay: 0, lastSentAt: null },
      dailyCap: 100,
      paceSeconds: 0,
      overflowToGmail: true,
      now: () => new Date(clock),
      sleep: async (ms) => {
        slept.push(ms);
        clock += ms;
      },
      ...overrides,
    },
  });
  return { sender, mailgun, gmail, capture, slept };
}

describe("§NNN the sender's road", () => {
  it("sends a Gmail group through Gmail and everything else through Mailgun, and says which", async () => {
    const { sender, mailgun, gmail } = setup();
    expect(await sender.send(message("gmail"))).toMatchObject({ outcome: "sent", transport: "gmail" });
    expect(await sender.send(message("mailgun"))).toMatchObject({ outcome: "sent", transport: "mailgun" });
    expect(await sender.send(message(undefined))).toMatchObject({ outcome: "sent", transport: "mailgun" });
    expect(gmail.sent).toHaveLength(1);
    expect(mailgun.sent).toHaveLength(2);
  });

  it("takes Mailgun's road at once when Gmail refuses, and stops asking Gmail for the rest of the batch", async () => {
    const { sender, mailgun, gmail } = setup();
    gmail.answer = { outcome: "transient_failure", error: "gmail: smtp EAUTH" };
    expect(await sender.send(message("gmail", "a@example.ro"))).toMatchObject({ outcome: "sent", transport: "mailgun" });
    expect(await sender.send(message("gmail", "b@example.ro"))).toMatchObject({ outcome: "sent", transport: "mailgun" });
    expect(gmail.sent).toHaveLength(1);
    expect(mailgun.sent.map((m) => m.to)).toEqual(["a@example.ro", "b@example.ro"]);
  });

  it("hands Mailgun what Gmail's cap leaves over, counting its own sends as it goes", async () => {
    const { sender, mailgun, gmail } = setup({ dailyCap: 2, usage: { configured: true, sentLastDay: 1, lastSentAt: null } });
    expect(await sender.send(message("gmail", "a@example.ro"))).toMatchObject({ transport: "gmail" });
    expect(await sender.send(message("gmail", "b@example.ro"))).toMatchObject({ transport: "mailgun" });
    expect(gmail.sent).toHaveLength(1);
    expect(mailgun.sent).toHaveLength(1);
  });

  it("waits the pace between two Gmail sends, and hands a message back once the batch's waiting is spent", async () => {
    const { sender, gmail, slept } = setup({ paceSeconds: 4, paceBudgetMs: 6_000 });
    await sender.send(message("gmail", "a@example.ro"));
    await sender.send(message("gmail", "b@example.ro"));
    expect(slept).toEqual([4_000]);
    const third = await sender.send(message("gmail", "c@example.ro"));
    expect(third).toMatchObject({ outcome: "throttled", paced: true });
    expect(gmail.sent.map((m) => m.to)).toEqual(["a@example.ro", "b@example.ro"]);
  });

  it("spills Mailgun's spent day into Gmail when the club lets it, and leaves the refusal standing when not", async () => {
    const spent: SendResult = { outcome: "throttled", error: "mailgun 420: limit exceeded" };
    const on = setup();
    on.mailgun.answer = spent;
    expect(await on.sender.send(message("mailgun"))).toMatchObject({ outcome: "sent", transport: "gmail" });

    const off = setup({ overflowToGmail: false });
    off.mailgun.answer = spent;
    expect(await off.sender.send(message("mailgun"))).toMatchObject({ outcome: "throttled" });
    expect(off.gmail.sent).toHaveLength(0);
  });

  it("never spills a permanent refusal into Gmail", async () => {
    const { sender, mailgun, gmail } = setup();
    mailgun.answer = { outcome: "permanent_failure", error: "mailgun 400: bad address" };
    expect(await sender.send(message("mailgun"))).toMatchObject({ outcome: "permanent_failure" });
    expect(gmail.sent).toHaveLength(0);
  });

  it("captures on QA what the allowlist does not name, whichever road the club chose — and waits for nothing it captures", async () => {
    const { sender, mailgun, gmail, capture, slept } = setup({ paceSeconds: 5 }, "allowlist", ["tester@example.ro"]);
    expect(await sender.send(message("gmail", "stranger@example.ro"))).toMatchObject({ outcome: "sent", transport: "gmail" });
    expect(await sender.send(message("gmail", "other@example.ro"))).toMatchObject({ outcome: "sent", transport: "gmail" });
    expect(capture.sent).toHaveLength(2);
    expect(gmail.sent).toHaveLength(0);
    expect(mailgun.sent).toHaveLength(0);
    expect(slept).toEqual([]);
    // The allowlisted one does leave, through Gmail, marked [QA].
    const { sender: qa, gmail: qaGmail } = setup({}, "allowlist", ["tester@example.ro"]);
    await qa.send(message("gmail", "tester@example.ro"));
    expect(qaGmail.sent[0]?.subject.startsWith("[QA] ")).toBe(true);
  });

  it("is Mailgun's road alone without a Gmail road at all", async () => {
    const mailgun = fakeAdapter("mailgun");
    const sender = createEmailSender({ appEnv: "production", mode: "live", allowlist: [], capture: fakeAdapter("capture"), live: () => mailgun });
    expect(await sender.send(message("gmail"))).toMatchObject({ outcome: "sent", transport: "mailgun" });
    expect(mailgun.sent).toHaveLength(1);
  });
});
