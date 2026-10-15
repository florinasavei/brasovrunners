import { afterEach, describe, expect, it, vi } from "vitest";
import type { OutgoingEmail } from "@/infrastructure/email/adapter";
import { gmailFailureIsBeforeAcceptance, replyToOf } from "@/infrastructure/email/gmail-adapter";
import { createMailgunAdapter, requestNeverReachedMailgun } from "@/infrastructure/email/mailgun-adapter";

/**
 * §NNN — what the two adapters say about a failure, which the relay reads to decide whether the other road may
 * carry the message: «nothing was accepted» (a refused connection, a login, a 5xx) and «may have been accepted» (the
 * connection broke where the service might already have the message) are different answers, and only the first
 * lets a message change road.
 */
describe("§NNN the Gmail road: before or after acceptance", () => {
  it("a refused connection, login, DNS answer or TLS is before acceptance — nothing was taken", () => {
    for (const code of ["ECONNECTION", "EDNS", "ETLS", "EAUTH", "ENOAUTH", "EENVELOPE", "EMESSAGE"]) {
      expect(gmailFailureIsBeforeAcceptance({ code }), code).toBe(true);
    }
  });

  it("a timeout or a dropped socket is before acceptance while the SMTP command in progress is not the end of the message", () => {
    // The 2026-09-28 `ETIMEDOUT` on QA: the connection or the greeting never answered.
    expect(gmailFailureIsBeforeAcceptance({ code: "ETIMEDOUT", command: "CONN" })).toBe(true);
    expect(gmailFailureIsBeforeAcceptance({ code: "ETIMEDOUT", command: "EHLO" })).toBe(true);
    expect(gmailFailureIsBeforeAcceptance({ code: "ESOCKET", command: "AUTH PLAIN" })).toBe(true);
    expect(gmailFailureIsBeforeAcceptance({ code: "ECONNRESET", command: "RCPT TO" })).toBe(true);
  });

  it("and ambiguous once the message was on its way: during DATA, with no command named, or an error nobody knows", () => {
    expect(gmailFailureIsBeforeAcceptance({ code: "ETIMEDOUT", command: "DATA" })).toBe(false);
    expect(gmailFailureIsBeforeAcceptance({ code: "ETIMEDOUT", command: "data" })).toBe(false);
    expect(gmailFailureIsBeforeAcceptance({ code: "ETIMEDOUT" })).toBe(false);
    expect(gmailFailureIsBeforeAcceptance({ code: "ESOCKET" })).toBe(false);
    expect(gmailFailureIsBeforeAcceptance(new Error("boom"))).toBe(false);
    expect(gmailFailureIsBeforeAcceptance(null)).toBe(false);
  });
});

describe("§NNN the Gmail road's Reply-To", () => {
  it("is none at all for a confidential message, even where the club set one", () => {
    expect(replyToOf({ noReplyTo: true }, "club@example.org")).toEqual({});
    expect(replyToOf({ noReplyTo: true, replyTo: "ana@example.org" }, "club@example.org")).toEqual({});
  });

  it("is the address a visitor typed — with the name beside it when they typed one — and wins over the club's", () => {
    expect(replyToOf({ replyTo: "ana@example.org", replyToName: "Ana Pop" }, "club@example.org")).toEqual({ replyTo: { name: "Ana Pop", address: "ana@example.org" } });
    expect(replyToOf({ replyTo: "ana@example.org" }, "club@example.org")).toEqual({ replyTo: "ana@example.org" });
  });

  it("is the club's own, as it always was, for every other message", () => {
    expect(replyToOf({}, "club@example.org")).toEqual({ replyTo: "club@example.org" });
    expect(replyToOf({}, undefined)).toEqual({});
  });
});

describe("§NNN Mailgun: a request that never reached it, and one that may have", () => {
  const undiciError = (code: string) => Object.assign(new TypeError("fetch failed"), { cause: Object.assign(new Error(code), { code }) });

  it("never reached it: the name did not resolve, the connection was refused or never made", () => {
    for (const code of ["ENOTFOUND", "EAI_AGAIN", "ECONNREFUSED", "ENETUNREACH", "EHOSTUNREACH", "UND_ERR_CONNECT_TIMEOUT"]) {
      expect(requestNeverReachedMailgun(undiciError(code)), code).toBe(true);
    }
  });

  it("may have reached it: a total timeout, a reset, a socket that closed, or an error nobody knows", () => {
    expect(requestNeverReachedMailgun(new DOMException("signal timed out", "TimeoutError"))).toBe(false);
    expect(requestNeverReachedMailgun(undiciError("ECONNRESET"))).toBe(false);
    expect(requestNeverReachedMailgun(undiciError("UND_ERR_SOCKET"))).toBe(false);
    expect(requestNeverReachedMailgun(new Error("boom"))).toBe(false);
    expect(requestNeverReachedMailgun(undefined)).toBe(false);
  });

  describe("the adapter's answer", () => {
    afterEach(() => vi.unstubAllGlobals());
    const adapter = () => createMailgunAdapter({ apiKey: "key-test", domain: "mail.example.org", apiBaseUrl: "https://api.example.org/v3", from: "Club <noreply@mail.example.org>" });
    const message: OutgoingEmail = { to: "club@example.org", subject: "s", text: "t", html: "<p>t</p>", locale: "ro", idempotencyKey: "relay:1" };

    it("marks a timeout as possibly accepted, and a refused connection as certainly not", async () => {
      vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new DOMException("signal timed out", "TimeoutError")));
      expect(await adapter().send(message)).toEqual({ outcome: "transient_failure", error: "mailgun unreachable: TimeoutError", mayHaveBeenAccepted: true });
      vi.stubGlobal("fetch", vi.fn().mockRejectedValue(undiciError("ECONNREFUSED")));
      expect(await adapter().send(message)).toEqual({ outcome: "transient_failure", error: "mailgun unreachable: TypeError" });
    });

    it("a 5xx answer is a refusal Mailgun gave: nothing was accepted, so the message may change road", async () => {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("down", { status: 503 })));
      const result = await adapter().send(message);
      expect(result).toMatchObject({ outcome: "transient_failure" });
      expect(result).not.toHaveProperty("mayHaveBeenAccepted");
    });

    it("sends the Reply-To a visitor typed, and none at all for a confidential message", async () => {
      const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ id: "<abc@mail.example.org>" }), { status: 200 }));
      vi.stubGlobal("fetch", fetchMock);
      await adapter().send({ ...message, replyTo: "ana@example.org" });
      await adapter().send({ ...message, noReplyTo: true });
      const forms = fetchMock.mock.calls.map((call) => (call[1] as { body: FormData }).body);
      expect(forms[0].get("h:Reply-To")).toBe("ana@example.org");
      expect(forms[1].get("h:Reply-To")).toBeNull();
    });
  });
});
