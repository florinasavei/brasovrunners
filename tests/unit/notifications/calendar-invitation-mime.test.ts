import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import MailComposer from "nodemailer/lib/mail-composer";
import type { OutgoingEmail } from "@/infrastructure/email/adapter";

/**
 * BR-REQ-080-01 (`DECISIONS.md` §672) — a calendar invitation leaves typed so a calendar app answers
 * it: a `text/calendar; charset=utf-8; method=REQUEST` alternative beside the text and the HTML, and
 * the same file as an `invite.ics` attachment — the shape Google Calendar's own invitations have.
 * Both roads: the Mailgun one composes the message whole and posts it to `messages.mime` (its form
 * API has no field for an alternative part); the Gmail one hands Nodemailer `icalEvent`. A message
 * without an invitation is posted to `messages` exactly as before.
 *
 * Nodemailer's SMTP transport is replaced by one that composes what it is handed with Nodemailer's own
 * `MailComposer` — the composer `sendMail` builds the message with — and keeps the bytes.
 */
const smtp = vi.hoisted(() => ({ sent: [] as Array<{ options: Record<string, unknown>; mime: string }> }));

vi.mock("nodemailer", async () => {
  const { default: Composer } = await import("nodemailer/lib/mail-composer");
  return {
    default: {
      createTransport: () => ({
        sendMail: async (options: Record<string, unknown>) => {
          const mime = (await new Composer(options).compile().build()).toString("utf8");
          smtp.sent.push({ options, mime });
          return { accepted: [options.to], rejected: [], messageId: "<gm-1>" };
        },
        close: () => undefined,
      }),
    },
  };
});

const { composeMime } = await import("@/infrastructure/email/calendar-mime");
const { createMailgunAdapter } = await import("@/infrastructure/email/mailgun-adapter");
const { createGmailAdapter } = await import("@/infrastructure/email/gmail-adapter");

const ICS = ["BEGIN:VCALENDAR", "VERSION:2.0", "METHOD:REQUEST", "BEGIN:VEVENT", "UID:1@example.test", "SEQUENCE:0", "END:VEVENT", "END:VCALENDAR", ""].join("\r\n");

const INVITATION: OutgoingEmail = {
  to: "ana@example.org",
  subject: "Înscrierea este confirmată",
  html: "<p>Confirmat</p>",
  text: "Confirmat",
  locale: "ro",
  idempotencyKey: "registration:1:confirmed",
  calendar: { method: "REQUEST", ics: ICS },
  attachments: [{ filename: "declaratie-semnata.pdf", contentType: "application/pdf", data: Buffer.from("%PDF-1.4 test") }],
};

/** The MIME's headers and parts, unfolded, for reading. */
const unfoldMime = (mime: string) => mime.replace(/\r\n[ \t]+/g, " ");

function assertInvitationShape(mime: string, method: "REQUEST" | "CANCEL") {
  const text = unfoldMime(mime);
  expect(text).toMatch(/Content-Type: multipart\/alternative;/);
  // The part calendar apps read the answer buttons from: the method in the content type.
  expect(text).toContain(`Content-Type: text/calendar; charset=utf-8; method=${method}`);
  // And the file once more, as the attachment clients that read only attachments open.
  expect(text).toMatch(/Content-Type: application\/ics; name=invite\.ics/);
  expect(text).toMatch(/Content-Disposition: attachment; filename=invite\.ics/);
}

const mailgun = () =>
  createMailgunAdapter({
    apiKey: "key-not-a-real-key",
    domain: "mail.example.test",
    apiBaseUrl: "https://api.example.test/v3",
    from: '"Brașov Runners" <noreply@mail.example.test>',
    replyTo: "contact@example.test",
    environment: "test",
  });

let calls: Array<{ url: string; init: RequestInit }>;
const originalFetch = globalThis.fetch;
beforeEach(() => {
  calls = [];
  smtp.sent.length = 0;
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    return new Response(JSON.stringify({ id: "<20261008.1@mail.example.test>", message: "Queued" }), { status: 200 });
  }) as typeof fetch;
});
afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("BR-REQ-080-01 the invitation's MIME (§672)", () => {
  it("composes the alternative, the invite.ics, the other attachments and the headers; a Bcc is envelope only", async () => {
    const { mime, recipients } = await composeMime(
      { ...INVITATION, cc: ["copie@example.org"], bcc: ["ascuns@example.org"] },
      { from: '"Brașov Runners" <noreply@mail.example.test>', replyTo: "contact@example.test" },
    );
    const text = unfoldMime(mime.toString("utf8"));
    assertInvitationShape(text, "REQUEST");
    expect(text).toMatch(/^From: .*noreply@mail\.example\.test/m);
    expect(text).toMatch(/^To: ana@example\.org/m);
    expect(text).toMatch(/^Cc: copie@example\.org/m);
    expect(text).toMatch(/^Reply-To: contact@example\.test/m);
    expect(text).not.toMatch(/^Bcc:/m);
    expect(text).toMatch(/Content-Type: application\/pdf; name=declaratie-semnata\.pdf/);
    expect(recipients).toEqual(["ana@example.org", "copie@example.org", "ascuns@example.org"]);
  });

  it("Mailgun: posts the composed message to messages.mime, every recipient in `to`, the options as before", async () => {
    const result = await mailgun().send({ ...INVITATION, bcc: ["ascuns@example.org"] });
    expect(result).toEqual({ outcome: "sent", providerMessageId: "20261008.1@mail.example.test" });
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("https://api.example.test/v3/mail.example.test/messages.mime");
    const form = calls[0].init.body as FormData;
    expect(form.getAll("to")).toEqual(["ana@example.org", "ascuns@example.org"]);
    // The From, the subject, the bodies, the Reply-To and the files are in the MIME, not the form.
    for (const field of ["from", "subject", "text", "html", "h:Reply-To", "attachment", "cc", "bcc"]) expect(form.has(field)).toBe(false);
    expect(form.get("o:tracking")).toBe("no");
    expect(form.get("o:tracking-clicks")).toBe("no");
    expect(form.get("o:tracking-opens")).toBe("no");
    expect(form.get("v:idempotency_key")).toBe("registration:1:confirmed");
    expect(form.getAll("o:tag")).toEqual(["locale:ro", "env:test"]);
    const file = form.get("message") as File;
    expect(file.name).toBe("message.mime");
    const mime = await file.text();
    assertInvitationShape(mime, "REQUEST");
    expect(unfoldMime(mime)).toMatch(/^Reply-To: contact@example\.test/m);
    expect(unfoldMime(mime)).not.toMatch(/^Bcc:/m);
  });

  it("Mailgun: a cancellation is typed method=CANCEL", async () => {
    await mailgun().send({ ...INVITATION, calendar: { method: "CANCEL", ics: ICS.replace("METHOD:REQUEST", "METHOD:CANCEL") }, attachments: undefined });
    assertInvitationShape(await (((calls[0].init.body as FormData).get("message") as File).text()), "CANCEL");
  });

  it("Mailgun: a message without an invitation goes to messages, as before", async () => {
    const plain: OutgoingEmail = { ...INVITATION, calendar: undefined };
    await mailgun().send(plain);
    expect(calls[0].url).toBe("https://api.example.test/v3/mail.example.test/messages");
    const form = calls[0].init.body as FormData;
    expect(form.get("to")).toBe("ana@example.org");
    expect(form.get("h:Reply-To")).toBe("contact@example.test");
    expect((form.get("attachment") as File).name).toBe("declaratie-semnata.pdf");
    expect(form.has("message")).toBe(false);
  });

  it("Gmail: hands Nodemailer the invitation as icalEvent, which composes the same method=REQUEST part", async () => {
    const adapter = createGmailAdapter({ host: "smtp.example.org", port: 465, user: "club@example.org", password: "app-password", from: { name: "Club", address: "club@example.org" } });
    const result = await adapter.send({ ...INVITATION, transport: "gmail" });
    expect(result).toMatchObject({ outcome: "sent", transport: "gmail" });
    expect(smtp.sent).toHaveLength(1);
    expect(smtp.sent[0].options.icalEvent).toEqual({ method: "REQUEST", content: ICS, filename: "invite.ics" });
    assertInvitationShape(smtp.sent[0].mime, "REQUEST");
    // The signed declaration rides beside it, as on the confirmation (§174).
    expect(unfoldMime(smtp.sent[0].mime)).toMatch(/Content-Type: application\/pdf; name=declaratie-semnata\.pdf/);
  });

  it("Gmail: no invitation, no calendar part", async () => {
    const adapter = createGmailAdapter({ host: "smtp.example.org", port: 465, user: "club@example.org", password: "app-password", from: { name: "Club", address: "club@example.org" } });
    const plain: OutgoingEmail = { ...INVITATION, calendar: undefined };
    await adapter.send({ ...plain, transport: "gmail" });
    expect(smtp.sent[0].options).not.toHaveProperty("icalEvent");
    expect(smtp.sent[0].mime).not.toContain("text/calendar");
  });

  it("is Nodemailer's own composer on both roads: the same options, the same calendar part", async () => {
    const direct = (await new MailComposer({ to: "a@example.org", text: "x", icalEvent: { method: "REQUEST", content: ICS, filename: "invite.ics" } }).compile().build()).toString("utf8");
    assertInvitationShape(direct, "REQUEST");
  });
});
