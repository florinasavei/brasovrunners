import { describe, expect, it } from "vitest";
import { QA_SUBJECT_PREFIX } from "@/infrastructure/email/delivery";
import { createCaptureSmtpTransport } from "@/infrastructure/email/smtp-adapter";
import { contactSuspicion, type ContactSuspicionInput } from "@/modules/contact/domain/suspicion";
import { contactSubject, renderContactMessage, SUSPICIOUS_SUBJECT_PREFIX } from "@/modules/contact/message";

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

  /**
   * The owner, 2026-09-23: "primesc spam cu SEO stuff". What the gates let through and still
   * looks like a program's is delivered, marked — never refused, never dropped (§205) — and what
   * does not look like one must not change by a single byte, so every filter and habit the club
   * already has keeps working.
   */
  describe("a message the gates let through that looks like a program's", () => {
    const SCREENED: ContactSuspicionInput = {
      botCheckOn: true,
      tokenPresent: true,
      turnstileVerdict: "passed",
      elapsedMs: 47_000,
      senderEmail: INPUT.email,
      message: INPUT.message,
      clubHost: "club.example",
    };
    const SPAM_INPUT = {
      ...INPUT,
      name: "Jaqueline Denehy",
      email: "domains@search-club.example",
      message: "Feature club.example in Google's Search Index … https://searchregister.net/submit",
    };
    const SPAM = contactSuspicion({
      ...SCREENED,
      tokenPresent: false,
      turnstileVerdict: "unavailable",
      senderEmail: SPAM_INPUT.email,
      message: SPAM_INPUT.message,
    });

    it("leaves an ordinary message byte-for-byte what it was, with or without a verdict that found nothing", () => {
      const before = renderContactMessage(INPUT, ROUTE);
      // Pinned as literals: the message as it was before any marking existed.
      expect(before.subject).toBe("Mesaj de pe site: Ana Popescu");
      expect(before.text).toBe(
        [
          "Nume: Ana Popescu",
          "E-mail: ana@example.com",
          "Limba formularului: română",
          "Pagina: http://localhost:47821/ro/contact",
          "",
          "Mesaj:",
          "Bună,",
          "la ce oră începe alergarea? <3",
          "",
          "— Trimis prin formularul de contact al site-ului. Răspunde direct acestui e-mail ca să-i scrii.",
        ].join("\n"),
      );
      expect(before.html).toBe(
        '<p><strong>Nume:</strong> Ana Popescu<br><strong>E-mail:</strong> <a href="mailto:ana@example.com">ana@example.com</a><br>' +
          '<strong>Limba formularului:</strong> română<br><strong>Pagina:</strong> <a href="http://localhost:47821/ro/contact">http://localhost:47821/ro/contact</a></p>' +
          '<p><strong>Mesaj:</strong></p><p style="white-space:pre-wrap">Bună,\nla ce oră începe alergarea? &lt;3</p>' +
          "<p><em>— Trimis prin formularul de contact al site-ului. Răspunde direct acestui e-mail ca să-i scrii.</em></p>",
      );

      // A verdict that found nothing — a Cloudflare that did not answer among them — changes nothing.
      for (const input of [SCREENED, { ...SCREENED, turnstileVerdict: "unavailable" as const }, { ...SCREENED, botCheckOn: false, tokenPresent: false, turnstileVerdict: "not_configured" as const }]) {
        const verdict = contactSuspicion(input);
        expect(verdict.suspicious).toBe(false);
        expect(renderContactMessage(INPUT, ROUTE, verdict)).toEqual(before);
      }
    });

    it("puts the mark in front of the subject, and QA's own mark in front of that", () => {
      expect(SUSPICIOUS_SUBJECT_PREFIX).toBe("[posibil spam] ");
      expect(renderContactMessage(SPAM_INPUT, ROUTE, SPAM).subject).toBe("[posibil spam] Mesaj de pe site: Jaqueline Denehy");
      expect(renderContactMessage(SPAM_INPUT, { ...ROUTE, appEnv: "qa" }, SPAM).subject).toBe(
        `${QA_SUBJECT_PREFIX}[posibil spam] Mesaj de pe site: Jaqueline Denehy`,
      );
    });

    it("adds a footer below the message naming each reason in one line and the signals, and keeps everything else", () => {
      const ordinary = renderContactMessage(SPAM_INPUT, ROUTE);
      const marked = renderContactMessage(SPAM_INPUT, ROUTE, SPAM);

      // The message as it would have been, whole, and the footer after it behind a rule.
      expect(marked.text.startsWith(`${ordinary.text}\n\n---\n`)).toBe(true);
      expect(marked.text.slice(ordinary.text.length)).toBe(
        [
          "",
          "",
          "---",
          "Posibil spam — livrat oricum, ca să nu pierdem un om:",
          "• Verificarea anti-bot nu a rulat: formularul a fost trimis fără token — de obicei un program, nu un om.",
          "• Adresa expeditorului imită domeniul clubului: search-club.example.",
          "Semnale: trimis la 47 s după deschiderea paginii · 1 link: searchregister.net · câmpul ascuns gol · verificarea anti-bot fără token",
        ].join("\n"),
      );

      // The HTML twin carries the same footer, after the same body.
      expect(marked.html.startsWith(ordinary.html)).toBe(true);
      const footer = marked.html.slice(ordinary.html.length);
      expect(footer).toMatch(/^<hr>/);
      expect(footer).toContain("<li>Adresa expeditorului imită domeniul clubului: search-club.example.</li>");
      expect(footer).toContain("1 link: searchregister.net");

      // "Reply" still answers whoever wrote — a real person whose browser never ran the widget
      // looks exactly like this — and the recipients are the club's, unchanged.
      expect(marked.replyTo).toEqual({ name: "Jaqueline Denehy", address: "domains@search-club.example" });
      expect(marked.from).toEqual(ordinary.from);
      expect(marked.to).toEqual(ordinary.to);
    });

    it("says what it measured in words a person reads: minutes, many links, a cut list, a missing time", () => {
      const verdict = contactSuspicion({
        ...SCREENED,
        tokenPresent: false,
        turnstileVerdict: "unavailable",
        elapsedMs: 185_000,
        message: "https://a.example https://b.example https://c.example https://d.example https://e.example https://f.example",
      });
      const text = renderContactMessage(INPUT, ROUTE, verdict).text;
      expect(text).toContain("trimis la 3 min după deschiderea paginii");
      expect(text).toContain("6 linkuri: a.example, b.example, c.example, d.example, e.example, …");

      const untimed = renderContactMessage(INPUT, ROUTE, { ...verdict, signals: { ...verdict.signals, elapsedSeconds: null } }).text;
      expect(untimed).toContain("Semnale: fără ora deschiderii paginii");

      // A token Cloudflare could not check is said, and is not itself a reason.
      const outage = contactSuspicion({ ...SCREENED, senderEmail: "x@club-seo.com", turnstileVerdict: "unavailable" });
      const outageText = renderContactMessage(INPUT, ROUTE, outage).text;
      expect(outageText).toContain("Cloudflare nu a răspuns la verificare");
      expect(outageText).not.toContain("fără token");
    });
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
