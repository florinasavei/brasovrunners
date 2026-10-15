import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { auditLogs } from "@/db/schema/audit-logs";
import { emailOutbox } from "@/db/schema/email-outbox";
import { eventTranslations, events } from "@/db/schema/events";
import { participants } from "@/db/schema/participants";
import { platformSettings } from "@/db/schema/platform-settings";
import { rateLimitBuckets } from "@/db/schema/rate-limit";
import { registrations } from "@/db/schema/registrations";
import { type StaffUser, staffUsers } from "@/db/schema/staff-users";
import type { OutgoingEmail, SendResult } from "@/infrastructure/email/adapter";
import { createMailgunAdapter } from "@/infrastructure/email/mailgun-adapter";
import type { ContactScreening } from "@/modules/contact/service";
import {
  DEFAULT_FEEDBACK_SETTINGS,
  FEEDBACK_BRANCHES,
  type FeedbackBranch,
  type FeedbackSettings,
  type FeedbackVia,
  NO_CONTACT_LINE,
  SAFETY_SUBJECT,
} from "@/modules/feedback/domain/branches";
import { forgetFeedbackLinkMemo } from "@/modules/feedback/links";
import { type FeedbackDeps, submitFeedback as queueFeedback } from "@/modules/feedback/service";
import { FEEDBACK_SETTING_KEY, readFeedbackSettings, updateFeedbackSettings } from "@/modules/feedback/settings";
import { computeContentHash, type LegalDocumentBody } from "@/modules/legal-documents/domain/content-hash";
import { insertLegalDocumentVersion, noticeDescribesFeedbackForms, noticeDescribesFeedbackFormsNamed } from "@/modules/legal-documents/repository";
import { privacyNoticeEn, privacyNoticeRo } from "@/modules/legal-documents/templates/privacy-notice";
import { sendParticipantMessage } from "@/modules/notifications/participant-messages";
import { renderOutboxMessage } from "@/modules/notifications/render";
import { RATE_LIMITS } from "@/modules/rate-limit/service";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";
import { deliverRelay, fakeRoads, relayRows, sent } from "../../helpers/relay";

/**
 * BR-REQ-070-04, BR-REQ-080-01, `DECISIONS.md` §676 — «Spune-ne ceva»: each branch by its own road
 * and nothing kept anywhere; the gates in the contact form's order; one bucket per branch; the
 * setting's validation, role and audit; the notice that opens the door; and the two emails that
 * carry the form's link. Every address is made up, on `example.org`.
 */
const NOW = new Date("2026-10-08T12:00:00.000Z");
const RENDERED = new Date(NOW.getTime() - 60_000).toISOString();

const SETTINGS: FeedbackSettings = {
  howItWent: { on: true, to: "how@example.org", via: "gmail" },
  suggestion: { on: true, to: "ideas@example.org", via: "gmail" },
  complaint: { on: true, to: "complaints@example.org", via: "gmail" },
  safety: { on: true, to: "safety@example.org", via: "mailgun", name: "Maria", fallbackToGmail: false },
};

/** A deployment where Mailgun does not transmit: a form with no saved road is on the club's Gmail, as before §782. */
const NO_MAILGUN = { gmail: true, mailgun: false };
/** A deployment with both roads: a form with no saved road is on Mailgun, the recommended one (§782). */
const BOTH_ROADS = { gmail: true, mailgun: true };

type CapturedSmtp = {
  from: { name: string; address: string };
  to: string[];
  cc?: string[];
  bcc?: string[];
  replyTo?: { name: string; address: string };
  subject: string;
  text: string;
  html: string;
};

const UNSCREENED: ContactScreening = { botCheckOn: false, tokenPresent: false, turnstileVerdict: "not_configured", clubHost: null };

describe("§676 «Spune-ne ceva»", () => {
  let db: TestDatabase;
  let close: () => Promise<void>;
  let admin: StaffUser;
  let organizer: StaffUser;
  /** What the club's Gmail was handed, as the contact form's own transport once recorded it. */
  let smtp: { messages: CapturedSmtp[] };
  let mailgun: { send: ReturnType<typeof vi.fn<(message: OutgoingEmail) => Promise<SendResult>>> };
  /** Which roads this deployment has, and what answers on Mailgun's: what a test says through `deps`, read when the relay sends. */
  let legacy: { gmail: boolean; mailgun: { send: (message: OutgoingEmail) => Promise<SendResult> } | null };

  beforeAll(async () => {
    ({ db, close } = await createTestDatabase());
  });
  afterAll(async () => close());
  afterEach(() => vi.restoreAllMocks());
  beforeEach(async () => {
    await resetTables(db);
    forgetFeedbackLinkMemo(db);
    [admin] = await db.insert(staffUsers).values({ email: "admin@dev.test", displayName: "Admin", role: "ADMIN" }).returning();
    [organizer] = await db.insert(staffUsers).values({ email: "org@dev.test", displayName: "Org", role: "MODERATOR" }).returning();
    smtp = { messages: [] };
    mailgun = { send: vi.fn(async () => ({ outcome: "sent", providerMessageId: "mailgun:1" }) as SendResult) };
    legacy = { gmail: true, mailgun };
  });

  /*
    §778: «Spune-ne ceva» queues its message and the relay carries it. These tests read what a road was handed, so the
    two roads are the two fakes they always had — Gmail records what it was handed, Mailgun is `mailgun.send` — and every
    submit is followed by one pass of the relay, the way the after-response drain follows it in production.
  */
  const submitFeedback: typeof queueFeedback = async (...args) => {
    const outcome = await queueFeedback(...args);
    const roads = fakeRoads({
      available: { gmail: legacy.gmail, mailgun: legacy.mailgun !== null },
      gmail: (message) => {
        smtp.messages.push({
          from: { name: "Club", address: "club@example.org" },
          to: [message.to, ...(message.cc ?? [])],
          ...(message.cc ? { cc: [...message.cc] } : {}),
          ...(message.bcc ? { bcc: [...message.bcc] } : {}),
          ...(message.replyTo ? { replyTo: { name: message.replyToName ?? message.replyTo, address: message.replyTo } } : {}),
          subject: message.subject,
          text: message.text,
          html: message.html,
        });
        return sent("gmail");
      },
      mailgun: (message) => (legacy.mailgun as { send: (m: OutgoingEmail) => Promise<SendResult> }).send(message),
    });
    await deliverRelay(db, roads, new Date(NOW.getTime() + 1_000));
    return outcome;
  };

  /** A road a test takes away is `null`, as it was when the deployment lacked it. */
  type Legacy = Omit<Partial<FeedbackDeps>, "roads"> & { smtp?: null; mailgun?: { send: (message: OutgoingEmail) => Promise<SendResult> } | null };
  const deps = (overrides: Legacy = {}): FeedbackDeps => {
    const { smtp: gmailRoad, mailgun: mailgunRoad, ...rest } = overrides;
    legacy = { gmail: gmailRoad !== null, mailgun: mailgunRoad === undefined ? mailgun : mailgunRoad };
    return {
      settings: SETTINGS,
      noticeDescribes: true,
      safetyGmailDescribed: true,
      namedDescribed: true,
      clubFallback: ["contact@example.org"],
      roads: { gmail: legacy.gmail, mailgun: legacy.mailgun !== null },
      appEnv: "production",
      screening: UNSCREENED,
      eventTitle: async (slug) => (slug === "crosul" ? "Crosul de toamnă" : null),
      ...rest,
    };
  };

  const post = (fields: Record<string, unknown>) => ({ locale: "ro", renderedAt: RENDERED, ...fields });
  const HOW = post({ branch: "howItWent", event: "crosul", date: "2026-10-04", rating: "5", message: "Foarte frumos.", reasons: [], reasonOther: "", email: "" });
  const SUGGESTION = post({ branch: "suggestion", identity: "named", name: "Ana Pop", message: "Alergări seara.", email: "ana@example.org" });
  const COMPLAINT = post({ branch: "complaint", message: "Nimeni la start.", event: "", date: "", email: "" });
  const SAFETY = post({ branch: "safety", message: "Cineva m-a urmărit.", whereWhen: "Parcul, joi", contact: "" });

  describe("each branch by its road, and nothing kept", () => {
    it("sends the three ordinary branches through the SMTP road, each to its own address, never through Mailgun", async () => {
      expect(await submitFeedback(db, deps(), HOW, NOW)).toEqual({ outcome: "sent" });
      expect(await submitFeedback(db, deps(), SUGGESTION, NOW)).toEqual({ outcome: "sent" });
      expect(await submitFeedback(db, deps(), COMPLAINT, NOW)).toEqual({ outcome: "sent" });
      expect(mailgun.send).not.toHaveBeenCalled();
      expect(smtp.messages.map((message) => message.to)).toEqual([["how@example.org"], ["ideas@example.org"], ["complaints@example.org"]]);
      expect(smtp.messages.map((message) => message.subject)).toEqual(["Cum a fost: Crosul de toamnă", "O sugestie de pe site", "O reclamație de pe site"]);
      // Reply-To only when an address was typed; the anonymity line otherwise.
      expect(smtp.messages[0].replyTo).toBeUndefined();
      expect(smtp.messages[0].text).toContain(`Contact: ${NO_CONTACT_LINE}`);
      // The named mode (§678): the name is the Reply-To's name and the email's first line.
      expect(smtp.messages[1].replyTo).toEqual({ name: "Ana Pop", address: "ana@example.org" });
      expect(smtp.messages[1].text.split("\n")[0]).toBe("Nume: Ana Pop");
      expect(smtp.messages[0].text.split("\n")[0]).toBe("Nume: (anonim)");
      for (const message of smtp.messages) {
        expect(message.cc).toBeUndefined();
        expect(message.bcc).toBeUndefined();
      }
    });

    it("drops the name and the way back the anonymous mode hid: no Reply-To, «(anonim)», «(fără contact lăsat)» (§678)", async () => {
      const anonymous = { ...SUGGESTION, identity: "anonymous" };
      expect(await submitFeedback(db, deps(), anonymous, NOW)).toEqual({ outcome: "sent" });
      expect(await submitFeedback(db, deps(), { ...SAFETY, name: "Ana Pop", contact: "0700 000 000" }, NOW)).toEqual({ outcome: "sent" });
      expect(smtp.messages[0].replyTo).toBeUndefined();
      expect(smtp.messages[0].text).not.toContain("Ana");
      expect(smtp.messages[0].text).toContain(`Contact: ${NO_CONTACT_LINE}`);
      const [safety] = mailgun.send.mock.calls[0];
      expect(safety.text).not.toContain("Ana");
      expect(safety.text).not.toContain("0700");
      expect(safety.text.split("\n")[0]).toBe("Nume: (anonim)");
      // The named mode with no name is refused on the box.
      await expect(submitFeedback(db, deps(), { ...SUGGESTION, name: "" }, NOW)).rejects.toMatchObject({ code: "VALIDATION_ERROR", fields: ["name"] });
    });

    it("sends the safety branch by Mailgun alone: the neutral subject, no Reply-To, never the SMTP road", async () => {
      expect(await submitFeedback(db, deps(), SAFETY, NOW)).toEqual({ outcome: "sent" });
      expect(smtp.messages).toHaveLength(0);
      expect(mailgun.send).toHaveBeenCalledTimes(1);
      const [message] = mailgun.send.mock.calls[0];
      expect(message.to).toBe("safety@example.org");
      expect(message.subject).toBe(SAFETY_SUBJECT);
      expect(message.noReplyTo).toBe(true);
      expect(message.cc).toBeUndefined();
      expect(message.bcc).toBeUndefined();
      expect(message.transport).toBeUndefined();
      expect(message.text).toContain("Unde și când: Parcul, joi");
      expect(message.text).toContain(`Contact: ${NO_CONTACT_LINE}`);
      expect(message.idempotencyKey).toMatch(/^relay:/);
    });

    it("keeps the words only until they are delivered — one outbox row each, on its road, the words gone — writes no audit row, and logs the branch, the reader and the outcome only", async () => {
      const logged = vi.spyOn(console, "info").mockImplementation(() => undefined);
      await submitFeedback(db, deps(), HOW, NOW);
      await submitFeedback(db, deps(), SAFETY, NOW);
      // The row is the record (§778): the form, the road chosen and the road it left by — and nothing a person wrote.
      const rows = await relayRows(db);
      expect(rows.map((row) => [row.messageType, row.status, row.road, row.transport]).sort((a, b) => String(a[2]).localeCompare(String(b[2])))).toEqual([
        ["FEEDBACK_MESSAGE", "SENT", "gmail", "gmail"],
        ["FEEDBACK_MESSAGE", "SENT", "mailgun", "mailgun"],
      ]);
      for (const row of rows) {
        expect(row).toMatchObject({ participantId: null, registrationId: null, payloadJson: { deleted: true } });
        expect(row.bodyDeletedAt).not.toBeNull();
      }
      expect(JSON.stringify(rows)).not.toContain("Foarte frumos");
      expect(JSON.stringify(rows)).not.toContain("Parcul");
      expect(await db.select().from(auditLogs)).toEqual([]);
      const lines = logged.mock.calls.map((call) => call.join(" "));
      // The reader as a word (§678), never an address or a name.
      expect(lines).toEqual(["[feedback] howItWent club: sent", "[feedback] safety person: sent"]);
      logged.mockRestore();
    });

    it("marks an ordinary branch «[posibil spam]» on the contact form's signals, and never the safety branch", async () => {
      const screening: ContactScreening = { botCheckOn: true, tokenPresent: false, turnstileVerdict: "unavailable", clubHost: null };
      expect(await submitFeedback(db, deps({ screening }), SUGGESTION, NOW)).toEqual({ outcome: "sent" });
      expect(smtp.messages[0].subject).toBe("[posibil spam] O sugestie de pe site");
      await submitFeedback(db, deps({ screening }), SAFETY, NOW);
      expect(mailgun.send.mock.calls[0][0].subject).toBe(SAFETY_SUBJECT);
    });

    it("puts [QA] in front of every subject on QA", async () => {
      await submitFeedback(db, deps({ appEnv: "qa" }), SUGGESTION, NOW);
      await submitFeedback(db, deps({ appEnv: "qa" }), SAFETY, NOW);
      expect(smtp.messages[0].subject).toBe("[QA] O sugestie de pe site");
      expect(mailgun.send.mock.calls[0][0].subject).toBe(`[QA] ${SAFETY_SUBJECT}`);
    });
  });

  describe("§678 who hears a named message, and the notice that allows a name", () => {
    it("sends a named «O reclamație» to the safety branch's person by Mailgun alone, with the neutral subject and the typed address as Reply-To", async () => {
      const toPerson = { ...COMPLAINT, identity: "named", name: "Ana Pop", audience: "person", email: "ana@example.org" };
      // The other reader than the branch's own: the outcome names her, for the sent page's line.
      expect(await submitFeedback(db, deps(), toPerson, NOW)).toEqual({ outcome: "sent", audience: "person" });
      expect(smtp.messages).toHaveLength(0);
      const [message] = mailgun.send.mock.calls[0];
      expect(message.to).toBe("safety@example.org");
      expect(message.subject).toBe(SAFETY_SUBJECT);
      // The address the person typed beside the name (§772): «Reply» reaches them, not the shared club mailbox.
      expect(message.replyTo).toBe("ana@example.org");
      expect(message.noReplyTo).toBeUndefined();
      expect(message.text.split("\n")[0]).toBe("Nume: Ana Pop");
      // Her inbox otherwise holds only her own form's: the line says which form it came from (§678).
      expect(message.text.split("\n")[1]).toBe("Din formularul: „O reclamație”");
      expect(message.html).toContain("<strong>Din formularul:</strong> „O reclamație”");
      expect(message.text).toContain("Contact: ana@example.org");
      expect(message.text).toContain("cine a scris a ales să afli doar tu");
    });

    it("sends a named «O sugestie» to the safety branch's person by Mailgun while her own form is switched off but she is configured", async () => {
      const safetyOff = { ...SETTINGS, safety: { on: false, to: "safety@example.org", via: "mailgun" as const, name: "Maria", fallbackToGmail: false } };
      const toPerson = { ...SUGGESTION, audience: "person" };
      expect(await submitFeedback(db, deps({ settings: safetyOff }), toPerson, NOW)).toEqual({ outcome: "sent", audience: "person" });
      expect(smtp.messages).toHaveLength(0);
      const [message] = mailgun.send.mock.calls[0];
      expect(message.to).toBe("safety@example.org");
      expect(message.subject).toBe(SAFETY_SUBJECT);
      expect(message.replyTo).toBe("ana@example.org");
      expect(message.text).toContain("Din formularul: „O sugestie”");
      // Her own form stays closed.
      expect(await submitFeedback(db, deps({ settings: safetyOff }), SAFETY, NOW)).toEqual({ outcome: "unavailable" });
      expect(mailgun.send).toHaveBeenCalledTimes(1);
    });

    it("sends a named «Cum a fost» to the club by default, by the SMTP road, with the name in Reply-To", async () => {
      expect(await submitFeedback(db, deps(), { ...HOW, identity: "named", name: "Ana Pop", email: "ana@example.org" }, NOW)).toEqual({ outcome: "sent" });
      expect(mailgun.send).not.toHaveBeenCalled();
      expect(smtp.messages[0].to).toEqual(["how@example.org"]);
      expect(smtp.messages[0].replyTo).toEqual({ name: "Ana Pop", address: "ana@example.org" });
    });

    it("sends a named safety report the sender gave the club to «O reclamație»'s mailbox by the SMTP road — neutral subject, no Reply-To — or else to the contact form's", async () => {
      const toClub = { ...SAFETY, identity: "named", name: "Ana Pop", audience: "club", contact: "0700 000 000" };
      expect(await submitFeedback(db, deps(), toClub, NOW)).toEqual({ outcome: "sent", audience: "club" });
      expect(mailgun.send).not.toHaveBeenCalled();
      expect(smtp.messages[0].to).toEqual(["complaints@example.org"]);
      expect(smtp.messages[0].subject).toBe(SAFETY_SUBJECT);
      expect(smtp.messages[0].replyTo).toBeUndefined();
      expect(smtp.messages[0].text).toContain("Contact: 0700 000 000");

      const noComplaint = { ...SETTINGS, complaint: { on: false, to: null, via: "gmail" as const } };
      expect(await submitFeedback(db, deps({ settings: noComplaint }), toClub, NOW)).toEqual({ outcome: "sent", audience: "club" });
      expect(smtp.messages[1].to).toEqual(["contact@example.org"]);
    });

    it("§772 Girl Zone's named mode has an email box of its own: the Reply-To, checked by the canonicalizer, kept nowhere; the telephone stays in the message", async () => {
      const named = { ...SAFETY, identity: "named", name: "Ana Pop", email: "Ana.Pop@Example.org ", contact: "0700 000 000" };
      expect(await submitFeedback(db, deps(), named, NOW)).toEqual({ outcome: "sent" });
      const [message] = mailgun.send.mock.calls[0];
      expect(message.replyTo).toBe("Ana.Pop@Example.org");
      expect(message.noReplyTo).toBeUndefined();
      expect(message.text).toContain("Contact: Ana.Pop@Example.org · 0700 000 000");
      // A telephone alone is no address: no Reply-To, the way back stays in the message.
      expect(await submitFeedback(db, deps(), { ...named, email: "" }, NOW)).toEqual({ outcome: "sent" });
      const [phoneOnly] = mailgun.send.mock.calls[1];
      expect(phoneOnly.noReplyTo).toBe(true);
      expect(phoneOnly.text).toContain("Contact: 0700 000 000");
      // What the canonicalizer refuses is refused on the box: a name in front of it, two addresses, a bare tag.
      for (const email of ["Ana <ana@example.org>", "a@example.org, b@example.org", "+tag@gmail.com", "ana@exam​ple.org"]) {
        await expect(submitFeedback(db, deps(), { ...named, email }, NOW)).rejects.toMatchObject({ code: "VALIDATION_ERROR", fields: ["email"] });
      }
      // Anonymous: the box is dropped, never sent.
      expect(await submitFeedback(db, deps(), { ...named, identity: "anonymous" }, NOW)).toEqual({ outcome: "sent" });
      expect(mailgun.send.mock.calls[2][0].text).not.toContain("example.org");
      // Nothing of it kept: no outbox row, no audit row.
      expect(await db.select().from(auditLogs)).toEqual([]);
    });

    it("§772 does not hand a confidential report's typed address to the club's spam screen: never marked for it", async () => {
      const screening: ContactScreening = { botCheckOn: false, tokenPresent: false, turnstileVerdict: "not_configured", clubHost: "club.example.org" };
      const toClub = { ...SAFETY, identity: "named", name: "Ana Pop", audience: "club", email: "ana@club-example.net" };
      expect(await submitFeedback(db, deps({ screening }), toClub, NOW)).toEqual({ outcome: "sent", audience: "club" });
      expect(smtp.messages[0].subject).not.toContain("posibil spam");
      // The same address on a complaint is the contact form's own signal (§310): marked.
      const complaint = { ...COMPLAINT, identity: "named", name: "Ana Pop", email: "ana@club-example.net" };
      expect(await submitFeedback(db, deps({ screening }), complaint, NOW)).toEqual({ outcome: "sent" });
      expect(smtp.messages[1].subject).toContain("posibil spam");
    });

    it("§772 sends Girl Zone's messages by Gmail only while the notice in force names {{feedbackSafetyGmail}}: by Mailgun otherwise, whatever the card says", async () => {
      const gmailForHer = { ...SETTINGS, safety: { ...SETTINGS.safety, via: "gmail" as const } };
      expect(await submitFeedback(db, deps({ settings: gmailForHer, safetyGmailDescribed: false }), SAFETY, NOW)).toEqual({ outcome: "sent" });
      expect(smtp.messages).toHaveLength(0);
      expect(mailgun.send).toHaveBeenCalledTimes(1);
      expect(await submitFeedback(db, deps({ settings: gmailForHer, safetyGmailDescribed: true }), SAFETY, NOW)).toEqual({ outcome: "sent" });
      expect(smtp.messages.map((message) => message.to)).toEqual([["safety@example.org"]]);
      expect(mailgun.send).toHaveBeenCalledTimes(1);
    });

    it("refuses a reader not offered on its box, and sends nothing", async () => {
      const noPerson = { ...SETTINGS, safety: { on: false, to: null, via: "mailgun" as const, name: null, fallbackToGmail: false } };
      const toPerson = { ...SUGGESTION, audience: "person" };
      await expect(submitFeedback(db, deps({ settings: noPerson }), toPerson, NOW)).rejects.toMatchObject({ code: "VALIDATION_ERROR", fields: ["audience"] });
      // No club on the safety form without the SMTP road and with no mailbox to fall back on.
      const toClub = { ...SAFETY, identity: "named", name: "Ana Pop", audience: "club" };
      await expect(submitFeedback(db, deps({ smtp: null }), toClub, NOW)).rejects.toMatchObject({ code: "VALIDATION_ERROR", fields: ["audience"] });
      expect(smtp.messages).toHaveLength(0);
      expect(mailgun.send).not.toHaveBeenCalled();
    });

    it("keeps an anonymous message on its branch's own reader, whatever reader it carried", async () => {
      expect(await submitFeedback(db, deps(), { ...SAFETY, identity: "anonymous", audience: "club" }, NOW)).toEqual({ outcome: "sent" });
      expect(await submitFeedback(db, deps(), { ...COMPLAINT, audience: "person" }, NOW)).toEqual({ outcome: "sent" });
      expect(mailgun.send.mock.calls.map(([message]) => message.to)).toEqual(["safety@example.org"]);
      expect(smtp.messages.map((message) => message.to)).toEqual([["complaints@example.org"]]);
    });

    it("reads every post as anonymous while the notice in force does not name {{feedbackFormsNamed}}: no name, no way back, no chosen reader", async () => {
      const named = { ...COMPLAINT, identity: "named", name: "Ana Pop", audience: "person", email: "ana@example.org" };
      expect(await submitFeedback(db, deps({ namedDescribed: false }), named, NOW)).toEqual({ outcome: "sent" });
      expect(mailgun.send).not.toHaveBeenCalled();
      expect(smtp.messages[0].to).toEqual(["complaints@example.org"]);
      expect(smtp.messages[0].replyTo).toBeUndefined();
      expect(smtp.messages[0].text).not.toContain("Ana");
      expect(smtp.messages[0].text.split("\n")[0]).toBe("Nume: (anonim)");
      // A named post with no name is not refused then: there is no named mode to refuse it in.
      expect(await submitFeedback(db, deps({ namedDescribed: false }), { ...named, name: "" }, NOW)).toEqual({ outcome: "sent" });
    });
  });

  describe("the gates", () => {
    it("answers a branch that is off, or a notice that does not describe the forms, with «unavailable» and sends nothing", async () => {
      expect(await submitFeedback(db, deps({ settings: { ...SETTINGS, suggestion: { on: false, to: "ideas@example.org", via: "gmail" } } }), SUGGESTION, NOW)).toEqual({ outcome: "unavailable" });
      expect(await submitFeedback(db, deps({ noticeDescribes: false }), HOW, NOW)).toEqual({ outcome: "unavailable" });
      expect(await submitFeedback(db, deps({ settings: DEFAULT_FEEDBACK_SETTINGS }), SAFETY, NOW)).toEqual({ outcome: "unavailable" });
      expect(smtp.messages).toHaveLength(0);
      expect(mailgun.send).not.toHaveBeenCalled();
    });

    it("refuses Cloudflare's `failed` as the check to redo, before anything else", async () => {
      const screening: ContactScreening = { botCheckOn: true, tokenPresent: true, turnstileVerdict: "failed", clubHost: null };
      expect(await submitFeedback(db, deps({ screening }), HOW, NOW)).toEqual({ outcome: "captcha" });
      expect(smtp.messages).toHaveLength(0);
    });

    it("names the boxes of a refused post", async () => {
      await expect(submitFeedback(db, deps(), { ...HOW, message: "", rating: "9" }, NOW)).rejects.toMatchObject({
        code: "VALIDATION_ERROR",
        fields: ["rating", "message"],
      });
    });

    it("answers the trap and the timing «sent» with nothing sent on an ordinary branch, and «unavailable» with the text kept on the safety branch", async () => {
      expect(await submitFeedback(db, deps(), { ...SUGGESTION, honeypot: "http://spam.example" }, NOW)).toEqual({ outcome: "ignored" });
      expect(await submitFeedback(db, deps(), { ...COMPLAINT, renderedAt: NOW.toISOString() }, NOW)).toEqual({ outcome: "ignored" });
      expect(await submitFeedback(db, deps(), { ...SAFETY, honeypot: "http://spam.example" }, NOW)).toEqual({ outcome: "unavailable" });
      expect(smtp.messages).toHaveLength(0);
      expect(mailgun.send).not.toHaveBeenCalled();
      // A password manager that filled the trap with the typed address is autofill, not a bot (§282).
      expect(await submitFeedback(db, deps(), { ...SUGGESTION, honeypot: "ana@example.org" }, NOW)).toEqual({ outcome: "sent" });
    });

    it("counts thirty an hour per branch, says the thirty-first plainly, and leaves the other branches open", async () => {
      expect(RATE_LIMITS.feedback.limit).toBe(30);
      for (let index = 0; index < 30; index += 1) expect(await submitFeedback(db, deps(), SUGGESTION, NOW)).toEqual({ outcome: "sent" });
      expect(await submitFeedback(db, deps(), SUGGESTION, NOW)).toMatchObject({ outcome: "limited" });
      expect(await submitFeedback(db, deps(), COMPLAINT, NOW)).toEqual({ outcome: "sent" });
    });

    /*
      §778: a refusing road is no longer a sentence on the page. The message is queued, the person is answered «trimis», and the
      relay — not the form — carries it: by the other road when the message may take it, waiting when it may not.
    */
    it("answers «sent» for a message its road refuses, and keeps Girl Zone's waiting for Mailgun: never by Gmail without the club's tick", async () => {
      mailgun.send.mockResolvedValue({ outcome: "transient_failure", error: "mailgun unreachable" });
      vi.spyOn(console, "info").mockImplementation(() => undefined);
      expect(await submitFeedback(db, deps(), SAFETY, NOW)).toEqual({ outcome: "sent" });
      expect(smtp.messages).toHaveLength(0);
      const [row] = await relayRows(db);
      expect(row).toMatchObject({ status: "PENDING", road: "mailgun", attemptCount: 1, lastError: "mailgun unreachable" });
      expect(row.payloadJson).toMatchObject({ fallbackAllowed: false });
      // The quarter-hour of retries that follow never reach Gmail: her message stays with Mailgun.
      const roads = fakeRoads({ mailgun: mailgun.send, gmail: () => sent("gmail") });
      for (const seconds of [10, 20, 3_600, 7_200]) await deliverRelay(db, roads, new Date(NOW.getTime() + seconds * 1000));
      expect(roads.by("gmail")).toHaveLength(0);
      expect((await relayRows(db))[0].status).toBe("PENDING");
    });

    it("lets Girl Zone's message leave by Gmail when Mailgun is down only with the club's tick and the notice that names it", async () => {
      mailgun.send.mockResolvedValue({ outcome: "transient_failure", error: "mailgun unreachable" });
      vi.spyOn(console, "info").mockImplementation(() => undefined);
      vi.spyOn(console, "warn").mockImplementation(() => undefined);
      const ticked = { ...SETTINGS, safety: { ...SETTINGS.safety, fallbackToGmail: true } };
      // The tick alone is not enough while the notice in force does not name Gmail for her messages.
      await submitFeedback(db, deps({ settings: ticked, safetyGmailDescribed: false }), SAFETY, NOW);
      expect((await relayRows(db))[0].payloadJson).toMatchObject({ fallbackAllowed: false });
      await resetTables(db);
      expect(await submitFeedback(db, deps({ settings: ticked, safetyGmailDescribed: true }), SAFETY, NOW)).toEqual({ outcome: "sent" });
      expect((await relayRows(db))[0].payloadJson).toMatchObject({ fallbackAllowed: true });
      const roads = fakeRoads({ mailgun: mailgun.send, gmail: () => sent("gmail") });
      await deliverRelay(db, roads, new Date(NOW.getTime() + 10_000));
      await deliverRelay(db, roads, new Date(NOW.getTime() + 20_000));
      expect(roads.by("gmail").map((message) => message.to)).toEqual(["safety@example.org"]);
      expect((await relayRows(db))[0]).toMatchObject({ status: "SENT", road: "mailgun", transport: "gmail" });
    });

        it("answers a deployment with no road «unavailable»; without the SMTP road the safety branch still leaves by Mailgun", async () => {
      // No SMTP road (`CONTACT_FORM_MODE=off`): the three ordinary branches are not offered at all.
      for (const branch of [HOW, SUGGESTION, COMPLAINT]) expect(await submitFeedback(db, deps({ smtp: null }), branch, NOW)).toEqual({ outcome: "unavailable" });
      expect(await submitFeedback(db, deps({ mailgun: null }), SAFETY, NOW)).toEqual({ outcome: "unavailable" });
      expect(await submitFeedback(db, deps({ smtp: null }), SAFETY, NOW)).toEqual({ outcome: "sent" });
      expect(smtp.messages).toHaveLength(0);
    });
  });

  describe("Mailgun's own request for the safety branch", () => {
    const originalFetch = globalThis.fetch;
    afterEach(() => {
      globalThis.fetch = originalFetch;
    });

    it("carries no Reply-To and tracking off, whatever the club's Reply-To", async () => {
      const forms: FormData[] = [];
      globalThis.fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
        forms.push(init?.body as FormData);
        return new Response(JSON.stringify({ id: "<1@example.org>" }), { status: 200 });
      }) as typeof fetch;
      const adapter = createMailgunAdapter({ apiKey: "key-not-real", domain: "mail.example.org", apiBaseUrl: "https://api.example.org/v3", from: "Club <noreply@example.org>", replyTo: "club@example.org" });
      await adapter.send({ to: "safety@example.org", subject: SAFETY_SUBJECT, text: "x", html: "<p>x</p>", locale: "ro", idempotencyKey: "feedback:1", noReplyTo: true });
      await adapter.send({ to: "ana@example.org", subject: "Altceva", text: "x", html: "<p>x</p>", locale: "ro", idempotencyKey: "other:1" });
      expect(forms[0].get("h:Reply-To")).toBeNull();
      expect(forms[0].get("o:tracking")).toBe("no");
      expect(forms[0].get("o:tracking-clicks")).toBe("no");
      expect(forms[0].get("o:tracking-opens")).toBe("no");
      // Every other message keeps the club's Reply-To.
      expect(forms[1].get("h:Reply-To")).toBe("club@example.org");
    });

    it("§772 answers a typed address in place of the club's: its own Reply-To, still tracking off; `noReplyTo` outranks it", async () => {
      const forms: FormData[] = [];
      globalThis.fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
        forms.push(init?.body as FormData);
        return new Response(JSON.stringify({ id: "<1@example.org>" }), { status: 200 });
      }) as typeof fetch;
      const adapter = createMailgunAdapter({ apiKey: "key-not-real", domain: "mail.example.org", apiBaseUrl: "https://api.example.org/v3", from: "Club <noreply@example.org>", replyTo: "club@example.org" });
      const base = { to: "safety@example.org", subject: SAFETY_SUBJECT, text: "x", html: "<p>x</p>", locale: "ro" as const, idempotencyKey: "feedback:2" };
      await adapter.send({ ...base, replyTo: "ana@example.org" });
      await adapter.send({ ...base, replyTo: "ana@example.org", noReplyTo: true });
      expect(forms[0].get("h:Reply-To")).toBe("ana@example.org");
      expect(forms[0].get("o:tracking")).toBe("no");
      expect(forms[1].get("h:Reply-To")).toBeNull();
    });
  });

  describe("§772 the road is the club's choice, per form", () => {
    const FORMS: ReadonlyArray<[FeedbackBranch, Record<string, unknown>, string, string]> = [
      ["howItWent", HOW, "how@example.org", "Cum a fost: Crosul de toamnă"],
      ["suggestion", SUGGESTION, "ideas@example.org", "O sugestie de pe site"],
      ["complaint", COMPLAINT, "complaints@example.org", "O reclamație de pe site"],
      ["safety", SAFETY, "safety@example.org", SAFETY_SUBJECT],
    ];
    const choosing = (branch: FeedbackBranch, via: FeedbackVia): FeedbackSettings => ({ ...SETTINGS, [branch]: { ...SETTINGS[branch], via } });

    it.each(FORMS)("%s leaves by Gmail when the club chose Gmail: the club's account, its address, nothing by Mailgun", async (branch, fields, to, subject) => {
      expect(await submitFeedback(db, deps({ settings: choosing(branch, "gmail") }), fields, NOW)).toEqual({ outcome: "sent" });
      expect(mailgun.send).not.toHaveBeenCalled();
      expect(smtp.messages).toHaveLength(1);
      expect(smtp.messages[0].from).toEqual({ name: "Club", address: "club@example.org" });
      expect(smtp.messages[0].to).toEqual([to]);
      expect(smtp.messages[0].subject).toBe(subject);
    });

    it.each(FORMS)("%s leaves by Mailgun when the club chose Mailgun: tracking off through the adapter, its address, nothing by Gmail", async (branch, fields, to, subject) => {
      expect(await submitFeedback(db, deps({ settings: choosing(branch, "mailgun") }), fields, NOW)).toEqual({ outcome: "sent" });
      expect(smtp.messages).toHaveLength(0);
      expect(mailgun.send).toHaveBeenCalledTimes(1);
      const [message] = mailgun.send.mock.calls[0];
      expect(message.to).toBe(to);
      expect(message.subject).toBe(subject);
      expect(message.idempotencyKey).toMatch(/^relay:/);
      expect(message.cc).toBeUndefined();
      expect(message.bcc).toBeUndefined();
    });

    it("keeps what §676 fixed in code with no choice made: the three by Gmail, Girl Zone by Mailgun", async () => {
      for (const [, fields] of FORMS) await submitFeedback(db, deps(), fields, NOW);
      expect(smtp.messages.map((message) => message.to)).toEqual([["how@example.org"], ["ideas@example.org"], ["complaints@example.org"]]);
      expect(mailgun.send.mock.calls.map(([message]) => message.to)).toEqual(["safety@example.org"]);
    });

    it("is no road at all where the deployment lacks the one chosen: «unavailable», nothing sent, and nothing fallen back to", async () => {
      expect(await submitFeedback(db, deps({ settings: choosing("suggestion", "mailgun"), mailgun: null }), SUGGESTION, NOW)).toEqual({ outcome: "unavailable" });
      expect(await submitFeedback(db, deps({ settings: choosing("safety", "gmail"), smtp: null }), SAFETY, NOW)).toEqual({ outcome: "unavailable" });
      expect(smtp.messages).toHaveLength(0);
      expect(mailgun.send).not.toHaveBeenCalled();
    });

    it("queues a message whichever road refuses it: the club's three forms are taken over by the other road, by default", async () => {
      vi.spyOn(console, "error").mockImplementation(() => undefined);
      vi.spyOn(console, "info").mockImplementation(() => undefined);
      vi.spyOn(console, "warn").mockImplementation(() => undefined);
      mailgun.send.mockResolvedValue({ outcome: "transient_failure", error: "mailgun unreachable" });
      expect(await submitFeedback(db, deps({ settings: choosing("complaint", "mailgun") }), COMPLAINT, NOW)).toEqual({ outcome: "sent" });
      expect(smtp.messages).toHaveLength(0);
      const roads = fakeRoads({ mailgun: mailgun.send, gmail: (message) => (smtp.messages.push({ from: { name: "Club", address: "club@example.org" }, to: [message.to], subject: message.subject, text: message.text, html: message.html }), sent("gmail")) });
      await deliverRelay(db, roads, new Date(NOW.getTime() + 10_000));
      await deliverRelay(db, roads, new Date(NOW.getTime() + 20_000));
      // The message, and the notice to the Administrator that Mailgun did not carry it (the working road carries both).
      expect(smtp.messages.map((message) => message.to)).toEqual([["complaints@example.org"], ["admin@dev.test"]]);
      // And the other way: Gmail refusing, Mailgun carrying.
      const gmailDown = fakeRoads({ gmail: { outcome: "transient_failure", error: "gmail: smtp EAUTH" }, mailgun: sent("mailgun") });
      mailgun.send.mockResolvedValue({ outcome: "sent", providerMessageId: "mailgun:9" });
      await queueFeedback(db, deps({ settings: choosing("suggestion", "gmail") }), SUGGESTION, NOW);
      for (const seconds of [1, 10, 20]) await deliverRelay(db, gmailDown, new Date(NOW.getTime() + 100_000 + seconds * 1000));
      expect(gmailDown.by("gmail")).toHaveLength(2);
      // Mailgun carried the message and, with it, the Administrator's notice that Gmail did not.
      expect(gmailDown.by("mailgun").map((message) => message.to)).toEqual(["ideas@example.org", "admin@dev.test"]);
    });

        it("screens a message for the club's mailbox the same way by either road: marked «[posibil spam]», or held back on the Administrator's tick", async () => {
      const screening: ContactScreening = { botCheckOn: true, tokenPresent: false, turnstileVerdict: "unavailable", clubHost: null };
      await submitFeedback(db, deps({ screening, settings: choosing("suggestion", "mailgun") }), SUGGESTION, NOW);
      expect(mailgun.send.mock.calls[0][0].subject).toBe("[posibil spam] O sugestie de pe site");
      expect(mailgun.send.mock.calls[0][0].text).toContain("---");
      // The tick (§744): counted, not sent, whichever road it would have taken.
      const held: ContactScreening = { ...screening, holdBack: true };
      expect(await submitFeedback(db, deps({ screening: held, settings: choosing("suggestion", "mailgun") }), SUGGESTION, NOW)).toEqual({ outcome: "sent" });
      expect(await submitFeedback(db, deps({ screening: held, settings: choosing("suggestion", "gmail") }), SUGGESTION, NOW)).toEqual({ outcome: "sent" });
      expect(mailgun.send).toHaveBeenCalledTimes(1);
      expect(smtp.messages).toHaveLength(0);
      // Girl Zone's person is never held back or marked, on Gmail either.
      await submitFeedback(db, deps({ screening: held, settings: choosing("safety", "gmail") }), SAFETY, NOW);
      expect(smtp.messages).toHaveLength(1);
      expect(smtp.messages[0].subject).toBe(SAFETY_SUBJECT);
    });

    it("sends a Girl Zone message the sender gave the club by the road of «O reclamație», the mailbox it reaches — not Girl Zone's own", async () => {
      const toClub = { ...SAFETY, identity: "named", name: "Ana Pop", audience: "club", contact: "0700 000 000" };
      const settings: FeedbackSettings = { ...SETTINGS, safety: { ...SETTINGS.safety, via: "gmail" }, complaint: { ...SETTINGS.complaint, via: "mailgun" } };
      expect(await submitFeedback(db, deps({ settings }), toClub, NOW)).toEqual({ outcome: "sent", audience: "club" });
      expect(smtp.messages).toHaveLength(0);
      expect(mailgun.send.mock.calls[0][0].to).toBe("complaints@example.org");
      // And a message for her goes by hers, whatever form it was written on.
      expect(await submitFeedback(db, deps({ settings }), { ...SUGGESTION, audience: "person" }, NOW)).toEqual({ outcome: "sent", audience: "person" });
      expect(smtp.messages.map((message) => message.to)).toEqual([["safety@example.org"]]);
      expect(smtp.messages[0].subject).toBe(SAFETY_SUBJECT);
    });

    it("refuses «Cine să afle?» the person where Girl Zone's road is missing, and the club where the club's is", async () => {
      const named = { ...SUGGESTION, identity: "named", name: "Ana Pop" };
      await expect(submitFeedback(db, deps({ mailgun: null }), { ...named, audience: "person" }, NOW)).rejects.toMatchObject({ code: "VALIDATION_ERROR", fields: ["audience"] });
      await expect(submitFeedback(db, deps({ settings: choosing("suggestion", "mailgun"), mailgun: null }), { ...named, audience: "person" }, NOW)).resolves.toEqual({ outcome: "unavailable" });
    });
  });

  describe("§772 the optional email beside the name: Reply-To on both roads, and nothing kept", () => {
    const NAMED = post({ branch: "suggestion", identity: "named", name: "Ana Pop", message: "Alergări seara.", email: "Ana.Pop@Example.org" });

    it("sets the typed address as Reply-To by Gmail, with the name beside it, as typed", async () => {
      expect(await submitFeedback(db, deps(), NAMED, NOW)).toEqual({ outcome: "sent" });
      expect(smtp.messages[0].replyTo).toEqual({ name: "Ana Pop", address: "Ana.Pop@Example.org" });
      expect(smtp.messages[0].text).toContain("Contact: Ana.Pop@Example.org");
    });

    it("sets it as Reply-To by Mailgun — a bare address, never the name — and not the club's", async () => {
      expect(await submitFeedback(db, deps({ settings: { ...SETTINGS, suggestion: { ...SETTINGS.suggestion, via: "mailgun" } } }), NAMED, NOW)).toEqual({ outcome: "sent" });
      const [message] = mailgun.send.mock.calls[0];
      expect(message.replyTo).toBe("Ana.Pop@Example.org");
      expect(message.noReplyTo).toBeUndefined();
      expect(message.text).toContain("Contact: Ana.Pop@Example.org");
    });

    it("sets none, anywhere, when none was typed or the mode is anonymous: no Reply-To on Gmail, none at all on Mailgun", async () => {
      const without = { ...NAMED, email: "" };
      const anonymous = { ...NAMED, identity: "anonymous" };
      const viaMailgun = { settings: { ...SETTINGS, suggestion: { ...SETTINGS.suggestion, via: "mailgun" as const } } };
      for (const fields of [without, anonymous]) {
        await submitFeedback(db, deps(), fields, NOW);
        await submitFeedback(db, deps(viaMailgun), fields, NOW);
      }
      for (const message of smtp.messages) expect(message.replyTo).toBeUndefined();
      for (const [message] of mailgun.send.mock.calls) {
        expect(message.replyTo).toBeUndefined();
        expect(message.noReplyTo).toBe(true);
      }
      expect(smtp.messages).toHaveLength(2);
      expect(mailgun.send).toHaveBeenCalledTimes(2);
    });

    it("refuses an address the canonicalizer refuses, on its box, and sends nothing", async () => {
      for (const bad of ["not an address", "ana@", "Ana <ana@example.org>", "ana@example.org, bob@example.org"]) {
        await expect(submitFeedback(db, deps(), { ...NAMED, email: bad }, NOW), bad).rejects.toMatchObject({ code: "VALIDATION_ERROR", fields: ["email"] });
      }
      expect(smtp.messages).toHaveLength(0);
      expect(mailgun.send).not.toHaveBeenCalled();
    });

    it("sets Girl Zone's way back as Reply-To when it is an address on either road, and none when it is a telephone", async () => {
      const byAddress = { ...SAFETY, identity: "named", name: "Ana Pop", contact: "ana@example.org" };
      const byPhone = { ...byAddress, contact: "0700 000 000" };
      await submitFeedback(db, deps(), byAddress, NOW);
      expect(mailgun.send.mock.calls[0][0].replyTo).toBe("ana@example.org");
      await submitFeedback(db, deps(), byPhone, NOW);
      expect(mailgun.send.mock.calls[1][0].replyTo).toBeUndefined();
      expect(mailgun.send.mock.calls[1][0].noReplyTo).toBe(true);
      const gmail = { ...SETTINGS, safety: { ...SETTINGS.safety, via: "gmail" as const } };
      await submitFeedback(db, deps({ settings: gmail }), byAddress, NOW);
      expect(smtp.messages[0].replyTo).toEqual({ name: "Ana Pop", address: "ana@example.org" });
    });

    it("is kept only until it is delivered: the outbox rows hold no address or name once sent, and no audit row, no bucket holds one at all", async () => {
      await submitFeedback(db, deps(), NAMED, NOW);
      await submitFeedback(db, deps({ settings: { ...SETTINGS, suggestion: { ...SETTINGS.suggestion, via: "mailgun" } } }), NAMED, NOW);
      const rows = await db.select().from(emailOutbox);
      expect(rows).toHaveLength(2);
      const kept = JSON.stringify(rows);
      expect(kept).not.toContain("Ana");
      expect(kept).not.toContain("ana@example.org");
      expect(rows.every((row) => row.status === "SENT" && row.bodyDeletedAt !== null)).toBe(true);
      expect(await db.select().from(auditLogs)).toEqual([]);
      const written = JSON.stringify([await db.select().from(rateLimitBuckets), await db.select().from(platformSettings)]);
      expect(written.toLowerCase()).not.toContain("example.org");
      expect(written).not.toContain("Ana");
      expect(FEEDBACK_BRANCHES).toHaveLength(4);
    });
  });

  describe("the setting", () => {
    it("is every branch off by default, then what the Administrator saved, audited without an address or a name", async () => {
      expect(await readFeedbackSettings(db, NO_MAILGUN)).toEqual({ ...DEFAULT_FEEDBACK_SETTINGS, updatedAt: null });
      await updateFeedbackSettings(db, admin, { ...SETTINGS, safety: { ...SETTINGS.safety, to: " safety@example.org " } }, NOW);
      expect(await readFeedbackSettings(db)).toEqual({ ...SETTINGS, updatedAt: NOW });

      // No road posted (a greyed radio is never posted): the road already saved stays.
      await updateFeedbackSettings(db, admin, { ...SETTINGS, suggestion: { on: false, to: "other@example.org" } }, NOW);
      const audits = await db.select().from(auditLogs).where(eq(auditLogs.action, "feedback_forms.changed"));
      expect(audits).toHaveLength(2);
      expect(audits[1].metadataJson).toEqual({ switched: [{ branch: "suggestion", on: false }], recipientChanged: ["suggestion"], safetyNameChanged: false, viaChanged: [], fallbackToGmail: null });
      const written = JSON.stringify(audits.map((row) => row.metadataJson));
      expect(written).not.toContain("@");
      expect(written).not.toContain("Maria");
    });

    it("refuses a branch on without a recipient, an address that is not one, and the safety branch without its name", async () => {
      await expect(updateFeedbackSettings(db, admin, { ...SETTINGS, howItWent: { on: true, to: "" } }, NOW)).rejects.toMatchObject({
        code: "VALIDATION_ERROR",
        fields: ["howItWentTo"],
      });
      await expect(updateFeedbackSettings(db, admin, { ...SETTINGS, complaint: { on: false, to: "not an address" } }, NOW)).rejects.toMatchObject({
        code: "VALIDATION_ERROR",
        fields: ["complaintTo"],
      });
      await expect(updateFeedbackSettings(db, admin, { ...SETTINGS, safety: { on: true, to: "safety@example.org", name: "" } }, NOW)).rejects.toMatchObject({
        code: "VALIDATION_ERROR",
        fields: ["safetyName"],
      });
      expect(await db.select().from(platformSettings).where(eq(platformSettings.key, FEEDBACK_SETTING_KEY))).toEqual([]);
    });

    it("§772 defaults every form's road to what §676 fixed in code, and saves what the Administrator chose, audited as a word", async () => {
      const defaults = await readFeedbackSettings(db, NO_MAILGUN);
      expect(FEEDBACK_BRANCHES.map((branch) => defaults[branch].via)).toEqual(["gmail", "gmail", "gmail", "mailgun"]);
      const chosen = { ...SETTINGS, suggestion: { ...SETTINGS.suggestion, via: "mailgun" }, safety: { ...SETTINGS.safety, via: "gmail" } };
      const saved = await updateFeedbackSettings(db, admin, chosen, NOW);
      expect(saved.suggestion.via).toBe("mailgun");
      expect((await readFeedbackSettings(db)).safety.via).toBe("gmail");
      const [audit] = await db.select().from(auditLogs).where(eq(auditLogs.action, "feedback_forms.changed"));
      // Against the default of a deployment where Mailgun transmits (§782): the three forms saved on Gmail moved, the one saved on Mailgun did not.
      expect(audit.metadataJson).toMatchObject({ viaChanged: [{ branch: "howItWent", via: "gmail" }, { branch: "complaint", via: "gmail" }, { branch: "safety", via: "gmail" }] });
      expect(JSON.stringify(audit.metadataJson)).not.toContain("@");
    });

    it("§772 reads a row saved before the road was chosen as each form's default, never a guess", async () => {
      await db.insert(platformSettings).values({ key: FEEDBACK_SETTING_KEY, value: { howItWent: { on: true, to: "how@example.org" }, safety: { on: true, to: "safety@example.org", name: "Maria" } }, updatedAt: NOW });
      const read = await readFeedbackSettings(db, NO_MAILGUN);
      expect(read.howItWent).toEqual({ on: true, to: "how@example.org", via: "gmail" });
      expect(read.safety).toEqual({ on: true, to: "safety@example.org", via: "mailgun", name: "Maria", fallbackToGmail: false });
      // A word this code does not know is the default too.
      await db.update(platformSettings).set({ value: { suggestion: { on: false, to: null, via: "carrier-pigeon" } } }).where(eq(platformSettings.key, FEEDBACK_SETTING_KEY));
      expect((await readFeedbackSettings(db, NO_MAILGUN)).suggestion.via).toBe("gmail");
    });

    it("§782 defaults a form with no saved road to Mailgun where it transmits and to the club's Gmail where it does not; Girl Zone stays on Mailgun", async () => {
      const withMailgun = await readFeedbackSettings(db, BOTH_ROADS);
      expect(FEEDBACK_BRANCHES.map((branch) => withMailgun[branch].via)).toEqual(["mailgun", "mailgun", "mailgun", "mailgun"]);
      const without = await readFeedbackSettings(db, NO_MAILGUN);
      expect(FEEDBACK_BRANCHES.map((branch) => without[branch].via)).toEqual(["gmail", "gmail", "gmail", "mailgun"]);
      // The environment decides when no roads are passed: the test environment transmits through Mailgun's capture.
      expect((await readFeedbackSettings(db)).suggestion.via).toBe("mailgun");
    });

    it("§782 reads a row saved before the road was chosen as the default for this deployment, and never replaces a road that was saved", async () => {
      await db.insert(platformSettings).values({
        key: FEEDBACK_SETTING_KEY,
        value: {
          howItWent: { on: true, to: "how@example.org" },
          suggestion: { on: true, to: "ideas@example.org", via: "gmail" },
          complaint: { on: true, to: "complaints@example.org", via: "mailgun" },
        },
        updatedAt: NOW,
      });
      const withMailgun = await readFeedbackSettings(db, BOTH_ROADS);
      // No road saved: the recommended one. A saved Gmail stays Gmail, though Mailgun transmits; a saved Mailgun stays.
      expect(FEEDBACK_BRANCHES.map((branch) => withMailgun[branch].via)).toEqual(["mailgun", "gmail", "mailgun", "mailgun"]);
      const without = await readFeedbackSettings(db, NO_MAILGUN);
      // Where Mailgun does not transmit, what was saved still stands and the form with none is on Gmail.
      expect(FEEDBACK_BRANCHES.map((branch) => without[branch].via)).toEqual(["gmail", "gmail", "mailgun", "mailgun"]);
      // Saving the card writes what it shows: every road saved from then on, none replaced by a later default.
      await updateFeedbackSettings(db, admin, Object.fromEntries(FEEDBACK_BRANCHES.map((branch) => [branch, { ...SETTINGS[branch], via: withMailgun[branch].via }])), NOW, BOTH_ROADS);
      expect((await readFeedbackSettings(db, NO_MAILGUN)).howItWent.via).toBe("mailgun");
    });

    it("§772 keeps the road already saved when a save does not post one — a greyed radio is never posted", async () => {
      await updateFeedbackSettings(db, admin, { ...SETTINGS, howItWent: { ...SETTINGS.howItWent, via: "mailgun" } }, NOW);
      const unposted = Object.fromEntries(FEEDBACK_BRANCHES.map((branch) => [branch, { on: true, to: SETTINGS[branch].to, via: "", ...(branch === "safety" ? { name: "Maria" } : {}) }]));
      const saved = await updateFeedbackSettings(db, admin, unposted, NOW);
      expect(saved.howItWent.via).toBe("mailgun");
      expect(saved.safety.via).toBe("mailgun");
      expect(saved.suggestion.via).toBe("gmail");
    });

    it("§778 keeps Girl Zone's «dacă Mailgun pică, trimite prin Gmail» off by default, saves the tick as a word in the audit, and keeps it when a save does not post it", async () => {
      expect((await readFeedbackSettings(db)).safety.fallbackToGmail).toBe(false);
      const ticked = await updateFeedbackSettings(db, admin, { ...SETTINGS, safety: { ...SETTINGS.safety, fallbackToGmail: true } }, NOW);
      expect(ticked.safety.fallbackToGmail).toBe(true);
      const [audit] = await db.select().from(auditLogs).where(eq(auditLogs.action, "feedback_forms.changed"));
      expect(audit.metadataJson).toMatchObject({ fallbackToGmail: true });
      // A greyed box posts nothing: the tick already saved stays, never turned off by omission.
      const withoutTick = Object.fromEntries(Object.entries(SETTINGS.safety).filter(([key]) => key !== "fallbackToGmail"));
      const kept = await updateFeedbackSettings(db, admin, { ...SETTINGS, safety: withoutTick }, NOW);
      expect(kept.safety.fallbackToGmail).toBe(true);
      // Unticked and posted as unticked, it goes off — and the audit says so.
      const off = await updateFeedbackSettings(db, admin, { ...SETTINGS, safety: { ...SETTINGS.safety, fallbackToGmail: false } }, NOW);
      expect(off.safety.fallbackToGmail).toBe(false);
      // A row saved before the tick existed reads as off.
      await db.update(platformSettings).set({ value: { safety: { on: true, to: "safety@example.org", via: "mailgun", name: "Maria" } } }).where(eq(platformSettings.key, FEEDBACK_SETTING_KEY));
      expect((await readFeedbackSettings(db)).safety.fallbackToGmail).toBe(false);
    });

    it("§772 refuses to newly choose a road the deployment lacks, on the form's box, and saves nothing — but lets one stay where it already was", async () => {
      const gmailLess = { gmail: false, mailgun: true };
      const allMailgun = Object.fromEntries(FEEDBACK_BRANCHES.map((branch) => [branch, { ...SETTINGS[branch], via: "mailgun" }]));
      await updateFeedbackSettings(db, admin, allMailgun, NOW);
      // Back to Gmail where Gmail is not there: refused on the three boxes, and nothing moves.
      await expect(updateFeedbackSettings(db, admin, SETTINGS, NOW, gmailLess)).rejects.toMatchObject({ code: "VALIDATION_ERROR", fields: ["howItWentVia", "suggestionVia", "complaintVia"] });
      expect((await readFeedbackSettings(db)).howItWent.via).toBe("mailgun");
      // A road already saved may stay while it is missing: saving the card with it unchanged is not choosing it.
      await updateFeedbackSettings(db, admin, SETTINGS, NOW);
      await expect(updateFeedbackSettings(db, admin, SETTINGS, NOW, gmailLess)).resolves.toMatchObject({ howItWent: { via: "gmail" } });
      await expect(updateFeedbackSettings(db, admin, { ...SETTINGS, suggestion: { ...SETTINGS.suggestion, via: "carrier-pigeon" } }, NOW)).rejects.toMatchObject({ code: "VALIDATION_ERROR", fields: ["suggestionVia"] });
    });

    it("§772 refuses to newly choose Gmail for Girl Zone while the notice in force does not name {{feedbackSafetyGmail}}, on her box — but lets it stay, and lets the other forms choose it", async () => {
      const noNotice = { gmail: true, mailgun: true };
      const gmailForHer = { ...SETTINGS, safety: { ...SETTINGS.safety, via: "gmail" } };
      await expect(updateFeedbackSettings(db, admin, gmailForHer, NOW, noNotice, false)).rejects.toMatchObject({ code: "VALIDATION_ERROR", fields: ["safetyVia"] });
      expect((await readFeedbackSettings(db)).safety.via).toBe("mailgun");
      // The ordinary forms' Gmail is the club's mailbox the notice already names: no gate.
      const mailgunForOne = { ...SETTINGS, suggestion: { ...SETTINGS.suggestion, via: "mailgun" } };
      await expect(updateFeedbackSettings(db, admin, mailgunForOne, NOW, noNotice, false)).resolves.toMatchObject({ suggestion: { via: "mailgun" } });
      // Once the notice names it, the road can be chosen; a later save with the notice gone keeps it (not choosing it again).
      await updateFeedbackSettings(db, admin, gmailForHer, NOW, noNotice, true);
      await expect(updateFeedbackSettings(db, admin, gmailForHer, NOW, noNotice, false)).resolves.toMatchObject({ safety: { via: "gmail" } });
    });

    it("refuses anybody but the Administrator", async () => {
      await expect(updateFeedbackSettings(db, organizer, SETTINGS, NOW)).rejects.toMatchObject({ code: "FORBIDDEN" });
    });

    it("reads a stored value this code cannot read as that branch off", async () => {
      await db.insert(platformSettings).values({ key: FEEDBACK_SETTING_KEY, value: { howItWent: { on: "yes", to: 4 }, safety: 7 }, updatedAt: NOW });
      const read = await readFeedbackSettings(db, NO_MAILGUN);
      expect(read.howItWent).toEqual({ on: false, to: null, via: "gmail" });
      expect(read.safety).toEqual(DEFAULT_FEEDBACK_SETTINGS.safety);
    });
  });

  let version = 1;
  async function approveNotice(bodies: { ro: LegalDocumentBody; en: LegalDocumentBody }) {
    const translations = [
      { locale: "ro" as const, title: "Nota de confidențialitate", body: bodies.ro },
      { locale: "en" as const, title: "Privacy notice", body: bodies.en },
    ];
    const current = version++;
    await insertLegalDocumentVersion(db, {
      key: "PRIVACY_NOTICE",
      version: current,
      effectiveAt: new Date(NOW.getTime() - 3_600_000 + current * 60_000),
      isApproved: true,
      contentSha256: computeContentHash(translations),
      translations,
      now: NOW,
    });
  }
  const strip = (body: LegalDocumentBody) => JSON.parse(JSON.stringify(body).split("{{feedbackForms}}").join("formularele")) as LegalDocumentBody;

  describe("the notice that opens the door", () => {
    it("is false with no notice, false with one that does not name the marker, true with the platform's", async () => {
      expect(await noticeDescribesFeedbackForms(db, NOW)).toBe(false);
      await approveNotice({ ro: strip(privacyNoticeRo), en: strip(privacyNoticeEn) });
      expect(await noticeDescribesFeedbackForms(db, NOW)).toBe(false);
      await approveNotice({ ro: privacyNoticeRo, en: privacyNoticeEn });
      expect(await noticeDescribesFeedbackForms(db, NOW)).toBe(true);
    });

    it("§678 allows a name only while the notice in force also names {{feedbackFormsNamed}}, in every language", async () => {
      const unnamed = (body: LegalDocumentBody) => JSON.parse(JSON.stringify(body).split("{{feedbackFormsNamed}}").join("cu numele")) as LegalDocumentBody;
      expect(await noticeDescribesFeedbackFormsNamed(db, NOW)).toBe(false);
      await approveNotice({ ro: unnamed(privacyNoticeRo), en: unnamed(privacyNoticeEn) });
      expect(await noticeDescribesFeedbackForms(db, NOW)).toBe(true);
      expect(await noticeDescribesFeedbackFormsNamed(db, NOW)).toBe(false);
      await approveNotice({ ro: privacyNoticeRo, en: unnamed(privacyNoticeEn) });
      expect(await noticeDescribesFeedbackFormsNamed(db, NOW)).toBe(false);
      await approveNotice({ ro: privacyNoticeRo, en: privacyNoticeEn });
      expect(await noticeDescribesFeedbackFormsNamed(db, NOW)).toBe(true);
    });
  });

  describe("the emails that carry «Spune-ne cum a fost»", () => {
    async function seed({ membersOnly = false }: { membersOnly?: boolean } = {}) {
      const [event] = await db
        .insert(events)
        .values({
          membersOnly,
          type: "RACE",
          startsAt: new Date("2026-10-04T06:00:00Z"),
          timezone: "Europe/Bucharest",
          registrationMode: "INTERNAL",
          editorialStatus: "PUBLISHED",
          publishedAt: NOW,
          locationName: "Parcul Tractorul",
        })
        .returning();
      await db.insert(eventTranslations).values([
        { eventId: event.id, locale: "ro", slug: "alergarea-de-duminica", title: "Alergarea de duminică" },
        { eventId: event.id, locale: "en", slug: "sunday-run", title: "The Sunday run" },
      ]);
      const [person] = await db
        .insert(participants)
        .values({ deliveryEmail: "ana@example.org", normalizedEmail: "ana@example.org", canonicalEmail: "ana@example.org", canonicalizationVersion: 1, defaultName: "Ana" })
        .returning();
      const [registration] = await db
        .insert(registrations)
        .values({
          eventId: event.id,
          participantId: person.id,
          status: "CONFIRMED",
          locale: "ro",
          registeredName: "Ana Pop",
          displayName: "Ana P.",
          privacyNoticeVersion: 1,
          privacyAcknowledgedAt: NOW,
          resultsNameConsent: false,
          resultsConsentVersion: 1,
          confirmedAt: NOW,
          checkedInAt: NOW,
        })
        .returning();
      return { event, person, registration };
    }

    const thanksRow = (participantId: string, registrationId: string, payloadJson: Record<string, unknown> = {}) => ({
      id: "row",
      participantId,
      registrationId,
      messageType: "EVENT_THANKS" as const,
      locale: "ro" as const,
      recipientEmail: "ana@example.org",
      payloadJson,
      idempotencyKey: "t:thanks",
      requestedByStaffUserId: null,
      isManualResend: false,
      status: "PROCESSING" as const,
      attemptCount: 1,
      nextAttemptAt: null,
      lockedAt: NOW,
      providerMessageId: null,
      transport: null,
      recipientCount: null,
      deliveredAt: null,
      rejectedAt: null,
      rejectionCause: null,
      providerCode: null,
      providerDetail: null,
      laterDeliveredAt: null,
      resolvedAt: null,
      retriedAt: null,
      retriedVia: null,
      road: null,
      roadFailures: {},
      bodyDeletedAt: null,
      lastError: null,
      createdAt: NOW,
      sentAt: null,
    });

    async function openHowItWent() {
      await approveNotice({ ro: privacyNoticeRo, en: privacyNoticeEn });
      await updateFeedbackSettings(db, admin, SETTINGS, NOW);
      forgetFeedbackLinkMemo(db);
    }

    it("the thank-you: no form while «Cum a fost» is closed; its button, with the event and its day, once it is open", async () => {
      const { person, registration } = await seed();
      const closed = await renderOutboxMessage(thanksRow(person.id, registration.id), db, NOW);
      expect(closed.text).not.toContain("spune-ne");
      expect(closed.text).not.toContain("Spune-ne cum a fost");

      await openHowItWent();
      const open = await renderOutboxMessage(thanksRow(person.id, registration.id), db, new Date(NOW.getTime() + 1_000));
      expect(open.text).toContain("Spune-ne cum a fost: ");
      expect(open.text).toContain("/ro/contact/spune-ne?tip=cum-a-fost&eveniment=alergarea-de-duminica&data=2026-10-04");
      // One button for both halves, as every message's action is; each half says it in its own words.
      expect(open.text).toContain("E anonim și durează un minut.");
      expect(open.text).toContain("It is anonymous and takes a minute.");
      // The English half's button is the Romanian form (one action per message); its own language is a link under it.
      expect(open.text).toContain("Tell us how it was, in English: ");
      expect(open.text).toContain("/en/contact/tell-us?tip=cum-a-fost&eveniment=sunday-run&data=2026-10-04");
      expect(open.text).not.toContain("Spune-ne cum a fost, în română");
    });

    it("the thank-you with results: the results stay the button, the form a link under them", async () => {
      const { person, registration } = await seed();
      await openHowItWent();
      const message = await renderOutboxMessage(thanksRow(person.id, registration.id, { url: "https://photos.example.org/album" }), db, NOW);
      expect(message.text).toContain("Rezultate și poze: https://photos.example.org/album");
      expect(message.text).toContain("Spune-ne cum a fost: ");
      expect(message.text).toContain("tip=cum-a-fost");
    });

    it("the organizer's {feedbackLink}: the form while it is open, the contact page otherwise", async () => {
      const { event } = await seed();
      const words = {
        subject: { ro: "Cum a fost la {eventTitle}?", en: "How was {eventTitle}?" },
        body: { ro: "Spune-ne aici: {feedbackLink}", en: "Tell us here: {feedbackLink}" },
      };
      await sendParticipantMessage(db, organizer, { eventId: event.id, audience: "ALL_ACTIVE", sendId: "0b0d5c3e-4f5a-4c1e-9d2b-7a8e9f0a1b21", ...words }, NOW);
      const [row] = await db.select().from(emailOutbox).where(eq(emailOutbox.messageType, "ORGANIZER_MESSAGE"));
      const closed = await renderOutboxMessage({ ...row, status: "PROCESSING", attemptCount: 1, lockedAt: NOW }, db, NOW);
      expect(closed.text).toMatch(/Spune-ne aici: \S+\/ro\/contact(\s|$)/);
      expect(closed.text).toMatch(/Tell us here: \S+\/en\/contact(\s|$)/);

      await openHowItWent();
      const open = await renderOutboxMessage({ ...row, status: "PROCESSING", attemptCount: 1, lockedAt: NOW }, db, new Date(NOW.getTime() + 1_000));
      expect(open.text).toContain("Spune-ne aici: ");
      expect(open.text).toContain("/ro/contact/spune-ne?tip=cum-a-fost&eveniment=alergarea-de-duminica&data=2026-10-04");
      expect(open.text).toContain("/en/contact/tell-us?tip=cum-a-fost&eveniment=sunday-run&data=2026-10-04");
    });

    it("a members' event (§552): no form in the thank-you, and the organizer's {feedbackLink} is the contact page, never its slug", async () => {
      const { event, person, registration } = await seed({ membersOnly: true });
      await openHowItWent();
      const thanks = await renderOutboxMessage(thanksRow(person.id, registration.id), db, NOW);
      expect(thanks.text).not.toContain("Spune-ne cum a fost");
      expect(thanks.text).not.toContain("tip=cum-a-fost");
      expect(thanks.text).not.toContain("eveniment=");

      const words = {
        subject: { ro: "Cum a fost la {eventTitle}?", en: "How was {eventTitle}?" },
        body: { ro: "Spune-ne aici: {feedbackLink}", en: "Tell us here: {feedbackLink}" },
      };
      await sendParticipantMessage(db, organizer, { eventId: event.id, audience: "ALL_ACTIVE", sendId: "0b0d5c3e-4f5a-4c1e-9d2b-7a8e9f0a1b22", ...words }, NOW);
      const [row] = await db.select().from(emailOutbox).where(eq(emailOutbox.messageType, "ORGANIZER_MESSAGE"));
      const message = await renderOutboxMessage({ ...row, status: "PROCESSING", attemptCount: 1, lockedAt: NOW }, db, NOW);
      expect(message.text).toMatch(/Spune-ne aici: \S+\/ro\/contact(\s|$)/);
      expect(message.text).toMatch(/Tell us here: \S+\/en\/contact(\s|$)/);
      expect(message.text).not.toContain("tip=cum-a-fost");
    });
  });
});
