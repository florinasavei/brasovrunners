import { describe, expect, it } from "vitest";
import { emailMessageType } from "@/db/schema/email-outbox";
import type { EmailAdapter, OutgoingEmail, SendResult } from "@/infrastructure/email/adapter";
import { createEmailSender, type GmailRoad } from "@/infrastructure/email/delivery";
import { gmailFailureIsBeforeAcceptance } from "@/infrastructure/email/gmail-adapter";
import {
  DEFAULT_EMAIL_TRANSPORT,
  defaultEmailTransportFor,
  EMAIL_GROUP_OF,
  EMAIL_GROUPS,
  emailGroupOf,
  emailTransportSettingSchema,
  forecastCopiesNote,
  GMAIL_WINDOW_MS,
  gmailAdmission,
  gmailJitterCeilingMs,
  type GmailUsage,
  mailgunMessagesPerCompletedRegistration,
  NON_PRODUCTION_GMAIL_DAILY_CAP,
  preferredTransport,
  roadsByMessageType,
} from "@/modules/notifications/domain/email-transport";
import { messagesPerCompletedRegistration } from "@/modules/notifications/volume";

/**
 * §NNN — every email picks its road, Mailgun or the club's Gmail, by the club's setting per group,
 * with Gmail's daily cap (in recipients), its jittered pace and the choice at the cap. The pure
 * half: the groups, the setting, the admission; then the sender's routing with fake adapters, a
 * fake clock, a fake sleep and a fake random.
 */
const NOW = new Date("2026-10-08T10:00:00.000Z");

const usage = (over: Partial<GmailUsage> = {}): GmailUsage => ({
  configured: true,
  sentLastDay: 0,
  lastSentAt: null,
  oldestInWindowAt: null,
  ...over,
});

describe("§NNN the message groups and the setting", () => {
  it("puts every message type in exactly one group, and keeps the newsletter group empty for now", () => {
    for (const type of emailMessageType.enumValues) expect(EMAIL_GROUP_OF[type]).toBeDefined();
    expect(Object.keys(EMAIL_GROUP_OF).sort()).toEqual([...emailMessageType.enumValues].sort());
    expect(EMAIL_GROUPS).toEqual(["links", "confirmations", "reminders", "announcements", "club", "newsletter"]);
    expect(Object.values(EMAIL_GROUP_OF)).not.toContain("newsletter");
  });

  it("splits reminders and thank-yous from the organizers' announcements, and files a club copy under the club", () => {
    expect(emailGroupOf("EVENT_REMINDER", false)).toBe("reminders");
    expect(emailGroupOf("EVENT_THANKS", false)).toBe("reminders");
    for (const type of ["ORGANIZER_MESSAGE", "EVENT_UPDATE_NOTICE", "EVENT_CANCELLED", "REGISTRATION_OPENED"] as const) {
      expect(emailGroupOf(type, false)).toBe("announcements");
    }
    expect(emailGroupOf("REGISTRATION_CONFIRMED", false)).toBe("confirmations");
    expect(emailGroupOf("REGISTRATION_CONFIRMED", true)).toBe("club");
    expect(emailGroupOf("VERIFY_REGISTRATION_EMAIL", false)).toBe("links");
    expect(emailGroupOf("DECLARATION_ARCHIVE", false)).toBe("club");
  });

  it("defaults to the club's mail and the newsletter through Gmail, every participant through Mailgun, deferral at the cap and no overflow", () => {
    expect(preferredTransport(DEFAULT_EMAIL_TRANSPORT, "CLUB_CONFIRMATION_NOTICE", false)).toBe("gmail");
    expect(preferredTransport(DEFAULT_EMAIL_TRANSPORT, "REGISTRATION_CONFIRMED", true)).toBe("gmail");
    expect(preferredTransport(DEFAULT_EMAIL_TRANSPORT, "REGISTRATION_CONFIRMED", false)).toBe("mailgun");
    expect(preferredTransport(DEFAULT_EMAIL_TRANSPORT, "ORGANIZER_MESSAGE", false)).toBe("mailgun");
    expect(DEFAULT_EMAIL_TRANSPORT.groups.newsletter).toBe("gmail");
    // The privacy notice names Gmail as the club's mailbox, not as a road to participants.
    expect(DEFAULT_EMAIL_TRANSPORT.overflowToGmail).toBe(false);
    expect(DEFAULT_EMAIL_TRANSPORT.atGmailCap).toBe("defer");
    // Ten a minute.
    expect(DEFAULT_EMAIL_TRANSPORT.gmailPaceSeconds).toBe(6);
  });

  it("gives every environment but production a smaller share of the one Gmail account, the two under Google's 500", () => {
    expect(defaultEmailTransportFor("production").gmailDailyCap).toBe(DEFAULT_EMAIL_TRANSPORT.gmailDailyCap);
    expect(defaultEmailTransportFor("qa").gmailDailyCap).toBe(NON_PRODUCTION_GMAIL_DAILY_CAP);
    expect(defaultEmailTransportFor("production").gmailDailyCap + defaultEmailTransportFor("qa").gmailDailyCap).toBeLessThan(500);
  });

  it("refuses a cap above Gmail's own, a pace past ten seconds, a road that is not one, and a choice at the cap that is not one", () => {
    const valid = { ...DEFAULT_EMAIL_TRANSPORT, groups: { ...DEFAULT_EMAIL_TRANSPORT.groups } };
    expect(emailTransportSettingSchema.safeParse(valid).success).toBe(true);
    expect(emailTransportSettingSchema.safeParse({ ...valid, gmailDailyCap: 501 }).success).toBe(false);
    expect(emailTransportSettingSchema.safeParse({ ...valid, gmailDailyCap: 0 }).success).toBe(false);
    expect(emailTransportSettingSchema.safeParse({ ...valid, gmailPaceSeconds: 11 }).success).toBe(false);
    expect(emailTransportSettingSchema.safeParse({ ...valid, atGmailCap: "drop" }).success).toBe(false);
    expect(emailTransportSettingSchema.safeParse({ ...valid, groups: { ...valid.groups, links: "sms" } }).success).toBe(false);
  });

  it("says Mailgun for every type while Gmail is not configured, whatever the setting", () => {
    const allGmail = {
      ...DEFAULT_EMAIL_TRANSPORT,
      groups: { links: "gmail", confirmations: "gmail", reminders: "gmail", announcements: "gmail", club: "gmail", newsletter: "gmail" },
    } as const;
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

describe("§NNN the plan's forecast sentence agrees with its figure", () => {
  const base = { participantBccCount: 2, copiedMessagesPerRegistration: 4 };

  it("counts the hidden copies in Mailgun's cost while they go through Mailgun", () => {
    expect(forecastCopiesNote({ ...base, allMessagesPerRegistration: 14, messagesPerRegistration: 14 })).toEqual({ kind: "bcc", bcc: 2, extra: 8 });
  });

  it("says what Gmail carries instead once it does — never '8 of 5 are copies'", () => {
    // The review's case: Gmail configured, the default, two copy addresses, the archive named.
    const all = messagesPerCompletedRegistration({ archiveConfigured: true, participantBccCount: 2 });
    const mailgun = mailgunMessagesPerCompletedRegistration(DEFAULT_EMAIL_TRANSPORT, true, { archiveConfigured: true, participantBccCount: 2 });
    expect(forecastCopiesNote({ ...base, allMessagesPerRegistration: all, messagesPerRegistration: mailgun })).toEqual({ kind: "gmail", count: all - mailgun });
  });

  it("says nothing without copies or Gmail", () => {
    expect(forecastCopiesNote({ ...base, participantBccCount: 0, allMessagesPerRegistration: 6, messagesPerRegistration: 6 })).toBeNull();
  });
});

describe("§NNN Gmail's admission", () => {
  const setting = { gmailDailyCap: 3, gmailPaceSeconds: 5 };

  it("takes nothing while unconfigured, nothing past the cap in recipients, and never a message larger than the cap", () => {
    expect(gmailAdmission(usage({ configured: false }), setting, NOW)).toEqual({ admitted: false, reason: "unconfigured" });
    const oldest = new Date(NOW.getTime() - 5 * 60 * 60 * 1000);
    expect(gmailAdmission(usage({ sentLastDay: 3, oldestInWindowAt: oldest }), setting, NOW)).toEqual({
      admitted: false,
      reason: "cap",
      roomAt: new Date(oldest.getTime() + GMAIL_WINDOW_MS),
    });
    // Two sent, one message of two recipients (the address and a copy): over.
    expect(gmailAdmission(usage({ sentLastDay: 2, oldestInWindowAt: oldest }), setting, NOW, 2)).toMatchObject({ admitted: false, reason: "cap" });
    expect(gmailAdmission(usage({ sentLastDay: 1 }), setting, NOW, 2)).toMatchObject({ admitted: true });
    expect(gmailAdmission(usage(), setting, NOW, 4)).toEqual({ admitted: false, reason: "too-many-recipients" });
  });

  it("waits out the pace since the last Gmail send, plus the jitter, and nothing when the pace has passed", () => {
    expect(gmailAdmission(usage({ sentLastDay: 1 }), setting, NOW, 1, 700)).toEqual({ admitted: true, waitMs: 0 });
    expect(gmailAdmission(usage({ sentLastDay: 1, lastSentAt: new Date(NOW.getTime() - 2_000) }), setting, NOW)).toEqual({ admitted: true, waitMs: 3_000 });
    expect(gmailAdmission(usage({ sentLastDay: 1, lastSentAt: new Date(NOW.getTime() - 2_000) }), setting, NOW, 1, 700)).toEqual({ admitted: true, waitMs: 3_700 });
    expect(gmailAdmission(usage({ sentLastDay: 1, lastSentAt: new Date(NOW.getTime() - 9_000) }), setting, NOW, 1, 700)).toEqual({ admitted: true, waitMs: 0 });
  });

  it("keeps the jitter under two seconds and under half the pace", () => {
    expect(gmailJitterCeilingMs(6)).toBe(2_000);
    expect(gmailJitterCeilingMs(2)).toBe(1_000);
    expect(gmailJitterCeilingMs(0)).toBe(0);
  });
});

describe("§NNN a Gmail failure that may have been accepted is not sent again by Mailgun", () => {
  it("reroutes only what failed before Gmail could have taken the message", () => {
    for (const code of ["ECONNECTION", "EAUTH", "EDNS", "ETLS", "EENVELOPE", "EMESSAGE"]) {
      expect(gmailFailureIsBeforeAcceptance(Object.assign(new Error("x"), { code }))).toBe(true);
    }
    for (const error of [Object.assign(new Error("x"), { code: "ETIMEDOUT" }), Object.assign(new Error("x"), { code: "ESOCKET" }), new Error("x"), "x"]) {
      expect(gmailFailureIsBeforeAcceptance(error)).toBe(false);
    }
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

function message(transport: "mailgun" | "gmail" | undefined, to = "ana@example.ro", extra: Partial<OutgoingEmail> = {}): OutgoingEmail {
  return { to, subject: "Salut", html: "<p>x</p>", text: "x", locale: "ro", idempotencyKey: `k:${to}`, ...(transport ? { transport } : {}), ...extra };
}

function setup(overrides: Partial<GmailRoad> = {}, mode: "live" | "allowlist" | "capture" = "live", allowlist: string[] = []) {
  const mailgun = fakeAdapter("mailgun");
  const gmail = fakeAdapter("gmail");
  const capture = fakeAdapter("capture");
  const slept: number[] = [];
  const failures: string[] = [];
  let clock = NOW.getTime();
  const sender = createEmailSender({
    appEnv: mode === "live" ? "production" : "qa",
    mode,
    allowlist,
    capture,
    live: () => mailgun,
    gmail: {
      adapter: () => gmail,
      usage: usage(),
      dailyCap: 100,
      paceSeconds: 0,
      atGmailCap: "mailgun",
      overflowToGmail: true,
      now: () => new Date(clock),
      random: () => 0,
      onFailure: async (error) => {
        failures.push(error);
      },
      sleep: async (ms) => {
        slept.push(ms);
        clock += ms;
      },
      ...overrides,
    },
  });
  return { sender, mailgun, gmail, capture, slept, failures };
}

describe("§NNN the sender's road", () => {
  it("sends a Gmail group through Gmail and everything else through Mailgun, and says which and to how many", async () => {
    const { sender, mailgun, gmail } = setup();
    expect(await sender.send(message("gmail", "a@example.ro", { bcc: ["club@example.org", "org@example.org"] }))).toMatchObject({
      outcome: "sent",
      transport: "gmail",
      recipients: 3,
    });
    expect(await sender.send(message("mailgun"))).toMatchObject({ outcome: "sent", transport: "mailgun", recipients: 1 });
    expect(await sender.send(message(undefined))).toMatchObject({ outcome: "sent", transport: "mailgun" });
    expect(gmail.sent).toHaveLength(1);
    expect(mailgun.sent).toHaveLength(2);
  });

  it("takes Mailgun's road at once when Gmail refuses before acceptance, records the failure, and stops asking Gmail for the batch", async () => {
    const { sender, mailgun, gmail, failures } = setup();
    gmail.answer = { outcome: "transient_failure", error: "gmail: smtp EAUTH" };
    expect(await sender.send(message("gmail", "a@example.ro"))).toMatchObject({ outcome: "sent", transport: "mailgun" });
    expect(await sender.send(message("gmail", "b@example.ro"))).toMatchObject({ outcome: "sent", transport: "mailgun" });
    expect(gmail.sent).toHaveLength(1);
    expect(mailgun.sent.map((m) => m.to)).toEqual(["a@example.ro", "b@example.ro"]);
    expect(failures).toEqual(["gmail: smtp EAUTH"]);
  });

  it("hands a failure that may have been accepted back to the outbox rather than sending a second copy by Mailgun", async () => {
    const { sender, mailgun, gmail, failures } = setup();
    gmail.answer = { outcome: "transient_failure", error: "gmail: smtp ETIMEDOUT", mayHaveBeenAccepted: true };
    expect(await sender.send(message("gmail"))).toMatchObject({ outcome: "transient_failure", mayHaveBeenAccepted: true });
    expect(mailgun.sent).toHaveLength(0);
    expect(failures).toEqual(["gmail: smtp ETIMEDOUT"]);
  });

  it("hands Mailgun what Gmail's cap leaves over when the club chose so, counting recipients as it goes", async () => {
    const { sender, mailgun, gmail } = setup({ dailyCap: 3, usage: usage({ sentLastDay: 1 }) });
    expect(await sender.send(message("gmail", "a@example.ro", { cc: ["b@example.org"] }))).toMatchObject({ transport: "gmail", recipients: 2 });
    expect(await sender.send(message("gmail", "c@example.ro"))).toMatchObject({ transport: "mailgun" });
    expect(gmail.sent).toHaveLength(1);
    expect(mailgun.sent).toHaveLength(1);
  });

  it("defers at the cap when the club chose to wait — until the oldest send leaves the rolling day, Mailgun untouched", async () => {
    const oldest = new Date(NOW.getTime() - 20 * 60 * 60 * 1000);
    const { sender, mailgun, gmail } = setup({ dailyCap: 2, atGmailCap: "defer", usage: usage({ sentLastDay: 2, oldestInWindowAt: oldest }) });
    const result = await sender.send(message("gmail"));
    expect(result).toEqual({ outcome: "throttled", error: "gmail daily cap: deferred", retryAfter: new Date(oldest.getTime() + GMAIL_WINDOW_MS) });
    expect(gmail.sent).toHaveLength(0);
    expect(mailgun.sent).toHaveLength(0);
  });

  it("defers from the first send of this batch when the cap fills inside it", async () => {
    const { sender } = setup({ dailyCap: 1, atGmailCap: "defer" });
    await sender.send(message("gmail", "a@example.ro"));
    expect(await sender.send(message("gmail", "b@example.ro"))).toMatchObject({
      outcome: "throttled",
      retryAfter: new Date(NOW.getTime() + GMAIL_WINDOW_MS),
    });
  });

  it("waits the pace plus the jitter between two Gmail sends, and hands a message back once the batch's waiting is spent", async () => {
    const { sender, gmail, slept } = setup({ paceSeconds: 4, paceBudgetMs: 6_000, random: () => 0.5 });
    await sender.send(message("gmail", "a@example.ro"));
    await sender.send(message("gmail", "b@example.ro"));
    // Four seconds, and half of the two-second jitter ceiling.
    expect(slept).toEqual([5_000]);
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

  it("keeps Mailgun's own deferral for a spill-over at Gmail's cap, whatever the choice at the cap", async () => {
    const spent: SendResult = { outcome: "throttled", error: "mailgun 420: limit exceeded" };
    const { sender, mailgun } = setup({ dailyCap: 1, atGmailCap: "defer", usage: usage({ sentLastDay: 1, oldestInWindowAt: NOW }) });
    mailgun.answer = spent;
    expect(await sender.send(message("mailgun"))).toBe(spent);
  });

  it("never spills a permanent refusal into Gmail", async () => {
    const { sender, mailgun, gmail } = setup();
    mailgun.answer = { outcome: "permanent_failure", error: "mailgun 400: bad address" };
    expect(await sender.send(message("mailgun"))).toMatchObject({ outcome: "permanent_failure" });
    expect(gmail.sent).toHaveLength(0);
  });

  it("captures on QA what the allowlist does not name, whichever road the club chose — waiting for nothing and counting nobody", async () => {
    const { sender, mailgun, gmail, capture, slept } = setup({ paceSeconds: 5, dailyCap: 1, atGmailCap: "defer" }, "allowlist", ["tester@example.ro"]);
    expect(await sender.send(message("gmail", "stranger@example.ro"))).toMatchObject({ outcome: "sent", transport: "gmail", recipients: 0 });
    // A cap of one, and still captured: a captured message is not a recipient.
    expect(await sender.send(message("gmail", "other@example.ro"))).toMatchObject({ outcome: "sent", transport: "gmail", recipients: 0 });
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
