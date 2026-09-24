import { describe, expect, it } from "vitest";
import {
  copyFor,
  emailCopyKey,
  emailCopySchema,
  fillPlaceholders,
  unknownPlaceholders,
} from "@/modules/notifications/domain/email-copy";
import { buildTemplateContent, type TemplateData } from "@/modules/notifications/templates";

/**
 * BR-REQ-080-01, `DECISIONS.md` §247 — the club writes the words, the platform keeps the
 * machinery.
 *
 * The line this file defends is the one that matters: a message's subject and paragraphs are
 * the club's to write, and everything that carries a token, a file or an address is not. A
 * placeholder the platform cannot fill is refused at save time rather than reaching a
 * participant as literal braces.
 */
describe("DECISIONS.md §247 the club's own wording", () => {
  const sample: TemplateData = {
    participantName: "Ana Popescu",
    eventTitle: "Crosul de toamnă",
    eventStartsAtFormatted: "duminică, 4 oct. 2026, 09:00",
    bibNumber: 42,
    checkinCode: "EXAMPL",
    checkinQrUrl: "https://example.test/qr.png",
  };

  it("fills the placeholders it knows", () => {
    expect(fillPlaceholders("Salut {participantName}, numărul tău este {bibNumber}.", sample)).toBe(
      "Salut Ana Popescu, numărul tău este 42.",
    );
  });

  it("closes the gap where a message does not carry the field", () => {
    // A club that writes {checkinCode} into the cancellation gets a sentence, not "cod: ."
    expect(fillPlaceholders("Codul tău: {checkinCode}.", {})).toBe("Codul tău:.");
    expect(fillPlaceholders("Te așteptăm la {eventTitle} pe {eventStartsAtFormatted}.", { eventTitle: "Crosul" })).toBe(
      "Te așteptăm la Crosul pe.",
    );
  });

  it("refuses a field this platform cannot fill", () => {
    expect(unknownPlaceholders("Salut {participantName} de la {clubPresident}")).toEqual(["clubPresident"]);
    // And the refusal is at the door, not at send time.
    const bad = { [emailCopyKey("REGISTRATION_CONFIRMED", "ro")]: { subject: "Salut {nobody}", paragraphs: ["x"] } };
    expect(emailCopySchema.safeParse(bad).success).toBe(false);
  });

  it("refuses a URL smuggled in as a field, because links are the platform's", () => {
    // §12.8: the action button is the one link a message carries, and it is minted at send time.
    expect(unknownPlaceholders("Click {manageUrl}")).toEqual(["manageUrl"]);
    expect(unknownPlaceholders("Click {checkinQrUrl}")).toEqual(["checkinQrUrl"]);
  });

  it("refuses a key that is not a message type and a language", () => {
    expect(emailCopySchema.safeParse({ "NOT_A_TYPE:ro": { subject: "x", paragraphs: ["y"] } }).success).toBe(false);
    expect(emailCopySchema.safeParse({ "REGISTRATION_CONFIRMED:de": { subject: "x", paragraphs: ["y"] } }).success).toBe(false);
    expect(emailCopySchema.safeParse({ "REGISTRATION_CONFIRMED:ro": { subject: "x", paragraphs: ["y"] } }).success).toBe(true);
  });

  it("refuses an empty subject, an empty body, and an unknown field on the entry", () => {
    const key = emailCopyKey("REGISTRATION_CONFIRMED", "ro");
    expect(emailCopySchema.safeParse({ [key]: { subject: "", paragraphs: ["x"] } }).success).toBe(false);
    expect(emailCopySchema.safeParse({ [key]: { subject: "x", paragraphs: [] } }).success).toBe(false);
    expect(emailCopySchema.safeParse({ [key]: { subject: "x", paragraphs: ["y"], action: "Press" } }).success).toBe(false);
  });

  it("replaces the words and nothing else of the message", () => {
    const overrides = emailCopySchema.parse({
      [emailCopyKey("REGISTRATION_CONFIRMED", "ro")]: {
        subject: "Ne vedem la {eventTitle}!",
        paragraphs: ["{participantName}, ai locul tău. Numărul: {bibNumber}."],
      },
    });
    const url = "https://example.test/ro/registrations/manage/EXAMPLE";
    const platform = buildTemplateContent("REGISTRATION_CONFIRMED", "ro", sample, url);
    const club = buildTemplateContent("REGISTRATION_CONFIRMED", "ro", sample, url, overrides);

    expect(club.subject).toBe("Ne vedem la Crosul de toamnă!");
    expect(club.paragraphs).toEqual(["Ana Popescu, ai locul tău. Numărul: 42."]);
    // The machinery is untouched: the greeting, the button and its address, the QR, the links.
    expect(club.greeting).toBe(platform.greeting);
    expect(club.action).toEqual(platform.action);
    expect(club.image).toEqual(platform.image);
    expect(club.links).toEqual(platform.links);
    expect(club.closing).toBe(platform.closing);
  });

  it("keeps the sentences the platform adds around a body", () => {
    // §235 ("you were already registered") and §237 ("this number is provisional") are
    // statements about the registration, not about how the club likes to write.
    const overrides = emailCopySchema.parse({
      [emailCopyKey("REGISTRATION_CONFIRMED", "ro")]: { subject: "Confirmat", paragraphs: ["Ai locul tău."] },
    });
    const content = buildTemplateContent(
      "REGISTRATION_CONFIRMED",
      "ro",
      { ...sample, alreadyRegistered: true, bibProvisional: true },
      "https://example.test/x",
      overrides,
    );
    expect(content.paragraphs[0]).not.toBe("Ai locul tău.");
    expect(content.paragraphs).toContain("Ai locul tău.");
    expect(content.paragraphs).toHaveLength(3);
  });

  it("leaves every other message and the other language on the platform's text", () => {
    const overrides = emailCopySchema.parse({
      [emailCopyKey("REGISTRATION_CONFIRMED", "ro")]: { subject: "Confirmat", paragraphs: ["Ai locul tău."] },
    });
    expect(copyFor(overrides, "REGISTRATION_CONFIRMED", "en")).toBeNull();
    expect(copyFor(overrides, "REGISTRATION_CANCELLED", "ro")).toBeNull();
    expect(buildTemplateContent("REGISTRATION_CONFIRMED", "en", sample, undefined, overrides).subject).toBe(
      buildTemplateContent("REGISTRATION_CONFIRMED", "en", sample, undefined).subject,
    );
  });
});
