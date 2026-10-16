import { describe, expect, it } from "vitest";
import { describesVolunteers } from "@/modules/legal-documents/domain/merge-fields";
import { privacyNoticeEn, privacyNoticeRo } from "@/modules/legal-documents/templates/privacy-notice";

/**
 * §800 — section 10 of the notice's template lists the forms that set the two ten-minute encrypted cookies. The volunteers' form
 * sets the second one (the address and first name for its thank-you screen) on every sign-up, so the list names it — through the
 * volunteers' own marker `{{volunteers}}`, the form's name quoted, with no new switch.
 */
const section10 = (body: typeof privacyNoticeRo) => body.sections.find((section) => section.heading?.startsWith("10."))!.paragraphs.join("\n");

describe("§800 the notice's cookie sentence names the volunteers' form", () => {
  it("ro: the list of forms that set the two cookies ends with the volunteers' form, by its marker", () => {
    expect(section10(privacyNoticeRo)).toContain(
      "puse doar când trimiți formularul de înscriere, declarația, formularul de contact, formularele {{feedbackForms}} sau formularul {{volunteers}} — unul păstrează ce ai scris",
    );
  });

  it("en: the same, in English", () => {
    expect(section10(privacyNoticeEn)).toContain(
      "set only when you submit the registration form, the declaration, the contact form, the {{feedbackForms}} forms or the {{volunteers}} form — one keeps what you typed",
    );
  });

  it("is no new switch: the volunteers' gate (`describesVolunteers`) reads the same marker, and the notice still names it in section 5", () => {
    expect(describesVolunteers(privacyNoticeRo)).toBe(true);
    expect(describesVolunteers(privacyNoticeEn)).toBe(true);
  });
});
