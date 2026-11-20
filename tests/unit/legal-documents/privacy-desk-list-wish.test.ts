import { describe, expect, it } from "vitest";
import { privacyNoticeEn, privacyNoticeRo } from "@/modules/legal-documents/templates/privacy-notice";

/**
 * §NNN (amending §143; BR-REQ-039-01, BR-REQ-053-01) — the privacy notice's template says the one new way the list's tick is
 * given: told to the organizers at the race-number desk, who record it for the person (who recorded it, and when, is kept), the
 * person emailed at once with the link to withdraw it at any time. In the public list's own paragraph of section 4, beside the
 * tick and its two ways out, once in each language. The TEMPLATE only: nothing in force moves until the club approves a version
 * made from it in «Documente legale» (§29, §639), and nothing here approves or seeds one.
 */
const listParagraph = (body: typeof privacyNoticeRo, heading: RegExp, tick: RegExp) => {
  const section = body.sections.find((candidate) => heading.test(candidate.heading ?? ""));
  expect(section).toBeDefined();
  const found = section!.paragraphs.filter((paragraph) => tick.test(paragraph));
  expect(found.length).toBeGreaterThan(0);
  return found[0];
};

describe("§NNN the notice says the wish may be told at the desk", () => {
  it("ro: told to the organizers at the desk, recorded with who and when, an email at once to withdraw it", () => {
    const paragraph = listParagraph(privacyNoticeRo, /^4\./, /Lista publică de participanți/);
    expect(paragraph).toMatch(/Dorința de a apărea cu numele le-o poți spune și organizatorilor, la masa de ridicare a numerelor/);
    expect(paragraph).toMatch(/ei o notează în numele tău \(rămâne scris cine a notat-o și când\)/);
    expect(paragraph).toMatch(/primești pe loc un e-mail cu legătura prin care o retragi oricând/);
    // Beside the tick it is another way of giving: the consent's ground and its two ways out stay as they were.
    expect(paragraph).toMatch(/consimțământ, art\. 6\(1\)\(a\) GDPR, pe care îl retragi oricând din „Înscrierile mele” sau din legătura din emailul de confirmare/);
  });

  it("en: the same, in the same paragraph", () => {
    const paragraph = listParagraph(privacyNoticeEn, /^4\./, /The public participant list/);
    expect(paragraph).toMatch(/You may also tell the organizers at the race-number pick-up desk that you want to appear by name/);
    expect(paragraph).toMatch(/they record it for you \(who recorded it, and when, is kept\)/);
    expect(paragraph).toMatch(/you get an email at once with the link to withdraw it at any time/);
    expect(paragraph).toMatch(/consent, art\. 6\(1\)\(a\) GDPR, withdrawn at any time from “My registrations”, or from the link in your confirmation email/);
  });

  it("says it once in each language, and adds no merge field the club would have to fill", () => {
    const ro = privacyNoticeRo.sections.flatMap((section) => section.paragraphs).filter((paragraph) => /masa de ridicare a numerelor: ei o notează/.test(paragraph));
    const en = privacyNoticeEn.sections.flatMap((section) => section.paragraphs).filter((paragraph) => /race-number pick-up desk that you want to appear by name/.test(paragraph));
    expect(ro).toHaveLength(1);
    expect(en).toHaveLength(1);
    for (const sentence of [...ro, ...en]) {
      const added = sentence.slice(sentence.search(/Dorința de a apărea|You may also tell/));
      expect(added).not.toMatch(/\{\{|<[A-Z]/);
    }
  });
});
