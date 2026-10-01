import { describe, expect, it } from "vitest";
import en from "../../../messages/en.json";
import ro from "../../../messages/ro.json";
import { describesGmailFallback, isMergeField, mergeText } from "@/modules/legal-documents/domain/merge-fields";
import { privacyNoticeEn, privacyNoticeRo } from "@/modules/legal-documents/templates/privacy-notice";
import { DECLARATION_TOKENS } from "@/modules/legal-documents/templates/tokens";
import { gmailFallbackClause, gmailFallbackMergeValues } from "@/modules/notifications/fallback-notice-words";

/**
 * §NNN (amending §443) — «Gmail preia când Mailgun se oprește» sends a participant's message through
 * Google only under a privacy notice that says so: the notice's marker `{{gmailFallback}}`, the words
 * it is filled with, and the sentence of section 6 that carries it. The gate itself is
 * `tests/unit/notifications/mailgun-stop.test.ts` and `tests/integration/notifications/email-fail-safes.test.ts`.
 */
const text = (paragraph: string) => ({ sections: [{ paragraphs: [paragraph] }] });
const paragraphs = (body: typeof privacyNoticeRo) => body.sections.flatMap((section) => section.paragraphs);

describe("§NNN the privacy notice's marker for Gmail carrying while Mailgun is stopped", () => {
  it("is a merge field the platform's notice carries in both languages, and the legend lists", () => {
    expect(isMergeField("gmailFallback")).toBe(true);
    expect(describesGmailFallback(privacyNoticeRo)).toBe(true);
    expect(describesGmailFallback(privacyNoticeEn)).toBe(true);
    const legend = DECLARATION_TOKENS.find((entry) => entry.token === "{{gmailFallback}}");
    expect(legend?.example).toEqual({ ro: gmailFallbackClause("ro"), en: gmailFallbackClause("en") });
    expect(ro.Admin.legal.tokens.gmailFallback).not.toBe("");
    expect(en.Admin.legal.tokens.gmailFallback).not.toBe("");
  });

  it("is off for a text that does not name it — the gate for the switch", () => {
    expect(describesGmailFallback(text("Mesajele pleacă prin Mailgun."))).toBe(false);
    expect(describesGmailFallback(text("{{promotionalMaterials}}"))).toBe(false);
    expect(describesGmailFallback(text("{{gmailFallbacks}}"))).toBe(false);
    expect(describesGmailFallback("not a body")).toBe(false);
    expect(describesGmailFallback(text("Comutatorul {{ gmailFallback }}."))).toBe(true);
  });

  it("is filled with the switch's own words, quoted, so the approved text names the setting the panel shows", () => {
    expect(gmailFallbackClause("ro")).toBe(`„${ro.Admin.emails.transport.fallback}”`);
    expect(gmailFallbackClause("en")).toBe(`“${en.Admin.emails.transport.fallback}”`);
    for (const [locale, body] of [["ro", privacyNoticeRo], ["en", privacyNoticeEn]] as const) {
      const all = paragraphs(body).map((paragraph) => mergeText(paragraph, gmailFallbackMergeValues(locale))).join(" ");
      expect(all).toContain(gmailFallbackClause(locale));
      expect(all).not.toContain("{{gmailFallback}}");
    }
  });

  it("says in section 6 who carries the message, with what and for what, beside the club's mailbox", () => {
    const [ro6] = paragraphs(privacyNoticeRo).filter((paragraph) => paragraph.includes("{{gmailFallback}}"));
    const [en6] = paragraphs(privacyNoticeEn).filter((paragraph) => paragraph.includes("{{gmailFallback}}"));
    expect(privacyNoticeRo.sections.find((section) => section.paragraphs.includes(ro6))?.heading).toBe("6. Cine mai vede datele");
    expect(privacyNoticeEn.sections.find((section) => section.paragraphs.includes(en6))?.heading).toBe("6. Who else sees it");
    for (const words of ["Mailgun", "refuză sau amână", "Google Ireland Ltd.", "același conținut și aceleași date", "același scop"]) {
      expect(ro6).toContain(words);
    }
    for (const words of ["Mailgun", "refuses or delays", "Google Ireland Ltd.", "the same content and the same data", "the same purpose"]) {
      expect(en6).toContain(words);
    }
  });
});
