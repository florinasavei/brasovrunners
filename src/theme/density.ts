/**
 * One phone density scale for the public pages — every page under `src/app/[locale]` a visitor
 * or a participant reads, with the listing, an event page and the calendar the ones it reaches
 * furthest into — so "tighter on mobile" is an edit to this file, not a hunt through a dozen
 * components (§NNN; the owner, 2026-09-24, on his phone, after the listing and an event page:
 * "There is a bit too much padding and whitespace on mobile, the space could be used more
 * efficiently").
 *
 * Eight named steps, each an MUI spacing unit (1 = 8px), used only for the **xs** side of a
 * breakpoint object (`{ xs: DENSITY.x, sm: <the value the page already had> }`). `sm` and up
 * are never touched — a tablet or a desktop had no complaint — so every place this is used
 * keeps its wider value from `sm` unchanged; `tests/unit/theme/density.test.ts` holds a table of
 * every converted site with its pre-change value.
 *
 * What is NOT here, on purpose:
 * - **`card-layout.ts`'s `LINE_GAP` and `GROUP_GAP`.** They are not a phone override at all —
 *   they apply at every width — and §366's title, the door and the fold measure their 44-pixel
 *   tap targets against those two numbers exactly (10px reach above a title, 8px below). Moving
 *   them would silently break a proven tap-target height, not just add whitespace.
 * - **The listing card's horizontal padding (`CARD_BODY_SX`'s `px`)** and **`EventFacts.tsx`'s
 *   row layout.** §366/§375 measured the card's "when" row against an exact width budget — 94
 *   reserved pixels at every phone width, a 226px row at 320px, a 376px breakpoint for a series'
 *   "Următoarea:" lead — in headless Chromium, character by character. Only `CARD_BODY_SX`'s
 *   *vertical* padding (`pt`) is a density token below; the horizontal padding that budget was
 *   measured against is untouched, so every number in those comments still holds.
 * - **The error and not-found screens' `py: { xs: 4 }`.** One sentence centred in an otherwise
 *   empty page; the room is the layout, not excess.
 * - Typography. Nothing here changes a font size or a line height — only the room around words.
 */
export const DENSITY = {
  /**
   * A page's `<Container>`, top and bottom, on a phone: every public page, the registration form,
   * the participant's own link pages, the gallery, the legal texts and the contact page alike, so
   * the content starts at the same height from one nav page to the next. Was 2 (16px).
   */
  pagePadY: 1.5,
  /**
   * A listing card's own top padding (`CARD_BODY_SX.pt`), on a phone. Was 2 (16px); the
   * horizontal padding next to it is untouched (see above). Vertical only, so the card's width
   * budget in `EventFacts.tsx` is unaffected.
   */
  cardPadTop: 1.5,
  /** Between two cards in the listing's grid, on a phone. Was 1.5 (12px). */
  cardGridGap: 1,
  /** The featured event's own padding, on a phone. Was 2.5 (20px). */
  heroPad: 2,
  /**
   * The tightest step: between two lines of facts — the featured event's `<dl>` rows (was 1,
   * 8px) and, on an event page, under one answer before the next question (the stacked `dd`'s
   * margin, was 1, 8px). Six pixels.
   */
  gapXs: 0.75,
  /**
   * A short gap between one element and the next below it — a "back to events" row, a folded
   * step, a share row, a calendar day or month box, one partner card under another — on a
   * phone. Eight pixels. It replaced 2 (16px) at most sites, the listing intro's 2.5 (20px) and
   * 1.5 (12px) between two calendar days and two partner cards — each closer to this step than to
   * `sectionGap`, so none got a token of its own.
   */
  gapSm: 1,
  /** A section's own separation from what precedes it — an alert, a divider, a filter row — on
   * a phone. Was 3 (24px). */
  sectionGap: 2,
  /** A large section break — a hero's foot, "Linkuri și fișiere", the programme, the rules, the
   * past-events fold — on a phone. Was 4 (32px). */
  sectionGapLg: 2.5,
} as const;
