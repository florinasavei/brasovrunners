import { describe, expect, it } from "vitest";
import { privacyNoticeEn, privacyNoticeRo } from "@/modules/legal-documents/templates/privacy-notice";

/**
 * §NNN (amends §149, §778) — «Scrie-ne» leaves by the club's Gmail or by Mailgun, as the club chooses, and by the other when the
 * chosen one is down; the notice's template says so rather than «Gmail, and Mailgun only when Gmail is down».
 */
const paragraphs = (body: typeof privacyNoticeRo) => body.sections.flatMap((s) => s.paragraphs);
const contactParagraph = (body: typeof privacyNoticeRo, marker: string) => {
  const found = paragraphs(body).filter((p) => p.startsWith(marker));
  expect(found).toHaveLength(1);
  return found[0]!;
};

describe("§NNN the notice's «Scrie-ne» paragraph", () => {
  it("ro: names both roads as the club's choice and no longer makes Mailgun a Gmail-only failover", () => {
    const p = contactParagraph(privacyNoticeRo, "Formularul de contact („Scrie-ne”)");
    expect(p).toMatch(/prin Gmail-ul clubului sau prin serviciul de e-mail al clubului \(Mailgun, regiunea UE\), după cum alege clubul/);
    expect(p).toMatch(/iar dacă drumul ales nu merge, prin celălalt/);
    expect(p).not.toMatch(/dacă Gmail nu merge/);
    expect(p).toContain("{{relayQueue}}");
  });

  it("en: names both roads as the club's choice and no longer makes Mailgun a Gmail-only failover", () => {
    const p = contactParagraph(privacyNoticeEn, "The contact form (\"Write to us\")");
    expect(p).toMatch(/through the club's Gmail or through the club's email service \(Mailgun, EU region\), as the club chooses/);
    expect(p).toMatch(/and through the other if the chosen one is down/);
    expect(p).not.toMatch(/if Gmail is down/);
    expect(p).toContain("{{relayQueue}}");
  });
});
