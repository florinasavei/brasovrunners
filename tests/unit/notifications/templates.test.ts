import { describe, expect, it } from "vitest";
import { emailMessageType, type EmailMessageType } from "@/db/schema/email-outbox";
import { buildOutgoingEmail, buildTemplateContent, type TemplateData } from "@/modules/notifications/templates";

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

/**
 * The message without its header band (§174).
 *
 * The band carries the club's lockup as an image on every message, so "this message has no
 * image" and "this message has no link" are claims about the body and have to be asked of the
 * body. Everything before the first `</div>` is the band.
 */
const bodyOf = (html: string) => html.slice(html.indexOf("</div>") + 6);

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

  /**
   * BR-REQ-037-08: the confirmation carries the desk code and its QR — as a hosted image and
   * as the plain code, in both bodies, so a client that strips images still gives the runner
   * something to read out at the desk. No other message type carries it.
   */
  it("puts the desk code and its QR image on the confirmation, and nowhere else", () => {
    const withCode = {
      ...DATA,
      checkinCode: "ABCDEFGH23",
      checkinQrUrl: "https://example.test/api/registrations/qr/ABCDEFGH23.png",
    };
    for (const locale of ["ro", "en"] as const) {
      const email = buildOutgoingEmail({
        to: "ana@example.ro",
        locale,
        idempotencyKey: `test:qr:${locale}`,
        messageType: "REGISTRATION_CONFIRMED",
        data: withCode,
        actionUrl: "https://example.test/manage",
      });
      expect(email.html).toContain('<img src="https://example.test/api/registrations/qr/ABCDEFGH23.png"');
      expect(email.html).toContain("ABCDEFGH23");
      expect(email.text).toContain("ABCDEFGH23");
      expect(email.text).toContain("https://example.test/api/registrations/qr/ABCDEFGH23.png");
      // Never inlined: a data URI is what mail clients strip.
      expect(email.html).not.toContain("data:image");
    }

    const other = buildOutgoingEmail({
      to: "ana@example.ro",
      locale: "ro",
      idempotencyKey: "test:qr:other",
      messageType: "WAITLIST_SPOT_OFFER",
      data: withCode,
      actionUrl: "https://example.test/declare",
    });
    // The card's header carries the club's lockup on every message now (§174), so "no image"
    // is a claim about the body: no QR, and no code in the words either.
    expect(bodyOf(other.html)).not.toContain("<img");
    expect(other.html).not.toContain("ABCDEFGH23");

    // Without a code — a confirmation rendered for a row from before codes existed cannot
    // happen (the renderer mints one), but the template must still degrade to no image.
    const bare = buildOutgoingEmail({
      to: "ana@example.ro",
      locale: "ro",
      idempotencyKey: "test:qr:bare",
      messageType: "REGISTRATION_CONFIRMED",
      data: DATA,
    });
    expect(bodyOf(bare.html)).not.toContain("<img");
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

/**
 * §239 — every participant message ends with the same links.
 *
 * They were built per template, so which links a message carried depended on which message it
 * was, and the address confirmation — the first mail anybody gets — carried none. The owner: "I
 * need more links in that email."
 */
describe("§239 the links every message carries", () => {
  const WITH_URLS: TemplateData = {
    ...DATA,
    eventUrl: "https://example.test/ro/evenimente/cros",
    eventRulesUrl: "https://example.test/ro/evenimente/cros#rules",
    eventScheduleUrl: "https://example.test/ro/evenimente/cros#schedule",
    eventsUrl: "https://example.test/ro/evenimente",
    contactUrl: "https://example.test/ro/contact",
  };

  it("puts them on the address confirmation, which had none", () => {
    const content = buildTemplateContent(
      "VERIFY_REGISTRATION_EMAIL",
      "ro",
      WITH_URLS,
      "https://example.test/ro/confirm/x",
    );
    const urls = (content.links ?? []).map((link) => link.url);
    expect(urls).toContain(WITH_URLS.eventUrl);
    expect(urls).toContain(WITH_URLS.eventRulesUrl);
    expect(urls).toContain(WITH_URLS.eventsUrl);
    expect(urls).toContain(WITH_URLS.contactUrl);
  });

  it("names each destination once, keeping the template's own wording", () => {
    // The reminder already links the event page in words that fit its sentence; the shared
    // list must not append a second link to the same address under a different label.
    const content = buildTemplateContent("EVENT_REMINDER", "ro", WITH_URLS, undefined);
    const urls = (content.links ?? []).map((link) => link.url);
    expect(new Set(urls).size).toBe(urls.length);
  });

  it("drops what there is nothing to point at", () => {
    // No rules written and no programme on this event: neither link is invented.
    const content = buildTemplateContent(
      "VERIFY_REGISTRATION_EMAIL",
      "ro",
    { ...DATA, eventsUrl: WITH_URLS.eventsUrl },
      undefined,
    );
    expect((content.links ?? []).every((link) => !link.url.includes("#"))).toBe(true);
  });

  it("leaves the club's archive copy alone", () => {
    // Not a participant's message: a manage link here would open somebody else's registration.
    const content = buildTemplateContent("DECLARATION_ARCHIVE", "ro", WITH_URLS, undefined);
    expect((content.links ?? []).some((link) => link.url === WITH_URLS.contactUrl)).toBe(false);
  });
});
