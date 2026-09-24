import { describe, expect, it } from "vitest";
import { emailMessageType, type EmailMessageType } from "@/db/schema/email-outbox";
import { isParticipantMessage } from "@/modules/notifications/domain/club-notices";
import { buildOutgoingEmail, buildTemplateContent, type TemplateData } from "@/modules/notifications/templates";

/**
 * BR-REQ-033-02 criterion 14 as amended by §320 — the template's half of the club copy.
 *
 * The renderer mints no token for a club copy, so in production the data below never carries a
 * personal link for one. The template drops them again regardless, and this is where that is
 * proved: handed a data object *full* of the participant's links and a token-bearing action, the
 * club copy prints none of it, for every message a participant receives, in both languages.
 */
const SECRET = "Zm9vYmFyYmF6cXV4cXV1eGNvcmdlZ3JhdWx0Z2FycGx"; // shaped like a token secret: 43 base64url characters
const ACTION = `https://example.test/ro/inregistrari/declaratie/${SECRET}`;

const WITH_PERSONAL_LINKS: TemplateData = {
  participantName: "Ana Pop",
  eventTitle: "Crosul aniversar",
  eventLocationName: "Parcul Tractorul",
  eventStartsAtFormatted: "duminică, 11 oct. 2026, 09:00",
  eventStartsAtFormattedOther: "Sunday, 11 Oct 2026, 09:00",
  currentStatus: "CONFIRMED",
  bibNumber: 42,
  checkinCode: "K7Q2XR",
  checkinQrUrl: "https://example.test/api/registrations/qr/K7Q2XR.png",
  manageUrl: `https://example.test/ro/inregistrari/gestionare/${SECRET}`,
  listConsentUrl: `https://example.test/ro/inregistrari/lista/${SECRET}`,
  declarationPdfUrl: `https://example.test/api/registrations/declaration/${SECRET}`,
  eventUrl: "https://example.test/ro/evenimente/crosul-aniversar",
  eventsUrl: "https://example.test/ro/evenimente",
  contactUrl: "https://example.test/ro/contact",
  thanksUrl: "https://example.org/rezultate",
};

const PARTICIPANT_TYPES = (emailMessageType.enumValues as EmailMessageType[]).filter(isParticipantMessage);

describe("BR-REQ-033-02 criterion 14 the club copy prints nothing only the participant may hold (§320)", () => {
  it("covers at least the messages a runner meets on the way to the start", () => {
    for (const type of ["VERIFY_REGISTRATION_EMAIL", "COMPLETE_DECLARATION", "WAITLIST_SPOT_OFFER", "REGISTRATION_CONFIRMED", "EVENT_REMINDER", "BIB_ASSIGNED", "DECLARATION_SIGNED"]) {
      expect(PARTICIPANT_TYPES).toContain(type);
    }
  });

  for (const messageType of PARTICIPANT_TYPES) {
    for (const locale of ["ro", "en"] as const) {
      it(`${messageType} (${locale}): no token, no action button, no desk code; marked in both languages`, () => {
        const email = buildOutgoingEmail({
          to: "arhiva@example.test",
          locale,
          idempotencyKey: `test:${messageType}:${locale}:club-copy`,
          messageType,
          data: { ...WITH_PERSONAL_LINKS, clubCopy: true },
          actionUrl: ACTION,
        });

        for (const body of [email.html, email.text]) {
          expect(body).not.toContain(SECRET);
          expect(body).not.toMatch(/\/(inregistrari|registrations)\/(confirmare|confirm|declaratie|declare|gestionare|manage|lista|list)\//);
          expect(body).not.toMatch(/\/api\/registrations\/(qr|declaration)\//);
          expect(body).not.toContain("K7Q2XR");
          // Both halves say what this is.
          expect(body).toContain("Copie pentru club a mesajului trimis participantului.");
          expect(body).toContain("Club copy of the message sent to the participant.");
        }
        // No button at all — the one rule, rather than a list of which actions are safe.
        expect(email.html).not.toContain("display:inline-block;background");
        // Each half of the bilingual subject carries its own language's mark.
        expect(email.subject.startsWith(locale === "ro" ? "[Copie club] " : "[Club copy] ")).toBe(true);
        expect(email.subject).toContain(locale === "ro" ? " / [Club copy] " : " / [Copie club] ");
        expect(email.attachments).toBeUndefined();
      });
    }
  }

  it("keeps what is public: the event's page, the listing, the contact page and the race number", () => {
    const content = buildTemplateContent("REGISTRATION_CONFIRMED", "ro", { ...WITH_PERSONAL_LINKS, clubCopy: true }, ACTION);
    const urls = (content.links ?? []).map((link) => link.url);
    expect(urls).toContain(WITH_PERSONAL_LINKS.eventUrl);
    expect(urls).toContain(WITH_PERSONAL_LINKS.eventsUrl);
    expect(urls).toContain(WITH_PERSONAL_LINKS.contactUrl);
    expect(urls.some((url) => url.includes(SECRET))).toBe(false);
    expect(content.action).toBeUndefined();
    expect(content.image).toBeUndefined();
    expect(content.paragraphs.join(" ")).toContain("**42**");
    // The note comes first, before the participant's own words.
    expect(content.paragraphs[0]).toBe("Copie pentru club a mesajului trimis participantului. Legăturile personale, codul QR și atașamentele au fost scoase.");
  });

  it("leaves the participant's own message exactly as it was", () => {
    const own = buildOutgoingEmail({
      to: "ana@example.ro",
      locale: "ro",
      idempotencyKey: "test:own",
      messageType: "REGISTRATION_CONFIRMED",
      data: WITH_PERSONAL_LINKS,
      actionUrl: ACTION,
    });
    const flagOff = buildOutgoingEmail({
      to: "ana@example.ro",
      locale: "ro",
      idempotencyKey: "test:own",
      messageType: "REGISTRATION_CONFIRMED",
      data: { ...WITH_PERSONAL_LINKS, clubCopy: false },
      actionUrl: ACTION,
    });
    expect(flagOff).toEqual(own);
    expect(own.subject.startsWith("Înscrierea este confirmată")).toBe(true);
    expect(own.html).toContain(SECRET);
    expect(own.html).toContain("K7Q2XR");
    expect(own.text).not.toContain("Copie pentru club");
  });
});
