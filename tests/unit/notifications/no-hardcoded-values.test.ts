import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { buildOutgoingEmail, type TemplateData } from "@/modules/notifications/templates";
import type { EmailMessageType } from "@/db/schema/email-outbox";
import { CLUB_NAME } from "@/theme/brand";

/**
 * §NNN — the owner, 2026-09-24: "I do not [want] hardcoded stuff in the document and emails
 * anymore!"
 *
 * The emails' own sentences name the club through the platform's one constant (`CLUB_NAME`,
 * §215) and an event only through its data. Two sentences stated a number that is not the
 * platform's but the event's or the send's: "we remind you a week before the start" (the
 * participation window is each event's own, §104) and "is two days away" (a runner confirmed
 * late is reminded a day after confirming, nearer the start, §126). And a cancellation with no
 * title named the club where the event's name belongs.
 */
const DATA: TemplateData = {
  participantName: "Ana Pop",
  eventTitle: "Crosul aniversar",
  eventStartsAtFormatted: "duminică, 11 oct. 2026, 09:00",
};

function render(messageType: EmailMessageType, data: TemplateData) {
  return buildOutgoingEmail({ to: "ana@example.ro", locale: "ro", idempotencyKey: `test:${messageType}`, messageType, data, actionUrl: "https://example.test/ro/x/secret" });
}

describe("§NNN no hardcoded value in the emails' own sentences", () => {
  it("writes the club's name nowhere in the templates but through the constant", () => {
    const source = readFileSync(path.join(process.cwd(), "src/modules/notifications/templates.ts"), "utf8");
    expect(source).not.toContain(CLUB_NAME);
    expect(source).not.toMatch(/Bra(?:ș|s|&#536;)ov/);
    // And the constant is what the messages read: the sign-off and the banner's words.
    const email = render("REGISTRATION_CONFIRMED", DATA);
    expect(email.text).toContain(`Echipa ${CLUB_NAME}`);
    expect(email.text).toContain(`The ${CLUB_NAME} team`);
    expect(email.html).toContain(`alt="${CLUB_NAME}"`);
  });

  it("says the confirmation is asked when the event's own window opens, never a fixed week", () => {
    const email = render("COMPLETE_DECLARATION", { ...DATA, confirmLater: true, holdExpiresAtFormatted: "joi, 19 nov. 2026, 09:00" });
    expect(email.text).toContain("sau când îți reamintim, înainte de start.");
    expect(email.text).toContain("or when we remind you before the start.");
    expect(email.text).not.toMatch(/săptămân|a week before/);
  });

  it("says the event is coming up, not how many days away it is", () => {
    const email = render("EVENT_REMINDER", DATA);
    expect(email.text).toContain("Crosul aniversar se apropie.");
    expect(email.text).toContain("Crosul aniversar is coming up.");
    expect(email.text).not.toMatch(/două zile|two days/);
  });

  it("names no event rather than the club when a cancelled event's title is missing", () => {
    const email = render("EVENT_CANCELLED", { participantName: "Ana Pop" });
    expect(email.subject).toBe("Evenimentul a fost anulat / The event has been cancelled");
    expect(email.text).toContain("Ne pare rău: evenimentul a fost anulat.");
    expect(email.text).toContain("We are sorry: the event has been cancelled.");
    expect(email.text).not.toContain(`„${CLUB_NAME}”`);
    expect(email.text).not.toContain(`“${CLUB_NAME}”`);
    // With a title, the sentence is the one it always was.
    expect(render("EVENT_CANCELLED", DATA).subject).toBe("Evenimentul „Crosul aniversar” a fost anulat / “Crosul aniversar” has been cancelled");
  });

  it("names the club in the invitation and the registrations link through the constant", () => {
    expect(render("STAFF_INVITATION", DATA).subject).toBe(`Ești în echipa ${CLUB_NAME} / You are on the ${CLUB_NAME} team`);
    expect(render("PROFILE_MANAGE_LINK", DATA).subject).toBe(`Înscrierile tale la ${CLUB_NAME} / Your registrations at ${CLUB_NAME}`);
  });

  it("names the club through the constant in the email Zitadel sends for us and in the bib sheet's metadata", () => {
    // Zitadel's invitation carries `applicationName` into its own email; the bib sheet's PDF
    // carries its Author. Neither is one of our templates, and both still leave with the name.
    for (const file of ["src/modules/staff-identity/zitadel-users.ts", "src/modules/registrations/bibs-pdf.ts"]) {
      const source = readFileSync(path.join(process.cwd(), file), "utf8");
      expect(source, file).not.toMatch(/Bra(?:ș|s)ov Runners/);
      expect(source, file).toContain('from "@/theme/brand"');
    }
  });
});
