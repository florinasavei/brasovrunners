/**
 * «Echipa» as a canvas with levels (§NNN, amending §691; the owner: «the president is top level 1,
 * then the advisor level 1.5 and the rest are level 2», and «not with lines»). A pure layout over
 * the shown cards, in the club's order:
 *
 * - a card's **level** says where it sits: the whole number is the row, top first; a `.0` card is one
 *   of the row's leads — wide on row 1, tall on the rows under it — and a `.5` card is a small one
 *   beside the leads of its row, the president's counsellor at her side;
 * - within a row the leads keep the list's order (`position`), and so do the small cards;
 * - a row with no `.0` card still exists (a lone 1.5): its small cards stand alone;
 * - a card without a level is not on the canvas: the page draws it in the grid under the canvas,
 *   and with no levelled card at all the whole page is the grid it always was.
 *
 * No parent, no connector: a level says in one number what §691's `reports_to_id` and `placement`
 * said in two, and nothing is drawn between the cards.
 */

export type CanvasCard = { level: number | null };

export type CanvasRow<C extends CanvasCard> = {
  /** The row's whole number, 1 at the top. */
  level: number;
  /** The `.0` cards, in the list's order. */
  lead: C[];
  /** The `.5` cards, in the list's order, drawn small beside the leads. */
  beside: C[];
};

/** The canvas's rows, ascending; empty when no card has a level. */
export function buildCanvasRows<C extends CanvasCard>(cards: readonly C[]): CanvasRow<C>[] {
  const rows = new Map<number, CanvasRow<C>>();
  for (const card of cards) {
    if (card.level === null || !Number.isFinite(card.level)) continue;
    const row = Math.floor(card.level);
    const entry = rows.get(row) ?? { level: row, lead: [], beside: [] };
    (card.level === row ? entry.lead : entry.beside).push(card);
    rows.set(row, entry);
  }
  return [...rows.values()].sort((a, b) => a.level - b.level);
}

/** The cards with no level, in the list's order: the grid's, under the canvas or alone. */
export function cardsOffCanvas<C extends CanvasCard>(cards: readonly C[]): C[] {
  return cards.filter((card) => card.level === null);
}
