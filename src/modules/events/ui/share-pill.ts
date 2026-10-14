/** The gap between pills, between wrapped lines and between the two rows, in spacing units (8 pixels). */
export const SHARE_ROW_GAP = 1;

/** Pixels the invisible tap band reaches above and below a pill: half of `SHARE_ROW_GAP`, never more. */
export const SHARE_PILL_BAND = 4;

/**
 * The share row's pills (`DECISIONS.md` §140, §158): one shape for the anchors the server
 * renders and the two islands beside them, so a network's button, the phone's own sheet and
 * the Instagram picture read as one row — and the «Adaugă în calendar» row under it.
 *
 * Small at every width (§NNN, amending §140 and §170; the owner, 2026-10-14, of the two rows:
 * «These buttons are way too big»). MUI's small outlined button trimmed to 28 pixels, the 0.8125rem
 * word and an 18-pixel glyph: the same small pill the listing card's route pills and the
 * calendar's chips wear (§449, §733), where a phone's 44 was the loudest thing on the event page.
 * A finger still finds each one: 28 is over the 24 WCAG 2.2 asks for (2.5.8), and an invisible band
 * of four pixels above and below (`::after`) makes each link's own tap area 36 pixels high without
 * a taller pill. The rows keep eight pixels between pills, between wrapped lines and between the
 * two rows (`SHARE_ROW_GAP`), so the two bands of neighbouring lines meet exactly in the gap: a band
 * is never wider than the gap beside it, and so never covers a visible pill (a press two pixels
 * inside a pill's edge is the pill's own, as on a card, §366).
 *
 * A plain object in a `.ts` file: a Server Component may not pass a function across the
 * boundary (`AGENTS.md` §14.1), and both sides import this.
 */
export const SHARE_PILL_SX = {
  position: "relative",
  minHeight: 28,
  py: 0.25,
  px: 1.25,
  gap: 0.5,
  borderRadius: 22,
  fontSize: "0.8125rem",
  lineHeight: 1.5,
  // The glyph: the marks are 18 pixels whatever size they were drawn at (the provider logos are 20 in
  // `SubscribeBox`, MUI's icons 24), decorative — the name is the pill's text.
  "& > svg": { width: 18, height: 18, fontSize: 18, flexShrink: 0 },
  "&::after": { content: '""', position: "absolute", top: -SHARE_PILL_BAND, bottom: -SHARE_PILL_BAND, left: 0, right: 0 },
} as const;
