import { describe, expect, it } from "vitest";
import { QA_SUBJECT_PREFIX } from "@/infrastructure/email/delivery";
import { createCaptureSmtpTransport } from "@/infrastructure/email/smtp-adapter";
import { contactSubject, renderContactMessage } from "@/modules/contact/message";

/**
 * BR-REQ-070-04 criterion 3 — what the club receives: from its own address, to every mailbox
 * it named, "Reply" going to the visitor, the visitor's words quoted as typed.
 */
const ROUTE = {
  from: { name: "Brașov Runners", address: "club@example.com" },
  to: ["club@example.com", "colleague@example.org"],
  appEnv: "production" as const,
};

const INPUT = {
  name: "Ana Popescu",
  email: "ana@example.com",
  message: "Bună,\nla ce oră începe alergarea? <3",
  locale: "ro" as const,
  pageUrl: "http://localhost:47821/ro/contact",
};

describe("BR-REQ-070-04 the message the club receives", () => {
  it("is addressed from the club, to every recipient, with the visitor as Reply-To", () => {
    const message = renderContactMessage(INPUT, ROUTE);
    expect(message.from).toEqual(ROUTE.from);
    expect(message.to).toEqual(["club@example.com", "colleague@example.org"]);
    expect(message.replyTo).toEqual({ name: "Ana Popescu", address: "ana@example.com" });
    expect(message.subject).toBe("Mesaj de pe site: Ana Popescu");
  });

  it("marks the subject on QA and nowhere else (AGENTS.md §16.4)", () => {
    expect(renderContactMessage(INPUT, { ...ROUTE, appEnv: "qa" }).subject).toBe(`${QA_SUBJECT_PREFIX}Mesaj de pe site: Ana Popescu`);
    expect(renderContactMessage(INPUT, { ...ROUTE, appEnv: "local" }).subject).toBe("Mesaj de pe site: Ana Popescu");
  });

  it("carries the name, the address, the message and the page, in text and in HTML", () => {
    const message = renderContactMessage(INPUT, ROUTE);
    for (const part of ["Ana Popescu", "ana@example.com", "la ce oră începe alergarea? <3", INPUT.pageUrl]) {
      expect(message.text).toContain(part);
    }
    // The HTML twin escapes what the visitor typed: a message is never markup in the club's inbox.
    expect(message.html).toContain("la ce oră începe alergarea? &lt;3");
    expect(message.html).not.toContain("<3");
    expect(message.html).toContain("white-space:pre-wrap");
  });

  it("keeps a header to one line whatever the box allowed", () => {
    expect(contactSubject("Ana\r\nBcc: x@example.com")).toBe("Mesaj de pe site: Ana Bcc: x@example.com");
    expect(renderContactMessage({ ...INPUT, name: "Ana\nPopescu" }, ROUTE).replyTo.name).toBe("Ana Popescu");
  });

  it("is captured whole by the capture transport, which opens no socket", async () => {
    const transport = createCaptureSmtpTransport(() => new Date("2026-09-19T20:00:00.000Z"));
    const result = await transport.send(renderContactMessage(INPUT, ROUTE));
    expect(result.outcome).toBe("sent");
    expect(transport.messages).toHaveLength(1);
    expect(transport.messages[0].to).toEqual(ROUTE.to);
    expect(transport.messages[0].providerMessageId).toMatch(/^capture:/);
    transport.clear();
    expect(transport.messages).toHaveLength(0);
  });
});
