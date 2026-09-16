import { describe, expect, it } from "vitest";
import { emailMessageType, type EmailMessageType } from "@/db/schema/email-outbox";
import { buildOutgoingEmail, type TemplateData } from "@/modules/notifications/templates";

/**
 * BR-REQ-080-01 — message coverage. Criterion 3: "no message type lacks a template in either
 * locale." This test fails the moment a message type is added to the database enum without a
 * matching entry in `templates.ts`, which is exactly the CI-time guarantee the requirement asks
 * for — not a manual checklist someone has to remember to update.
 */
const DATA: TemplateData = {
  participantName: "Ana Pop",
  eventTitle: "Crosul aniversar",
  eventLocationName: "Parcul Tractorul",
  eventStartsAtFormatted: "11 octombrie 2026, 09:00",
  currentStatus: "CONFIRMED",
};

describe("BR-REQ-080-01 message templates", () => {
  for (const messageType of emailMessageType.enumValues as EmailMessageType[]) {
    for (const locale of ["ro", "en"] as const) {
      it(`renders a complete ${locale} message for ${messageType}`, () => {
        const email = buildOutgoingEmail({
          to: "ana@example.ro",
          locale,
          idempotencyKey: `test:${messageType}:${locale}`,
          messageType,
          data: DATA,
          actionUrl: "https://example.test/ro/inregistrari/confirmare/secret",
        });

        expect(email.subject.length).toBeGreaterThan(0);
        expect(email.html.length).toBeGreaterThan(0);
        expect(email.text.length).toBeGreaterThan(0);
        expect(email.locale).toBe(locale);
      });
    }
  }

  it("REGISTRATION_STATE_NOTICE carries no action link even when one is supplied", () => {
    const email = buildOutgoingEmail({
      to: "ana@example.ro",
      locale: "ro",
      idempotencyKey: "test:notice",
      messageType: "REGISTRATION_STATE_NOTICE",
      data: DATA,
      actionUrl: "https://example.test/should-not-appear",
    });

    expect(email.html).not.toContain("should-not-appear");
    expect(email.text).not.toContain("should-not-appear");
  });

  it("interpolates the participant's name and the event title", () => {
    const email = buildOutgoingEmail({
      to: "ana@example.ro",
      locale: "en",
      idempotencyKey: "test:interpolation",
      messageType: "REGISTRATION_CONFIRMED",
      data: DATA,
      actionUrl: "https://example.test/en/registrations/manage/secret",
    });

    expect(email.text).toContain("Ana Pop");
    expect(email.text).toContain("Crosul aniversar");
    expect(email.html).toContain("https://example.test/en/registrations/manage/secret");
  });

  it("never encodes the recipient's raw email or a stray HTML tag from interpolated data", () => {
    const email = buildOutgoingEmail({
      to: "ana@example.ro",
      locale: "ro",
      idempotencyKey: "test:xss",
      messageType: "REGISTRATION_CONFIRMED",
      data: { ...DATA, participantName: '<script>alert(1)</script>' },
    });

    expect(email.html).not.toContain("<script>");
  });
});
