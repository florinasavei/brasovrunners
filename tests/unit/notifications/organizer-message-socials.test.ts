import { beforeEach, describe, expect, it, vi } from "vitest";
import { emailMessageType } from "@/db/schema/email-outbox";
import { isRelayMessage } from "@/modules/notifications/domain/relay";
import { emailSampleFor } from "@/modules/notifications/email-copy-fields";
import { buildOutgoingEmail, buildTemplateContent, type TemplateData } from "@/modules/notifications/templates";
import { CLUB_NAME } from "@/theme/brand";

/**
 * `DECISIONS.md` §957 — the club's Facebook and Instagram pages under the organizers' message to an event's participants
 * (the owner, 2026-11-17: «în mailul către toți participanții pune și link-urile către social media pages: facebook și
 * instagram»). The two addresses are the ones the site's footer links (`CLUB_FACEBOOK_URL`, `CLUB_INSTAGRAM_URL`): set
 * here to made-up pages, one at a time, so the test says what a message carries with both, with one and with neither —
 * and that no other message carries them.
 */

const FACEBOOK = "https://www.facebook.com/example-runners";
const INSTAGRAM = "https://www.instagram.com/example.runners";

const socials = vi.hoisted(() => ({ facebook: undefined as string | undefined, instagram: undefined as string | undefined }));

vi.mock("@/shared/config/env", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/shared/config/env")>();
  return {
    ...actual,
    env: {
      ...actual.env,
      get CLUB_FACEBOOK_URL() {
        return socials.facebook;
      },
      get CLUB_INSTAGRAM_URL() {
        return socials.instagram;
      },
    },
  };
});

const DATA: TemplateData = {
  participantName: "Ana Pop",
  eventTitle: "Crosul de toamnă",
  eventTitleOther: "The autumn cross",
  eventStartsAtFormatted: "duminică, 11 oct. 2026, 09:00",
  eventStartsAtFormattedOther: "Sunday, 11 Oct 2026, 09:00",
  eventUrl: "https://example.test/ro/evenimente/crosul-de-toamna",
  eventsUrl: "https://example.test/ro/evenimente",
  contactUrl: "https://example.test/ro/contact",
  organizerSubject: "Ultimele detalii",
  organizerSubjectOther: "The last details",
  organizerBody: "Ne vedem sâmbătă.",
  organizerBodyOther: "See you on Saturday.",
};

const organizerMessage = (locale: "ro" | "en", data: TemplateData = DATA) =>
  buildOutgoingEmail({ to: "ana@example.ro", locale, idempotencyKey: `test:organizer-socials:${locale}`, messageType: "ORGANIZER_MESSAGE", data, actionUrl: DATA.eventUrl });

beforeEach(() => {
  socials.facebook = FACEBOOK;
  socials.instagram = INSTAGRAM;
});

describe("§957 the club's Facebook and Instagram under the organizers' message", () => {
  it("lists both pages last among the message's links, Facebook first, each half in its own language", () => {
    const content = buildTemplateContent("ORGANIZER_MESSAGE", "ro", DATA, DATA.eventUrl);
    expect(content.links?.slice(-2)).toEqual([
      { label: `${CLUB_NAME} pe Facebook`, url: FACEBOOK },
      { label: `${CLUB_NAME} pe Instagram`, url: INSTAGRAM },
    ]);
    // Everything the message linked before is still there, before them.
    expect(content.links?.map((link) => link.url)).toEqual(expect.arrayContaining([DATA.eventsUrl, DATA.contactUrl]));
    expect(content.links?.findIndex((link) => link.url === DATA.contactUrl)).toBeLessThan(content.links?.findIndex((link) => link.url === FACEBOOK) ?? -1);

    const english = buildTemplateContent("ORGANIZER_MESSAGE", "en", DATA, DATA.eventUrl);
    expect(english.links?.slice(-2)).toEqual([
      { label: `${CLUB_NAME} on Facebook`, url: FACEBOOK },
      { label: `${CLUB_NAME} on Instagram`, url: INSTAGRAM },
    ]);
  });

  it("writes them into the message as it leaves: links in the HTML, addresses in the text, in both halves", () => {
    for (const locale of ["ro", "en"] as const) {
      const email = organizerMessage(locale);
      for (const [label, url] of [
        [`${CLUB_NAME} pe Facebook`, FACEBOOK],
        [`${CLUB_NAME} pe Instagram`, INSTAGRAM],
        [`${CLUB_NAME} on Facebook`, FACEBOOK],
        [`${CLUB_NAME} on Instagram`, INSTAGRAM],
      ]) {
        expect(email.text).toContain(`${label}: ${url}`);
        expect(email.html).toContain(`<a href="${url}"`);
        expect(email.html).toContain(`>${label}</a>`);
      }
      // The organizers' own words are untouched, above them.
      expect(email.text.indexOf("Ne vedem sâmbătă.")).toBeGreaterThan(-1);
      expect(email.text.indexOf("Ne vedem sâmbătă.")).toBeLessThan(email.text.indexOf(FACEBOOK));
    }
  });

  it("is on the club's copy of the message too: the copy shows what the participants got", () => {
    const copy = buildTemplateContent("ORGANIZER_MESSAGE", "ro", { ...DATA, clubCopy: true }, DATA.eventUrl);
    expect(copy.links?.map((link) => link.url)).toEqual(expect.arrayContaining([FACEBOOK, INSTAGRAM]));
  });

  it("leaves out a page that is not set, and with neither the message says nothing of them", () => {
    socials.instagram = undefined;
    const onlyFacebook = organizerMessage("ro");
    expect(onlyFacebook.text).toContain(`${CLUB_NAME} pe Facebook: ${FACEBOOK}`);
    expect(onlyFacebook.text).not.toContain("Instagram");

    socials.facebook = undefined;
    socials.instagram = INSTAGRAM;
    const onlyInstagram = organizerMessage("ro");
    expect(onlyInstagram.text).toContain(`${CLUB_NAME} pe Instagram: ${INSTAGRAM}`);
    expect(onlyInstagram.text).not.toContain("Facebook");

    socials.instagram = undefined;
    const neither = organizerMessage("ro");
    expect(neither.text).not.toContain("Facebook");
    expect(neither.text).not.toContain("Instagram");
    expect(neither.html).not.toContain("facebook.com");
    expect(neither.html).not.toContain("instagram.com");
    // The other links are as they were.
    expect(neither.text).toContain("Scrie-ne: https://example.test/ro/contact");
  });

  it("is the organizers' message's alone: no other message carries the club's pages", () => {
    for (const messageType of emailMessageType.enumValues) {
      // A relayed message has no template (the relay composes it): nothing of this file's reaches it.
      if (messageType === "ORGANIZER_MESSAGE" || isRelayMessage(messageType)) continue;
      for (const locale of ["ro", "en"] as const) {
        const email = buildOutgoingEmail({
          to: "ana@example.ro",
          locale,
          idempotencyKey: `test:no-socials:${messageType}:${locale}`,
          messageType,
          data: emailSampleFor(messageType, locale),
          actionUrl: DATA.eventUrl,
        });
        expect(email.text, `${messageType} (${locale})`).not.toContain(FACEBOOK);
        expect(email.text, `${messageType} (${locale})`).not.toContain(INSTAGRAM);
        expect(email.html, `${messageType} (${locale})`).not.toContain(FACEBOOK);
        expect(email.html, `${messageType} (${locale})`).not.toContain(INSTAGRAM);
      }
    }
  });
});
