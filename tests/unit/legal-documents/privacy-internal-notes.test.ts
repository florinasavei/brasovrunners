import { describe, expect, it } from "vitest";
import { privacyNoticeEn, privacyNoticeRo } from "@/modules/legal-documents/templates/privacy-notice";

/**
 * §NNN (amends §754's paragraphs, BR-REQ-053-01) — the notice's template says what the organizers may keep: an
 * internal note about a registration, for organising the event, visible to the organizers and administrators
 * only and deleted with the registration; and that an access request is answered with them too. The TEMPLATE
 * only: the texts in force move only when the club approves a version made from it (§639's digest says so).
 */
const registrationParagraph = (body: typeof privacyNoticeRo, heading: RegExp) => {
  const section = body.sections.find((candidate) => heading.test(candidate.heading ?? ""));
  expect(section).toBeDefined();
  const found = section!.paragraphs.filter((paragraph) => /note interne|internal notes/.test(paragraph));
  expect(found).toHaveLength(1);
  return found[0];
};

describe("§NNN the notice's internal-notes sentence", () => {
  it("ro: the organizers may keep them to organise the event, only they and the administrators see them, deleted with the registration", () => {
    const paragraph = registrationParagraph(privacyNoticeRo, /^2\./);
    expect(paragraph).toMatch(/Organizatorii pot ține și note interne despre o înscriere, pentru organizarea evenimentului/);
    expect(paragraph).toMatch(/le văd doar organizatorii și administratorii clubului/);
    expect(paragraph).toMatch(/se șterg odată cu înscrierea \(secțiunea 7\)/);
    expect(paragraph).toMatch(/cerere de acces ți le dăm și pe ele/);
  });

  it("en: the same, in the same paragraph as the registration's history", () => {
    const paragraph = registrationParagraph(privacyNoticeEn, /^2\./);
    expect(paragraph).toMatch(/The organisers may also keep internal notes about a registration, for organising the event/);
    expect(paragraph).toMatch(/only the club's organisers and administrators see them/);
    expect(paragraph).toMatch(/deleted with the registration \(section 7\)/);
    expect(paragraph).toMatch(/access request we give you those too/);
    // The paragraph it sits in is the registration's history, so a reader finds both together.
    expect(paragraph).toMatch(/registration's history/);
  });

  it("says it once in each language, in no other paragraph", () => {
    for (const body of [privacyNoticeRo, privacyNoticeEn]) {
      const all = body.sections.flatMap((section) => section.paragraphs);
      expect(all.filter((paragraph) => /note interne|internal notes/.test(paragraph))).toHaveLength(1);
    }
  });
});
