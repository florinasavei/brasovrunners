import { describe, expect, it } from "vitest";
import { privacyNoticeEn, privacyNoticeRo } from "@/modules/legal-documents/templates/privacy-notice";

/**
 * §NNN — the privacy-notice template describes the club members' accounts before an Administrator
 * invites one: section 12 names what is kept for a member, that Zitadel holds the account, what the
 * members' zone shows and how the account is deleted; the processors' line says Zitadel holds the
 * team's **and** the members' accounts. `MEMBER_INVITATION` points the member at this notice.
 */
describe("§NNN the privacy notice covers the members' accounts", () => {
  const cases = [
    { lang: "ro", body: privacyNoticeRo, heading: "12. Echipa și membrii clubului", zone: "zona membrilor", processor: "conturile de autentificare ale echipei și ale membrilor clubului" },
    { lang: "en", body: privacyNoticeEn, heading: "12. The club's team and members", zone: "members' area", processor: "sign-in accounts of the club's team and members" },
  ] as const;

  it.each(cases)("says it in section 12 and in the processors' line ($lang)", ({ body, heading, zone, processor }) => {
    const section = body.sections.find((candidate) => candidate.heading === heading);
    expect(section, heading).toBeDefined();
    const members = section!.paragraphs.join(" ");
    expect(members).toContain(zone);
    expect(members).toContain("Zitadel");
    expect(members).toContain("art. 6(1)(f)");
    expect(body.sections.flatMap((candidate) => candidate.paragraphs).some((paragraph) => paragraph.includes(processor))).toBe(true);
  });

  it("keeps the two languages the same shape", () => {
    const shape = (body: typeof privacyNoticeRo) => body.sections.map((section) => section.paragraphs.length);
    expect(shape(privacyNoticeEn)).toEqual(shape(privacyNoticeRo));
  });
});
