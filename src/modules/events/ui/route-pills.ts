import type { events } from "@/db/schema/events";
import { costPaidToExternalOrganizer } from "../domain/cost";
import { distanceInKm } from "../domain/event-type";
import { clubNightEvent, nightTooltip } from "../night-event";
import type { GlyphName } from "./glyphs";

/**
 * A pill's content: its glyph by name, for `GlyphChip` to make on its own side of the boundary
 * (§112), its words, and — only the night pill's (§394) — a tooltip that says why. `srSuffix`
 * adds extra words a screen reader reads right after `label`, never shown, while the visible
 * word stays the closed set's own — the listing card's cost pill on an `EXTERNAL`-registration
 * `PAID` event still reads "Cu taxă" so every card's pill says the same short word, and a screen
 * reader alone is told the fee goes to the organizer (`DECISIONS.md` §394); the difficulty pill's
 * «Mediu» is followed, for a screen reader, by the field's own name, «Dificultate». Content, not an
 * `aria-label` override: MUI's `Chip` is a plain, roleless `<div>` when it is not clickable, and
 * ARIA 1.2 does not allow naming a generic element, so the extra words have to be in the chip's
 * own text (visually hidden) rather than on the attribute.
 */
export type Pill = { glyph: GlyphName; label: string; tooltip?: string; srSuffix?: string };

/** What a row has to carry to build the route's pills: the closed sets and the two numbers of a
 * route, the cost, and the start, its end, its programme, its zone and the night override (§394:
 * whether this date is a night event is its start-to-end span's question, against the sunset) —
 * the same columns on the public event row and the backoffice's own (`EditableEvent`), so one
 * function serves both without either module importing the other's. */
export type RouteFactsSource = Pick<
  typeof events.$inferSelect,
  | "type"
  | "surface"
  | "difficulty"
  | "distanceMeters"
  | "elevationGainMeters"
  | "nightOverride"
  | "startsAt"
  | "endsAt"
  | "scheduleItems"
  | "timezone"
  | "costType"
  | "registrationMode"
  // The event's own place, where its sun is read (§428, by §416's rule): the map link's pin, the
  // typed pair, and whether the place is still to be announced.
  | "mapUrl"
  | "latitude"
  | "longitude"
  | "locationToBeAnnounced"
>;

/** A translator narrow enough for `buildRoutePills`: every call it makes is a plain key with an
 * optional value map, which is how `next-intl`'s own translator is called everywhere else here.
 * A narrow structural type, not the translator's own richer, overloaded signature — the untyped
 * `next-intl` translator this repository gets from `getTranslations` (no `AppConfig` declared,
 * so its keys are plain strings) satisfies it structurally, with no cast at the call site. */
type Translate = { (key: string, values?: Record<string, string | number>): string };
/** A formatter narrow enough for `buildRoutePills`: only the one method it calls, and only the
 * one option (`maximumFractionDigits`) it ever passes — the same narrowing as `Translate`. */
type FormatNumber = { number(value: number, options?: { maximumFractionDigits?: number }): string };

/**
 * The route's pills, in one fixed order (§366, amended §375 — the owner, 2026-09-24, of the
 * card's pills reading "8 km · 250 m D+ · Mediu · Trail": "The order of this should be: terrain
 * type, difficulty, distance, elevation"): **surface, difficulty, distance, elevation**, then the
 * **night event** (§394, at the place §382 gave the headlamp — the crescent and «Noapte» since
 * §428, when the dark falls on that route, after what the route is) — then the cost pill after
 * them wherever a caller adds one. The slot keeps its name, `headlamp`.
 *
 * One function decides the order for both surfaces that draw route pills — the listing card
 * (`EventFacts`'s compact form) and the event page (`EventFacts`'s stacked form, §356) — so
 * neither can drift from the other. Each caller builds its own pills (a pill exists only for
 * what the club stated) and hands them here; a pill the caller leaves out (`null` or
 * `undefined`) is simply absent from the result, never a gap in the order.
 */
export function orderRoutePills(pills: {
  surface?: Pill | null;
  difficulty?: Pill | null;
  distance?: Pill | null;
  elevation?: Pill | null;
  headlamp?: Pill | null;
}): Pill[] {
  return [pills.surface, pills.difficulty, pills.distance, pills.elevation, pills.headlamp].filter((pill): pill is Pill => pill != null);
}

/**
 * The route's five pills, built but not yet ordered or filtered to a set — a pill only for what
 * the club stated, `null` for what it did not. The one place that builds a pill from the event's
 * own columns (surface, difficulty, distance, elevation, headlamp), so `buildRoutePills` (the
 * compact card and the backoffice's own list) and `EventFacts`'s own stacked variant (the event
 * page, §356) read the same five pills rather than five each of their own that could drift apart.
 * `orderRoutePills` still decides which of the five a caller shows and in what order — the event
 * page leaves the surface out unless another route pill or link already earns the row (the
 * overline beside the event's type already says it, BR-REQ-010-01); the card always includes it.
 */
export function routePillParts(
  event: RouteFactsSource,
  t: Translate,
  format: FormatNumber,
): { surface: Pill | null; difficulty: Pill | null; distance: Pill | null; elevation: Pill | null; headlamp: Pill | null } {
  const distance = distanceInKm(event.distanceMeters);
  const distancePill: Pill | null =
    distance !== null ? { glyph: "distance", label: t("distanceKm", { km: format.number(distance, { maximumFractionDigits: 1 }) }) } : null;
  const elevationPill: Pill | null = event.elevationGainMeters
    ? { glyph: "elevation", label: t("elevationShort", { m: format.number(event.elevationGainMeters) }) }
    : null;
  const difficultyPill: Pill | null = event.difficulty
    ? {
        glyph: `difficulty:${event.difficulty}`,
        label: t(`difficultyValues.${event.difficulty}`),
        // The visible word alone — «Mediu» — says a level without saying of what; a screen reader
        // hears «Mediu — Dificultate» through the same `srSuffix` the external cost pill uses, the
        // field's own catalogue label (`Event.difficulty`), never a string written here.
        srSuffix: t("difficulty"),
      }
    : null;
  const surfacePill: Pill | null = event.surface ? { glyph: `surface:${event.surface}`, label: t(`surface.${event.surface}`) } : null;
  return { surface: surfacePill, difficulty: difficultyPill, distance: distancePill, elevation: elevationPill, headlamp: nightPill(event, t) };
}

/**
 * «Noapte» / «Night» (§394, §428): the crescent moon, the one word, and the tooltip "Soarele apune
 * la 16:36" — the sunset alone (§415) — or null on a date that is not one. The answer is this
 * row's own date's, at the event's own place (`clubNightEvent`): a series' dates are rows of their
 * own, so the listing's one line for a series, which draws its next date, says the next date's
 * answer.
 *
 * The word is one for every type (§428, replacing §394's «Alergare de noapte» / «Eveniment de
 * noapte» on the pill): a pill is a fact beside its neighbours — «Trail», «10 km», «Gratuit» — and
 * the card's type chip already says whether it is a run, and the tooltip — which a screen reader
 * hears as the chip's description — says the sunset. The calendar entry, the `.ics` line and the
 * reminder keep the full label by type in their sentences (`nightLine`), where the word stands
 * alone with no chip beside it.
 */
export function nightPill(
  event: Pick<
    RouteFactsSource,
    "type" | "nightOverride" | "startsAt" | "endsAt" | "scheduleItems" | "timezone" | "mapUrl" | "latitude" | "longitude" | "locationToBeAnnounced"
  >,
  t: Translate,
): Pill | null {
  const facts = clubNightEvent(event);
  if (!facts.night) return null;
  // The tooltip names the sunset alone (§415). `GlyphChip` only opens the tooltip on hover or
  // focus, so a chip that is itself a plain, unfocusable `div` never lets a keyboard or
  // screen-reader user reach it (`aria-describedby` is only set while MUI's `Tooltip` is open).
  // `srSuffix` renders the same sentence as a visually hidden span inside the chip's own
  // accessible name instead, so it is heard unconditionally (§428).
  const tooltip = nightTooltip(facts, t);
  return {
    glyph: "night",
    label: t("night.chip"),
    ...(tooltip ? { tooltip, srSuffix: tooltip } : {}),
  };
}

/**
 * The route's pills, built and ordered in one call — surface, difficulty, distance, elevation,
 * headlamp, then the cost's own closed-set word (§343: no amount, no link — those are the event
 * page's own cost row) — a pill only for what the club stated, nothing at all when it stated
 * none.
 *
 * A pure function, not a component: it takes the translator and the formatter its caller already
 * has (`getTranslations("Event")`, `getFormatter()`), so it can be called from a synchronous
 * render — a table column, a card — without nesting an async Server Component inside another
 * one, which `react-dom/server`'s static renderer cannot resolve. `RoutePills` (below) renders
 * the array this returns; it is the one function both surfaces (the listing card's compact facts
 * and the backoffice's own event list) call, so neither reads the route in a different order or
 * a different set from the other.
 *
 * The cost pill's word stays the closed set's own — "Cu taxă" — but on an `EXTERNAL`-registration
 * `PAID` event a screen reader alone is told the fee goes to the organizer, never the club
 * (`DECISIONS.md` §394, `GlyphChip`'s `srSuffix`): the one place that decides it, so the event
 * page's compact card and the backoffice's own list cannot read the pill differently.
 */
export function buildRoutePills(event: RouteFactsSource, t: Translate, format: FormatNumber): Pill[] {
  const parts = routePillParts(event, t, format);
  const pills = orderRoutePills(parts);
  if (event.costType) {
    pills.push({
      glyph: `cost:${event.costType}`,
      label: t(`costValues.${event.costType}`),
      srSuffix: costPaidToExternalOrganizer(event) ? t("costPaidExternalSrSuffix") : undefined,
    });
  }
  return pills;
}
