import { describe, expect, it } from "vitest";
import { contrastRatio, MIN_TEXT_CONTRAST } from "@/modules/appearance/domain/tint-contrast";
import { COLOR, EMAIL_EMPHASIS, EMAIL_ORGANIZER_WORDS } from "@/theme/brand";

/**
 * §NNN (BR-REQ-080-01; the owner, 2026-11-16: «as vrea sa aiba alt font si alt backround acest mesaj, sa fie mai
 * vizibil») — the organizers' own words in «Trimite un mesaj participanților» stand on a panel of their own. Its colours
 * read on a light card and on one a mail client darkens by inverting it, as the band's do (§580); how the panel is drawn
 * is `organizer-message.test.ts`.
 */

/** A colour as Gmail's app shows it after dark: each channel inverted. */
const inverted = (hex: string) =>
  `#${[1, 3, 5]
    .map((at) => (255 - Number.parseInt(hex.slice(at, at + 2), 16)).toString(16).padStart(2, "0"))
    .join("")}`;

describe("§NNN the organizers' panel reads on a light card and on one a client darkens", () => {
  it("keeps the words readable on the panel, as sent and inverted", () => {
    expect(contrastRatio(EMAIL_ORGANIZER_WORDS.ink, EMAIL_ORGANIZER_WORDS.panel)).toBeGreaterThanOrEqual(MIN_TEXT_CONTRAST);
    expect(contrastRatio(inverted(EMAIL_ORGANIZER_WORDS.ink), inverted(EMAIL_ORGANIZER_WORDS.panel))).toBeGreaterThanOrEqual(MIN_TEXT_CONTRAST);
  });

  it("keeps the panel's edge visible beside it, and the panel apart from the card", () => {
    // The edge is a shape, not text: the 3:1 of a non-text contrast.
    expect(contrastRatio(EMAIL_ORGANIZER_WORDS.edge, EMAIL_ORGANIZER_WORDS.panel)).toBeGreaterThanOrEqual(3);
    expect(contrastRatio(inverted(EMAIL_ORGANIZER_WORDS.edge), inverted(EMAIL_ORGANIZER_WORDS.panel))).toBeGreaterThanOrEqual(3);
    // A soft ground: visibly not the card, far from a block of colour.
    const step = contrastRatio(EMAIL_ORGANIZER_WORDS.panel, COLOR.surface);
    expect(step).toBeGreaterThan(1.05);
    expect(step).toBeLessThan(1.3);
  });

  it("is told apart from the band of a message's one fact: another ground and another edge", () => {
    expect(EMAIL_ORGANIZER_WORDS.panel).not.toBe(EMAIL_EMPHASIS.band);
    expect(EMAIL_ORGANIZER_WORDS.edge).not.toBe(EMAIL_EMPHASIS.edge);
  });

  it("names a face every mail client has, in a form a style attribute can hold", () => {
    expect(EMAIL_ORGANIZER_WORDS.font).toMatch(/^Georgia,/);
    expect(EMAIL_ORGANIZER_WORDS.font).toMatch(/serif$/);
    expect(EMAIL_ORGANIZER_WORDS.font).not.toContain('"');
  });
});
