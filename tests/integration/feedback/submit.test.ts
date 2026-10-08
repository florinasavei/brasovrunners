import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { auditLogs } from "@/db/schema/audit-logs";
import { emailOutbox } from "@/db/schema/email-outbox";
import { eventTranslations, events } from "@/db/schema/events";
import { participants } from "@/db/schema/participants";
import { platformSettings } from "@/db/schema/platform-settings";
import { registrations } from "@/db/schema/registrations";
import { type StaffUser, staffUsers } from "@/db/schema/staff-users";
import type { OutgoingEmail, SendResult } from "@/infrastructure/email/adapter";
import { createMailgunAdapter } from "@/infrastructure/email/mailgun-adapter";
import { createCaptureSmtpTransport } from "@/infrastructure/email/smtp-adapter";
import type { ContactScreening } from "@/modules/contact/service";
import { DEFAULT_FEEDBACK_SETTINGS, type FeedbackSettings, NO_CONTACT_LINE, SAFETY_SUBJECT } from "@/modules/feedback/domain/branches";
import { forgetFeedbackLinkMemo } from "@/modules/feedback/links";
import { type FeedbackDeps, submitFeedback } from "@/modules/feedback/service";
import { FEEDBACK_SETTING_KEY, readFeedbackSettings, updateFeedbackSettings } from "@/modules/feedback/settings";
import { computeContentHash, type LegalDocumentBody } from "@/modules/legal-documents/domain/content-hash";
import { insertLegalDocumentVersion, noticeDescribesFeedbackForms } from "@/modules/legal-documents/repository";
import { privacyNoticeEn, privacyNoticeRo } from "@/modules/legal-documents/templates/privacy-notice";
import { sendParticipantMessage } from "@/modules/notifications/participant-messages";
import { renderOutboxMessage } from "@/modules/notifications/render";
import { RATE_LIMITS } from "@/modules/rate-limit/service";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";

/**
 * BR-REQ-070-04, BR-REQ-080-01, `DECISIONS.md` §NNN — «Spune-ne ceva»: each branch by its own road
 * and nothing kept anywhere; the gates in the contact form's order; one bucket per branch; the
 * setting's validation, role and audit; the notice that opens the door; and the two emails that
 * carry the form's link. Every address is made up, on `example.org`.
 */
const NOW = new Date("2026-10-08T12:00:00.000Z");
const RENDERED = new Date(NOW.getTime() - 60_000).toISOString();

const SETTINGS: FeedbackSettings = {
  howItWent: { on: true, to: "how@example.org" },
  suggestion: { on: true, to: "ideas@example.org" },
  complaint: { on: true, to: "complaints@example.org" },
  safety: { on: true, to: "safety@example.org", name: "Maria" },
};

const UNSCREENED: ContactScreening = { botCheckOn: false, tokenPresent: false, turnstileVerdict: "not_configured", clubHost: null };

describe("§NNN «Spune-ne ceva»", () => {
  let db: TestDatabase;
  let close: () => Promise<void>;
  let admin: StaffUser;
  let organizer: StaffUser;
  let smtp: ReturnType<typeof createCaptureSmtpTransport>;
  let mailgun: { send: ReturnType<typeof vi.fn<(message: OutgoingEmail) => Promise<SendResult>>> };

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
    smtp = createCaptureSmtpTransport();
    mailgun = { send: vi.fn(async () => ({ outcome: "sent", providerMessageId: "mailgun:1" }) as SendResult) };
  });

  const deps = (overrides: Partial<FeedbackDeps> = {}): FeedbackDeps => ({
    settings: SETTINGS,
    noticeDescribes: true,
    smtp: { transport: smtp, from: { name: "Club", address: "club@example.org" }, appEnv: "production" },
    mailgun,
    appEnv: "production",
    screening: UNSCREENED,
    eventTitle: async (slug) => (slug === "crosul" ? "Crosul de toamnă" : null),
    ...overrides,
  });

  const post = (fields: Record<string, unknown>) => ({ locale: "ro", renderedAt: RENDERED, ...fields });
  const HOW = post({ branch: "howItWent", event: "crosul", date: "2026-10-04", rating: "5", message: "Foarte frumos.", reasons: [], reasonOther: "", email: "" });
  const SUGGESTION = post({ branch: "suggestion", message: "Alergări seara.", email: "ana@example.org" });
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
      expect(smtp.messages[1].replyTo).toEqual({ name: "ana@example.org", address: "ana@example.org" });
      for (const message of smtp.messages) {
        expect(message.cc).toBeUndefined();
        expect(message.bcc).toBeUndefined();
      }
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
      expect(message.idempotencyKey).toMatch(/^feedback:/);
    });

    it("writes no outbox row and no audit row, and logs the branch and the outcome only", async () => {
      const logged = vi.spyOn(console, "info").mockImplementation(() => undefined);
      await submitFeedback(db, deps(), HOW, NOW);
      await submitFeedback(db, deps(), SAFETY, NOW);
      expect(await db.select().from(emailOutbox)).toEqual([]);
      expect(await db.select().from(auditLogs)).toEqual([]);
      const lines = logged.mock.calls.map((call) => call.join(" "));
      expect(lines).toEqual(["[feedback] howItWent: sent", "[feedback] safety: sent"]);
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

  describe("the gates", () => {
    it("answers a branch that is off, or a notice that does not describe the forms, with «unavailable» and sends nothing", async () => {
      expect(await submitFeedback(db, deps({ settings: { ...SETTINGS, suggestion: { on: false, to: "ideas@example.org" } } }), SUGGESTION, NOW)).toEqual({ outcome: "unavailable" });
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

    it("answers Mailgun's refusal «unavailable», with no second road, and gives the attempt back", async () => {
      mailgun.send.mockResolvedValue({ outcome: "transient_failure", error: "mailgun unreachable" });
      vi.spyOn(console, "info").mockImplementation(() => undefined);
      for (let index = 0; index < 31; index += 1) expect(await submitFeedback(db, deps(), SAFETY, NOW)).toEqual({ outcome: "unavailable" });
      expect(smtp.messages).toHaveLength(0);
      // Every refused send was refunded: the bucket is not spent by sends that reached nobody.
      mailgun.send.mockResolvedValue({ outcome: "sent", providerMessageId: "mailgun:2" });
      expect(await submitFeedback(db, deps(), SAFETY, NOW)).toEqual({ outcome: "sent" });
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
  });

  describe("the setting", () => {
    it("is every branch off by default, then what the Administrator saved, audited without an address or a name", async () => {
      expect(await readFeedbackSettings(db)).toEqual({ ...DEFAULT_FEEDBACK_SETTINGS, updatedAt: null });
      await updateFeedbackSettings(db, admin, { ...SETTINGS, safety: { ...SETTINGS.safety, to: " safety@example.org " } }, NOW);
      expect(await readFeedbackSettings(db)).toEqual({ ...SETTINGS, updatedAt: NOW });

      await updateFeedbackSettings(db, admin, { ...SETTINGS, suggestion: { on: false, to: "other@example.org" } }, NOW);
      const audits = await db.select().from(auditLogs).where(eq(auditLogs.action, "feedback_forms.changed"));
      expect(audits).toHaveLength(2);
      expect(audits[1].metadataJson).toEqual({ switched: [{ branch: "suggestion", on: false }], recipientChanged: ["suggestion"], safetyNameChanged: false });
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

    it("refuses anybody but the Administrator", async () => {
      await expect(updateFeedbackSettings(db, organizer, SETTINGS, NOW)).rejects.toMatchObject({ code: "FORBIDDEN" });
    });

    it("reads a stored value this code cannot read as that branch off", async () => {
      await db.insert(platformSettings).values({ key: FEEDBACK_SETTING_KEY, value: { howItWent: { on: "yes", to: 4 }, safety: 7 }, updatedAt: NOW });
      const read = await readFeedbackSettings(db);
      expect(read.howItWent).toEqual({ on: false, to: null });
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
