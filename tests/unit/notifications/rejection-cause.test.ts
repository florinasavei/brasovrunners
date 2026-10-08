import { describe, expect, it } from "vitest";
import { emailMessageType } from "@/db/schema/email-outbox";
import { isAccountRefusalError } from "@/infrastructure/email/mailgun-adapter";
import { redactProviderText } from "@/infrastructure/email/redact";
import { isParticipantMessage } from "@/modules/notifications/domain/club-notices";
import {
  audienceOf,
  CLUB_MAILBOX_MESSAGE_TYPES,
  EMAIL_AUDIENCE,
  messageTypesFor,
  PARTICIPANT_MESSAGE_TYPES,
} from "@/modules/notifications/domain/email-audience";
import { enhancedStatusIn, enhancedStatusTextIn, rejectionCause } from "@/modules/notifications/domain/rejection-cause";

/**
 * BR-REQ-080-04, BR-REQ-038-01 (§NNN; amending §663, §76/§83, §320, §622) — the facts a refusal is stored
 * with: whom each message type is for (the participant's own mail is the only one a refusal of which says
 * anything about them), why a message was refused, by a stated precedence, and the one redactor every
 * provider word passes through before it is stored.
 */
describe("the audience map", () => {
  it("names an audience for every message type, and nothing else", () => {
    expect(Object.keys(EMAIL_AUDIENCE).sort()).toEqual([...emailMessageType.enumValues].sort());
    const all = (["participant", "club", "staff", "public"] as const).flatMap((audience) => messageTypesFor(audience));
    expect(all.sort()).toEqual([...emailMessageType.enumValues].sort());
  });

  it("keeps the club's own mailboxes' messages out of the participant's, though they carry the participant's id", () => {
    expect([...CLUB_MAILBOX_MESSAGE_TYPES].sort()).toEqual(["CLUB_CONFIRMATION_NOTICE", "DECLARATION_ARCHIVE", "GROUP_RUN_DECLARATION_ARCHIVE"]);
    for (const type of CLUB_MAILBOX_MESSAGE_TYPES) expect(PARTICIPANT_MESSAGE_TYPES).not.toContain(type);
    expect(PARTICIPANT_MESSAGE_TYPES).toContain("REGISTRATION_CONFIRMED");
    expect(PARTICIPANT_MESSAGE_TYPES).toContain("BIB_ASSIGNED");
  });

  it("is what «a participant's message» reads (§320): the copies, the privacy line and the refusals agree", () => {
    for (const type of emailMessageType.enumValues) expect(isParticipantMessage(type), type).toBe(audienceOf(type) === "participant");
    // The public's and the staff's are not a participant's either.
    for (const type of ["NEWSLETTER", "REGISTRATION_OPENED", "EVENT_INVITATION", "STAFF_INVITATION", "LEGAL_TEMPLATES_CHANGED"] as const) {
      expect(isParticipantMessage(type), type).toBe(false);
    }
  });
});

describe("rejectionCause — why, by a stated precedence", () => {
  const bounce = (facts: Partial<Parameters<typeof rejectionCause>[0]>) => rejectionCause({ status: "BOUNCED", sent: true, reason: "bounce", ...facts });

  it("a complaint is the person's own word, whatever else the row says", () => {
    expect(rejectionCause({ status: "COMPLAINED", sent: true, reason: "suppress-bounce", code: "550 5.1.1" })).toBe("complained");
  });

  it("reads Mailgun's own suppressions by their reason and by their code", () => {
    expect(bounce({ reason: "suppress-bounce", code: "605" })).toBe("suppressed");
    expect(bounce({ reason: "generic", code: "605" })).toBe("suppressed");
    expect(bounce({ reason: "suppress-unsubscribe" })).toBe("unsubscribed");
    expect(bounce({ reason: null, code: "606" })).toBe("unsubscribed");
    expect(bounce({ reason: "suppress-complaint" })).toBe("complaint-suppressed");
    expect(bounce({ reason: null, code: "607" })).toBe("complaint-suppressed");
  });

  it("reads the enhanced status before the reason: a final «old» carrying the last deferral's 4.2.2 is a full mailbox", () => {
    expect(bounce({ code: "550 5.1.1", detail: "user unknown" })).toBe("no-such-address");
    expect(bounce({ reason: "old", code: "452 4.2.2", detail: "4.2.2 The email account that you tried to reach is over quota" })).toBe("mailbox-full");
    expect(bounce({ code: "552" })).toBe("mailbox-full");
    // A 552 whose enhanced status was found and decided nothing is not a full mailbox: the message's size is
    // the message's, so it reads on — a plain bounce is refused, a reason not recorded is other.
    expect(bounce({ code: "552 5.3.4", detail: "552 5.3.4 Message size exceeds fixed maximum message size" })).toBe("refused");
    expect(bounce({ reason: null, code: "552 5.3.4", detail: "552 5.3.4 Message size exceeds fixed maximum message size" })).toBe("other");
    expect(bounce({ reason: "espblock", code: "554 5.7.1" })).toBe("blocked");
    expect(bounce({ code: "550", detail: "5.7.1 Message rejected for policy reasons" })).toBe("blocked");
    expect(bounce({ code: "550 5.1.8" })).toBe("blocked");
  });

  it("reads Mailgun's reason when no code decides, then the server's words", () => {
    expect(bounce({ reason: "old" })).toBe("gave-up");
    expect(bounce({ reason: "greylisted" })).toBe("gave-up");
    expect(bounce({ reason: "espblock" })).toBe("blocked");
    expect(bounce({ reason: "blacklisted" })).toBe("blocked");
    expect(bounce({ code: "550", detail: "Requested action not taken: mailbox unavailable, no such user" })).toBe("no-such-address");
    expect(bounce({ code: "550", detail: "Mailbox is full" })).toBe("mailbox-full");
    expect(bounce({ code: "554", detail: "Message blocked due to spam content" })).toBe("blocked");
    expect(bounce({ code: "550 5.4.1", detail: "Recipient address rejected: Access denied" })).toBe("no-such-address");
  });

  it("never calls a bare «bounce» with no code «no such address»: refused, the cause not recorded", () => {
    expect(bounce({})).toBe("refused");
    expect(bounce({ reason: "hardfail" })).toBe("no-such-address");
    expect(bounce({ reason: "generic" })).toBe("other");
    expect(bounce({ reason: null })).toBe("other");
  });

  it("lets a class-4 code decide only a full mailbox: a deferral is no block and no missing address", () => {
    expect(bounce({ reason: "old", code: "421 4.7.0", detail: "4.7.0 [TSS04] Messages from <ip> temporarily deferred due to unexpected volume or user complaints" })).toBe("gave-up");
    expect(bounce({ reason: "old", code: "451 4.1.1" })).toBe("gave-up");
    expect(bounce({ reason: "old", code: "452 4.2.2" })).toBe("mailbox-full");
    expect(bounce({ reason: "bounce", code: "550 5.7.1" })).toBe("blocked");
  });

  /*
    The receiving servers' own words (Yahoo's, Microsoft's, Gmail's, Mailgun's), as the webhook hands them
    to `rejectionCause`: the code it built from `delivery-status` (`mailgun-event.ts`) and the server's
    sentence. The owner's case was a yahoo.com address.
  */
  const REAL: Array<[string, Parameters<typeof rejectionCause>[0], string]> = [
    [
      "Yahoo 421 4.7.0 [TSS04], given up",
      { status: "BOUNCED", sent: true, reason: "old", code: "421 4.7.0", detail: "421 4.7.0 [TSS04] Messages from 192.0.2.1 temporarily deferred due to unexpected volume or user complaints - 4.16.55.1" },
      "gave-up",
    ],
    [
      "Yahoo 554 5.7.9 policy",
      { status: "BOUNCED", sent: true, reason: "bounce", code: "554 5.7.9", detail: "554 5.7.9 Message not accepted for policy reasons. See https://senders.yahooinc.com/error-codes" },
      "blocked",
    ],
    [
      "Yahoo 553 5.7.1 [BL21]",
      { status: "BOUNCED", sent: true, reason: "espblock", code: "553 5.7.1", detail: "553 5.7.1 [BL21] Connections will not be accepted from 192.0.2.1, because the ip is in Spamhaus's list" },
      "blocked",
    ],
    [
      "Yahoo 553 5.7.2 [TSS09]",
      { status: "BOUNCED", sent: true, reason: "bounce", code: "553 5.7.2", detail: "553 5.7.2 [TSS09] All messages from 192.0.2.1 will be permanently deferred; Retrying will NOT succeed" },
      "blocked",
    ],
    [
      "Yahoo 552 5.2.2 full",
      { status: "BOUNCED", sent: true, reason: "bounce", code: "552 5.2.2", detail: "552 5.2.2 This message could not be delivered because the recipient's mailbox is full" },
      "mailbox-full",
    ],
    [
      "Yahoo 554 no such account",
      { status: "BOUNCED", sent: true, reason: "bounce", code: "554", detail: "554 delivery error: dd This user doesn't have a yahoo.com account (<address>) [0] - mta1234.mail.bf1.yahoo.com" },
      "no-such-address",
    ],
    [
      "Yahoo 554 mailbox disabled",
      { status: "BOUNCED", sent: true, reason: "bounce", code: "554", detail: "554 delivery error: dd Sorry your message to <address> cannot be delivered. This mailbox is disabled (554.30)" },
      "no-such-address",
    ],
    [
      "Yahoo 552 mailbox not found",
      { status: "BOUNCED", sent: true, reason: "bounce", code: "552", detail: "552 1 Requested mail action aborted, mailbox not found" },
      "no-such-address",
    ],
    [
      "Microsoft 550 5.5.0",
      { status: "BOUNCED", sent: true, reason: "bounce", code: "550 5.5.0", detail: "550 5.5.0 Requested action not taken: mailbox unavailable (S2017062302)" },
      "no-such-address",
    ],
    [
      "Microsoft 550 5.1.10",
      { status: "BOUNCED", sent: true, reason: "bounce", code: "550 5.1.10", detail: "550 5.1.10 RESOLVER.ADR.RecipientNotFound; Recipient not found by SMTP address lookup" },
      "no-such-address",
    ],
    [
      "Microsoft 550 5.7.1 S3150",
      {
        status: "BOUNCED",
        sent: true,
        reason: "bounce",
        code: "550 5.7.1",
        detail: "550 5.7.1 Unfortunately, messages from [192.0.2.1] weren't sent. Please contact your Internet service provider since part of their network is on our block list (S3150)",
      },
      "blocked",
    ],
    [
      "Microsoft 550 5.7.515",
      { status: "BOUNCED", sent: true, reason: "bounce", code: "550 5.7.515", detail: "550 5.7.515 Access denied, sending domain example.org does not meet the required authentication level" },
      "blocked",
    ],
    ["Gmail at the send", { status: "BOUNCED", sent: false, reason: "gmail: the address was refused (5.1.1)" }, "no-such-address"],
    ["Mailgun 605", { status: "BOUNCED", sent: true, reason: "suppress-bounce", code: "605", detail: "Not delivering to previously bounced address" }, "suppressed"],
    ["Mailgun 606", { status: "BOUNCED", sent: true, reason: "suppress-unsubscribe", code: "606", detail: "Not delivering to unsubscribed address" }, "unsubscribed"],
    ["Mailgun 607", { status: "BOUNCED", sent: true, reason: "suppress-complaint", code: "607", detail: "Not delivering to a user who marked your messages as spam" }, "complaint-suppressed"],
    ["the account's credentials, 2026-10-01", { status: "BOUNCED", sent: false, reason: "mailgun 401: Forbidden" }, "account"],
    [
      "the probation's pause, 2026-10-01",
      {
        status: "BOUNCED",
        sent: false,
        reason:
          "mailgun 400: Domain mail.example.org is not allowed to send: You are sending too fast. Your account is on probation and the account has been temporarily disabled.",
      },
      "account",
    ],
    ["the spent allowance, 2026-10-02", { status: "BOUNCED", sent: false, reason: "mailgun 400: Domain mail.example.org is not allowed to send: recipient limit exceeded" }, "account"],
  ];

  it.each(REAL)("reads %s", (_name, facts, expected) => {
    expect(rejectionCause(facts)).toBe(expected);
  });

  it("reads a Gmail refusal by its 5.1.x", () => {
    expect(rejectionCause({ status: "BOUNCED", sent: false, reason: "gmail: the address was refused (5.1.1)" })).toBe("no-such-address");
    expect(rejectionCause({ status: "BOUNCED", sent: false, reason: "gmail: rejected" })).toBe("other");
  });

  it("calls a refusal at the send the club's account unless it is the one 400 that names the address (§622)", () => {
    const atSend = (reason: string) => rejectionCause({ status: "BOUNCED", sent: false, reason });
    // The refusals Mailgun gave the account on 2026-10-01 and 02.
    expect(atSend("mailgun 401: Forbidden")).toBe("account");
    expect(atSend("mailgun 403: Domain mail.example.org is not allowed to send: domain disabled")).toBe("account");
    expect(atSend("mailgun 400: Domain mail.example.org is not allowed to send: recipient limit exceeded")).toBe("account");
    expect(
      atSend(
        "mailgun 400: Domain mail.example.org is not allowed to send: You are sending too fast. Your account is on probation and the account has been temporarily disabled.",
      ),
    ).toBe("account");
    expect(atSend("mailgun 429: Too Many Requests")).toBe("account");
    expect(atSend("mailgun 400: 'from' parameter is not a valid address. please check documentation")).toBe("account");
    // The address's own: a 400 that names it — with the redactor's placeholder taken out first.
    expect(atSend("mailgun 400: 'to' parameter is not a valid address. please check documentation")).toBe("no-such-address");
    expect(atSend("mailgun 400: <address> is not among the authorized recipients")).toBe("other");
    expect(isAccountRefusalError("mailgun 400: Sandbox subdomains are for test purposes only. Please add <address> to authorized recipients")).toBe(false);
    // A refusal that left is never the account's.
    expect(rejectionCause({ status: "BOUNCED", sent: true, reason: "mailgun 401: Forbidden" })).toBe("other");
    expect(isAccountRefusalError("bounce")).toBe(false);
    expect(isAccountRefusalError("gmail: the address was refused (5.1.1)")).toBe(false);
    expect(isAccountRefusalError(null)).toBe(false);
  });

  it("finds an enhanced status in a text — never three parts of a dotted quad", () => {
    expect(enhancedStatusIn("550 5.1.1 user unknown")).toEqual([5, 1, 1]);
    expect(enhancedStatusIn("452 4.2.2 over quota")).toEqual([4, 2, 2]);
    expect(enhancedStatusIn("refused (5.1.1).")).toEqual([5, 1, 1]);
    expect(enhancedStatusIn("no code here")).toBeNull();
    // An IP literal or a dotted reference is not a status: «10.5.1.20», Yahoo's «4.16.55.1».
    expect(enhancedStatusIn("Rejected by policy for 10.5.1.20")).toBeNull();
    expect(enhancedStatusIn("deferred - 4.16.55.1")).toBeNull();
    expect(enhancedStatusTextIn("550 [10.5.1.20] 5.7.1 blocked")).toBe("5.7.1");
    expect(enhancedStatusTextIn("v5.1.1")).toBeNull();
  });

  it("does not read a policy text that quotes an IP as a missing address", () => {
    expect(bounce({ code: "550", detail: "Rejected by local policy for 10.5.1.20" })).toBe("blocked");
    expect(bounce({ code: "550", detail: "Delivery not authorised from 10.5.1.20, message refused" })).toBe("blocked");
  });
});

describe("redactProviderText — one redactor for every provider word", () => {
  it("takes out every address, the recipient's local part quoted alone, an IP and a token-length run", () => {
    const text = "550 5.1.1 <ana.popescu@example.com>: Recipient ana.popescu does not exist here (mx 192.0.2.10, 2001:db8::1:2:3) ref AbCdEfGhIjKlMnOpQrStUvWxYz0123456789";
    const redacted = redactProviderText(text, { recipient: "ana.popescu@example.com" });
    expect(redacted).not.toContain("ana.popescu");
    expect(redacted).not.toContain("example.com");
    expect(redacted).not.toContain("192.0.2.10");
    expect(redacted).not.toContain("2001:db8");
    expect(redacted).not.toContain("AbCdEfGhIjKlMnOpQrStUvWxYz0123456789");
    expect(redacted).toContain("does not exist");
    expect(redacted).toContain("5.1.1");
  });

  it("keeps a clock time and a word that merely contains the local part", () => {
    expect(redactProviderText("deferred until 10:00:00", { recipient: "ana@example.com" })).toBe("deferred until 10:00:00");
    expect(redactProviderText("cannot deliver", { recipient: "can@example.com" })).toBe("cannot deliver");
  });

  it("redacts before it cuts, so no half address survives the cut", () => {
    const long = `${"x".repeat(190)} someone.long@example.org trailing`;
    const redacted = redactProviderText(long);
    expect(redacted.length).toBeLessThanOrEqual(200);
    expect(redacted).not.toMatch(/someone|@/);
  });

  it("removes a secret it is told about, and answers nothing for nothing", () => {
    expect(redactProviderText("key-123 refused", { secrets: ["key-123"] })).toBe("<redacted> refused");
    expect(redactProviderText(null)).toBe("");
  });
});
