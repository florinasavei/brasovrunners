import { describe, expect, it } from "vitest";
import { emailMessageType, type EmailMessageType } from "@/db/schema/email-outbox";
import { getPathname } from "@/i18n/navigation";
import { buildOutgoingEmail, type TemplateData } from "@/modules/notifications/templates";
import { env } from "@/shared/config/env";

/**
 * BR-REQ-080-01 — every participant message says who sends it and where the privacy notice is
 * (GDPR art. 13; `DECISIONS.md` §323).
 *
 * The line is the last thing in each language's half: "Primești acest mesaj de la <club> pentru
 * înscrierea ta. Cum folosim datele tale: <the notice>" — the notice in that half's own
 * language, from `APP_BASE_URL`. The club's own mail (the archive copy, the confirmation
 * notice) and the staff invitation are not a participant's message about their data and carry
 * none; the invitation says what the club keeps about its team in its own body instead.
 */
const DATA: TemplateData = {
  participantName: "Ana Pop",
  eventTitle: "Crosul aniversar",
  eventLocationName: "Parcul Tractorul",
  eventStartsAtFormatted: "11 octombrie 2026, 09:00",
  currentStatus: "CONFIRMED",
};

const CLUB_MAIL: readonly EmailMessageType[] = ["DECLARATION_ARCHIVE", "CLUB_CONFIRMATION_NOTICE", "STAFF_INVITATION"];

const noticeUrl = (locale: "ro" | "en") => `${env.APP_BASE_URL}${getPathname({ locale, href: "/legal/privacy" })}`;

function render(messageType: EmailMessageType, locale: "ro" | "en") {
  return buildOutgoingEmail({
    to: "ana@example.ro",
    locale,
    idempotencyKey: `test:privacy:${messageType}:${locale}`,
    messageType,
    data: DATA,
    actionUrl: "https://example.test/ro/inregistrari/confirmare/secret",
  });
}

describe("BR-REQ-080-01 the privacy line on every participant message (§323)", () => {
  const participantTypes = (emailMessageType.enumValues as EmailMessageType[]).filter((type) => !CLUB_MAIL.includes(type));

  for (const messageType of participantTypes) {
    for (const locale of ["ro", "en"] as const) {
      it(`${messageType} (${locale}) names the controller and links the notice in both languages`, () => {
        const email = render(messageType, locale);
        for (const half of ["ro", "en"] as const) {
          const url = noticeUrl(half);
          expect(email.text, `text links the ${half} notice`).toContain(url);
          // Nothing glued to the address in the text part, where a client links whatever touches it.
          expect(email.text, `no full stop after the ${half} address`).not.toContain(`${url}.`);
          expect(email.html, `html links the ${half} notice`).toContain(`href="${url}"`);
        }
        expect(email.text).toContain("Cum folosim datele tale:");
        expect(email.text).toContain("How we use your data:");
      });
    }
  }

  it("says the message is about the registration, and for the opening notice that it was asked for", () => {
    const confirmation = render("REGISTRATION_CONFIRMED", "ro");
    expect(confirmation.text).toMatch(/Primești acest mesaj de la .+ pentru înscrierea ta\./);
    expect(confirmation.text).toMatch(/This message comes from .+ about your registration\./);
    // "Registration is open" answers an address left on the event page, not a registration.
    const opened = render("REGISTRATION_OPENED", "en");
    expect(opened.text).toMatch(/because you asked to be told\./);
    expect(opened.text).not.toContain("about your registration");
  });

  it("names the club's legal name when the deployment has it, the club's name otherwise", () => {
    const text = render("VERIFY_REGISTRATION_EMAIL", "ro").text;
    expect(text).toContain(`de la ${env.CLUB_LEGAL_NAME ?? "Brașov Runners"} pentru`);
  });

  for (const messageType of CLUB_MAIL) {
    it(`${messageType} carries no participant privacy line`, () => {
      const email = render(messageType, "ro");
      expect(email.text).not.toContain("Cum folosim datele tale:");
      expect(email.text).not.toContain("How we use your data:");
    });
  }

  it("tells an invited team member what the club keeps about them, with the notice", () => {
    const email = render("STAFF_INVITATION", "ro");
    expect(email.text).toContain("Pentru cont folosim Zitadel");
    expect(email.text).toContain("Your account is held by Zitadel");
    expect(email.html).toContain(`href="${noticeUrl("ro")}"`);
    expect(email.html).toContain(`href="${noticeUrl("en")}"`);
  });
});
