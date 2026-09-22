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
    // No copy list configured, no `Cc` header at all — not an empty one (§164).
    expect(message.cc).toBeUndefined();
  });

  it("carries the club's copy list as a real Cc, one line each (§164)", () => {
    const copied = renderContactMessage(INPUT, { ...ROUTE, cc: ["amalia@example.org", "board@example.org"] });
    expect(copied.to).toEqual(["club@example.com", "colleague@example.org"]);
    expect(copied.cc).toEqual(["amalia@example.org", "board@example.org"]);
    // "Reply" still answers the visitor, whoever else was copied — the whole of the workflow.
    expect(copied.replyTo).toEqual({ name: "Ana Popescu", address: "ana@example.com" });

    // A header may not fold, whatever a setting or a variable once held — the "to" list is
    // `CONTACT_FORM_TO`'s when the club has typed nobody, and nothing validates that at startup.
    expect(renderContactMessage(INPUT, { ...ROUTE, cc: ["a@example.org\r\nBcc: x@example.com"] }).cc).toEqual([
      "a@example.org Bcc: x@example.com",
    ]);
    expect(renderContactMessage(INPUT, { ...ROUTE, to: ["club@example.com\r\nBcc: x@example.com"] }).to).toEqual([
      "club@example.com Bcc: x@example.com",
    ]);
    expect(renderContactMessage(INPUT, { ...ROUTE, cc: [] }).cc).toBeUndefined();
  });

  it("carries the club's hidden copies as a Bcc, one line each, and none when there are none (2026-09-22)", () => {
    const hidden = renderContactMessage(INPUT, { ...ROUTE, cc: ["amalia@example.org"], bcc: ["arhiva@example.org", "presedinte@example.org"] });
    expect(hidden.to).toEqual(["club@example.com", "colleague@example.org"]);
    expect(hidden.cc).toEqual(["amalia@example.org"]);
    // A separate field, so the transport puts them on the envelope and in no header: that is
    // what makes them hidden from the visitor and from the Cc'd colleagues alike.
    expect(hidden.bcc).toEqual(["arhiva@example.org", "presedinte@example.org"]);
    expect(hidden.replyTo).toEqual({ name: "Ana Popescu", address: "ana@example.com" });
    // The same header rule as the visible lists: one line, whatever the box allowed.
    expect(renderContactMessage(INPUT, { ...ROUTE, bcc: ["a@example.org\r\nCc: x@example.com"] }).bcc).toEqual(["a@example.org Cc: x@example.com"]);
    // No list, no field — not an empty one.
    expect(renderContactMessage(INPUT, ROUTE).bcc).toBeUndefined();
    expect(renderContactMessage(INPUT, { ...ROUTE, bcc: [] }).bcc).toBeUndefined();
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
