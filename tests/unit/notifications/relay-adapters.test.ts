import { afterEach, describe, expect, it, vi } from "vitest";
import net from "node:net";
import nodemailer from "nodemailer";
import type { OutgoingEmail } from "@/infrastructure/email/adapter";
import { gmailFailureIsBeforeAcceptance, replyToOf } from "@/infrastructure/email/gmail-adapter";
import { createMailgunAdapter, requestNeverReachedMailgun } from "@/infrastructure/email/mailgun-adapter";

/**
 * §778 — what the two adapters say about a failure, which the relay reads to decide whether the other road may
 * carry the message: «nothing was accepted» (a refused connection, a login, a 5xx) and «may have been accepted» (the
 * connection broke where the service might already have the message) are different answers, and only the first
 * lets a message change road.
 */
describe("§778 the Gmail road: before or after acceptance", () => {
  it("a refused connection, login, DNS answer or TLS is before acceptance — nothing was taken", () => {
    for (const code of ["EDNS", "ETLS", "EAUTH", "ENOAUTH", "EENVELOPE", "EMESSAGE", "ECONNREFUSED", "ENOTFOUND"]) {
      expect(gmailFailureIsBeforeAcceptance({ code }), code).toBe(true);
    }
  });

  it("the shapes Nodemailer really gives, by message: the connect and greeting timeouts are before, «Timeout» and a close are not", () => {
    // Nodemailer 10 names the command `CONN` for every connection-level error, whatever the phase.
    expect(gmailFailureIsBeforeAcceptance({ code: "ETIMEDOUT", command: "CONN", message: "Connection timeout" })).toBe(true);
    expect(gmailFailureIsBeforeAcceptance({ code: "ETIMEDOUT", command: "CONN", message: "Greeting never received" })).toBe(true);
    expect(gmailFailureIsBeforeAcceptance({ code: "ESOCKET", command: "CONN", syscall: "connect", message: "connect ECONNREFUSED 127.0.0.1:465" })).toBe(true);
    expect(gmailFailureIsBeforeAcceptance({ code: "ETIMEDOUT", command: "CONN", message: "Timeout" })).toBe(false);
    expect(gmailFailureIsBeforeAcceptance({ code: "ESOCKET", command: "CONN", syscall: "read", message: "read ECONNRESET" })).toBe(false);
    expect(gmailFailureIsBeforeAcceptance({ code: "ECONNECTION", command: "CONN", message: "Connection closed unexpectedly" })).toBe(false);
    // The server closed it with an answer of its own: it said no.
    expect(gmailFailureIsBeforeAcceptance({ code: "ECONNECTION", command: "CONN", responseCode: 421, message: "Connection closed unexpectedly: 421 try later" })).toBe(true);
  });

  it("a failure that names a command ahead of DATA is before acceptance; DATA, or no command and no message, is not", () => {
    expect(gmailFailureIsBeforeAcceptance({ code: "EPROTOCOL", command: "EHLO" })).toBe(true);
    expect(gmailFailureIsBeforeAcceptance({ code: "ECONNECTION", command: "EHLO", message: "Server terminates connection" })).toBe(true);
    expect(gmailFailureIsBeforeAcceptance({ code: "ETIMEDOUT", command: "RCPT TO" })).toBe(true);
    expect(gmailFailureIsBeforeAcceptance({ code: "ETIMEDOUT", command: "DATA" })).toBe(false);
    expect(gmailFailureIsBeforeAcceptance({ code: "ETIMEDOUT" })).toBe(false);
    expect(gmailFailureIsBeforeAcceptance({ code: "ESOCKET" })).toBe(false);
    expect(gmailFailureIsBeforeAcceptance(new Error("boom"))).toBe(false);
    expect(gmailFailureIsBeforeAcceptance(null)).toBe(false);
  });
});

/**
 * The classifier against Nodemailer itself, over a fake SMTP server on the loopback: the shapes are not made up.
 * A server that takes the whole body and never answers `250`, and one that drops the socket after the body, are
 * the two ambiguous cases; a closed port and a server that never greets are not.
 */
describe("§778 the Gmail road against a real Nodemailer error", () => {
  type Behaviour = "never-answer" | "drop" | "silent";

  async function fakeSmtp(behaviour: Behaviour) {
    const sockets = new Set<net.Socket>();
    const server = net.createServer((socket) => {
      sockets.add(socket);
      socket.on("close", () => sockets.delete(socket));
      socket.on("error", () => {});
      if (behaviour === "silent") return;
      socket.write("220 fake ESMTP\r\n");
      let inData = false;
      let buffer = "";
      socket.on("data", (chunk) => {
        buffer += chunk.toString("latin1");
        if (inData) {
          if (!buffer.includes("\r\n.\r\n")) return;
          if (behaviour === "drop") socket.destroy();
          return; // never-answer: the body is in, Google's 250 never comes
        }
        let index = buffer.indexOf("\r\n");
        while (index >= 0 && !inData) {
          const line = buffer.slice(0, index);
          buffer = buffer.slice(index + 2);
          if (/^EHLO/i.test(line)) socket.write("250-fake\r\n250 8BITMIME\r\n");
          else if (/^(MAIL|RCPT)/i.test(line)) socket.write("250 ok\r\n");
          else if (/^DATA/i.test(line)) {
            socket.write("354 go\r\n");
            inData = true;
          }
          index = buffer.indexOf("\r\n");
        }
      });
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const port = (server.address() as net.AddressInfo).port;
    return {
      port,
      close: async () => {
        for (const socket of sockets) socket.destroy();
        await new Promise<void>((resolve) => server.close(() => resolve()));
      },
    };
  }

  async function failureOf(port: number, options: Record<string, unknown>, pooled: boolean) {
    const transport = nodemailer.createTransport({
      host: "127.0.0.1",
      port,
      secure: false,
      ignoreTLS: true,
      ...(pooled ? { pool: true, maxConnections: 1, maxRequeues: 0 } : {}),
      ...options,
    });
    try {
      await transport.sendMail({ from: "club@example.org", to: "ana@example.org", subject: "x", text: "body" });
      return null;
    } catch (error) {
      return error;
    } finally {
      transport.close();
    }
  }

  for (const pooled of [false, true]) {
    const label = pooled ? "pooled" : "single";

    it(`${label}: a timeout after the body was sent is ambiguous`, async () => {
      const server = await fakeSmtp("never-answer");
      try {
        const error = await failureOf(server.port, { socketTimeout: 400 }, pooled);
        expect(error).toMatchObject({ code: "ETIMEDOUT" });
        expect(gmailFailureIsBeforeAcceptance(error)).toBe(false);
      } finally {
        await server.close();
      }
    });

    it(`${label}: a socket dropped after the body was sent is ambiguous`, async () => {
      const server = await fakeSmtp("drop");
      try {
        const error = await failureOf(server.port, { socketTimeout: 2_000 }, pooled);
        expect(error).toMatchObject({ code: expect.stringMatching(/^(ECONNECTION|ESOCKET)$/) });
        expect(gmailFailureIsBeforeAcceptance(error)).toBe(false);
      } finally {
        await server.close();
      }
    });

    it(`${label}: a server that never greets is before acceptance`, async () => {
      const server = await fakeSmtp("silent");
      try {
        const error = await failureOf(server.port, { greetingTimeout: 300, connectionTimeout: 2_000 }, pooled);
        expect(error).toMatchObject({ code: "ETIMEDOUT" });
        expect(gmailFailureIsBeforeAcceptance(error)).toBe(true);
      } finally {
        await server.close();
      }
    });

    it(`${label}: a refused connection is before acceptance`, async () => {
      const server = await fakeSmtp("silent");
      const port = server.port;
      await server.close();
      const error = await failureOf(port, { connectionTimeout: 2_000 }, pooled);
      expect(error).toBeTruthy();
      expect(gmailFailureIsBeforeAcceptance(error)).toBe(true);
    });
  }
});

describe("§778 the Gmail road's Reply-To", () => {
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

describe("§778 Mailgun: a request that never reached it, and one that may have", () => {
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
