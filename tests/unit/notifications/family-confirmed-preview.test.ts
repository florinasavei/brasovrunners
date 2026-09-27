import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import en from "../../../messages/en.json";
import ro from "../../../messages/ro.json";
import { EMAIL_SAMPLE_FAMILY_CONFIRMED } from "@/modules/notifications/domain/email-sample";
import { emailSampleFamilyConfirmed, emailSampleFor } from "@/modules/notifications/email-copy-fields";
import { renderBilingual } from "@/modules/notifications/templates";

/**
 * §NNN — `/admin/emails` previews every message a participant can receive (§81); the family's one
 * confirmation («Confirmat: 2 persoane», one email with every person's QR and number) had no card: it
 * is `REGISTRATION_CONFIRMED` in another shape. It gets one, right after one person's.
 */
describe("§NNN the family's confirmation on /admin/emails", () => {
  function preview(locale: "ro" | "en") {
    const data = emailSampleFor("REGISTRATION_CONFIRMED", locale);
    data.familyConfirmed = emailSampleFamilyConfirmed();
    return renderBilingual("REGISTRATION_CONFIRMED", locale, data, "https://example.invalid/action", null);
  }

  it("renders the family's shape: «Confirmat: 2 persoane», a block per person with the number and the QR", () => {
    const ro = preview("ro");
    expect(ro.subject).toContain("Confirmat: 2 persoane");
    expect(preview("en").subject).toContain("Confirmed: 2 people");
    for (const person of EMAIL_SAMPLE_FAMILY_CONFIRMED) {
      expect(ro.html).toContain(person.name);
      expect(ro.html).toContain(`<strong style="font-size:20px">${person.raceNumber}</strong>`);
      expect(ro.html).toContain(`/api/registrations/qr/${person.checkinCode}.png`);
    }
    expect(ro.html.match(/data-email-part="family-person"/g)?.length).toBeGreaterThanOrEqual(EMAIL_SAMPLE_FAMILY_CONFIRMED.length);
  });

  it("is a card of the page, after one person's, with its words in both catalogues", () => {
    const page = readFileSync(path.join(process.cwd(), "src/app/[locale]/admin/settings/emails/page.tsx"), "utf8");
    expect(page).toContain('id: "REGISTRATION_CONFIRMED-family"');
    expect(page).toContain("familySample.familyConfirmed = emailSampleFamilyConfirmed();");
    const panel = readFileSync(path.join(process.cwd(), "src/modules/notifications/ui/ParticipantEmailsPanel.tsx"), "utf8");
    expect(panel).toContain("key={message.id ?? message.type}");
    for (const catalogue of [ro, en]) {
      for (const key of ["name", "whenShort", "when", "platformWords"] as const) {
        expect(catalogue.Admin.emails.familyConfirmed[key].length, key).toBeGreaterThan(0);
      }
    }
  });
});
