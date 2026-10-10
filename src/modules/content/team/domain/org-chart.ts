import type { TeamPlacement } from "../fields";

/**
 * «Echipa» as an organisational chart (§691; the club's president: «structura organizațională
 * și responsabilități»). A pure layout over the shown cards, in the club's order:
 *
 * - a card whose `reportsToId` names a shown card hangs under it (`below`), or sits at its tier to
 *   its right (`beside`); every other card — no parent, or a parent that is hidden or gone — is a
 *   root. A shown card is never dropped.
 * - children keep the list's order (`position`); a `beside` card is attached to its parent's node
 *   and drawn after it, at the parent's tier.
 * - the data may hold a stale cycle (two rows written by hand, a parent re-pointed between two
 *   saves): the walk keeps a visited set, so it terminates, and the cards of the cycle become
 *   roots in the list's order.
 *
 * `hasRelations` is false while no shown card names a shown parent: the page then draws the grid
 * it always drew, so the club's page changes nothing until it sets a relation.
 */

export type OrgChartCard = { id: string; reportsToId: string | null; placement: TeamPlacement };

export type OrgChartNode<C extends OrgChartCard> = {
  card: C;
  /** The cards at this card's own tier to its right, each a node of its own. */
  beside: OrgChartNode<C>[];
  /** The cards of the tier under this one, in the list's order. */
  children: OrgChartNode<C>[];
};

export type OrgChart<C extends OrgChartCard> = {
  /** Whether any shown card answers to another shown card — the switch between the grid and the chart. */
  hasRelations: boolean;
  /** The tree, top tier first; every shown card is in it exactly once. */
  roots: OrgChartNode<C>[];
  /** The same nodes by tier: `tiers[0]` the roots, each `beside` node right after the node it sits by. */
  tiers: OrgChartNode<C>[][];
};

export function buildOrgChart<C extends OrgChartCard>(cards: readonly C[]): OrgChart<C> {
  const byId = new Map(cards.map((card) => [card.id, card] as const));
  const parentOf = (card: C): string | null => (card.reportsToId !== null && byId.has(card.reportsToId) && card.reportsToId !== card.id ? card.reportsToId : null);

  const below = new Map<string, C[]>();
  const beside = new Map<string, C[]>();
  for (const card of cards) {
    const parent = parentOf(card);
    if (parent === null) continue;
    const bucket = card.placement === "beside" ? beside : below;
    bucket.set(parent, [...(bucket.get(parent) ?? []), card]);
  }

  const visited = new Set<string>();
  const tiers: OrgChartNode<C>[][] = [];
  const place = (node: OrgChartNode<C>, tier: number) => {
    (tiers[tier] ??= []).push(node);
  };
  const build = (card: C, tier: number): OrgChartNode<C> | null => {
    if (visited.has(card.id)) return null;
    visited.add(card.id);
    const node: OrgChartNode<C> = { card, beside: [], children: [] };
    place(node, tier);
    // The card's own children first, then the cards beside it: in the tier under, a card's
    // children come before its neighbour's.
    for (const child of below.get(card.id) ?? []) {
      const built = build(child, tier + 1);
      if (built) node.children.push(built);
    }
    for (const side of beside.get(card.id) ?? []) {
      const built = build(side, tier);
      if (built) node.beside.push(built);
    }
    return node;
  };

  const roots: OrgChartNode<C>[] = [];
  for (const card of cards) {
    if (parentOf(card) !== null) continue;
    const node = build(card, 0);
    if (node) roots.push(node);
  }
  // Whatever is left is on a stale cycle: no root leads to it. Each becomes a root in the list's order.
  for (const card of cards) {
    if (visited.has(card.id)) continue;
    const node = build(card, 0);
    if (node) roots.push(node);
  }

  return { hasRelations: cards.some((card) => parentOf(card) !== null), roots, tiers };
}
