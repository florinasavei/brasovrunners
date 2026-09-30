import type { events } from "@/db/schema/events";
import { costPaidToExternalOrganizer } from "../domain/cost";
import { difficultyLevelOf, difficultyWords, type DifficultyTooltipBlock, type StoredDifficulty } from "../domain/difficulty";
import { distanceWords, type DistanceSource } from "../domain/distance";
import { elevationWords, type ElevationSource } from "../domain/elevation";
import { clubNightEvent, nightTooltip } from "../night-event";
import { difficultyLevelGlyph } from "./difficulty-glyphs";
import type { GlyphName } from "./glyphs";

/**
 * A pill's content: its glyph by name, for `GlyphChip` to make on its own side of the boundary
 * (§112), its words, and — the night pill's (§394) and the difficulty's (§528) — a tooltip that says why. `srSuffix`
 * adds extra words a screen reader reads right after `label`, never shown, while the visible
 * word stays the closed set's own — the listing card's cost pill on an `EXTERNAL`-registration
 * `PAID` event still reads "Cu taxă" so every card's pill says the same short word, and a screen
 * reader alone is told the fee goes to the organizer (`DECISIONS.md` §394). `srLabel` replaces
 * the words a screen reader hears altogether: the difficulty pill shows «Mediu» beside its gauge and is heard as
 * «Dificultate: mediu — nivelul 5 din 15 (mediu: 4–6)» (§526, §563). Content, not an
 * `aria-label` override: MUI's `Chip` is a plain, roleless `<div>` when it is not clickable, and
 * ARIA 1.2 does not allow naming a generic element, so the extra words have to be in the chip's
 * own text (visually hidden) rather than on the attribute.
 */
export type Pill = {
  glyph: GlyphName;
  label: string;
  tooltip?: string;
  srSuffix?: string;
  /** What a screen reader hears in place of `label` (the visible words are then hidden from it) — §526. */
  srLabel?: string;
  /**
   * The pill's words where no glyph is drawn beside them (an email's facts, §392) and the glyph
   * said something the word does not — the difficulty's level of fifteen (§563): «Mediu, nivelul 5 din 15».
   * Absent, `label` is the whole of it.
   */
  plain?: string;
  /** The difficulty's tooltip as a block, the level in bold and the ladder in rows (§566); drawn in place of `tooltip`'s text. */
  tooltipBlock?: DifficultyTooltipBlock;
};

/** What a row has to carry to build the route's pills: the closed sets and the two numbers of a
 * route, the cost, and the start, its end, its programme, its zone and the night override (§394:
 * whether this date is a night event is its start-to-end span's question, against the sunset) —
 * the same columns on the public event row and the backoffice's own (`EditableEvent`), so one
 * function serves both without either module importing the other's. */
export type RouteFactsSource = Pick<
  typeof events.$inferSelect,
  | "type"
  | "surface"
  | "distanceMeters"
  | "elevationGainMeters"
  | "nightOverride"
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
> &
  // The level on the club's scale of fifteen (§526), the difficulty's one column; optional like
  // `StoredDifficulty`'s, for a cached row from before it.
  Pick<StoredDifficulty, "difficultyLevel"> &
  // «Estimativ» (§585): optional for the same reason — a cached row from before it reads as exact.
  Pick<ElevationSource, "elevationGainEstimated"> &
  // «Aproximativ» (§598), the distance's twin: optional, a cached row from before it reads as exact.
  Pick<DistanceSource, "distanceEstimated"> & {
    /** Null on an event page while the date is to be announced (§533): no date, so no night pill. */
    startsAt: Date | null;
  };

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
  const distancePill = distancePillOf(event, t, format);
  const elevationPill = elevationPillOf(event, t, format);
  const level = difficultyLevelOf(event);
  const difficultyPill: Pill | null = level !== null ? difficultyPillOf(level, t) : null;
  const surfacePill: Pill | null = event.surface ? { glyph: `surface:${event.surface}`, label: t(`surface.${event.surface}`) } : null;
  return { surface: surfacePill, difficulty: difficultyPill, distance: distancePill, elevation: elevationPill, headlamp: nightPill(event, t) };
}

/**
 * The distance's pill (§356, §598): «10 km», or «≈ 10 km» when the club ticked «Aproximativ» — the
 * words from `distanceWords`, the one function every surface reads. An approximate distance also
 * carries the long form, «circa 10 km (aproximativ)», as its tooltip, as what a screen reader hears
 * (`srLabel`) and as the emails' words (`plain`, §392), exactly as the climb's pill does (§585).
 */
function distancePillOf(event: RouteFactsSource, t: Translate, format: FormatNumber): Pill | null {
  const words = distanceWords(event, t, (km) => format.number(km, { maximumFractionDigits: 1 }));
  if (!words) return null;
  if (!words.estimated) return { glyph: "distance", label: words.short };
  return { glyph: "distance", label: words.short, tooltip: words.long, srLabel: words.long, plain: words.long };
}

/**
 * The climb's pill (§356, §585): «350 m D+», or «≈ 350 m D+» when the club ticked «Estimativ» —
 * the words from `elevationWords`, the one function every surface reads. An estimate also carries
 * the long form, «circa 350 m diferență de nivel (estimativ)», as its tooltip, as what a screen
 * reader hears (`srLabel`, so «≈» is never read out as a bare sign) and as the emails' words
 * (`plain`, §392): no surface shows the number without saying it is a guess.
 */
function elevationPillOf(event: RouteFactsSource, t: Translate, format: FormatNumber): Pill | null {
  const words = elevationWords(event, t, (value) => format.number(value));
  if (!words) return null;
  if (!words.estimated) return { glyph: "elevation", label: words.short };
  return { glyph: "elevation", label: words.short, tooltip: words.long, srLabel: words.long, plain: words.long };
}

/**
 * The difficulty's pill for a level on the club's scale of fifteen (§526): the gauge of the level
 * (the band's segments lit, the needle at the step, its dots), and **the band alone** in words —
 * «Mediu» (§566: the owner, 2026-09-29 19:08, «the sub indicator is enough» — the dots say the step,
 * the tooltip the level; a number beside them said it a third time). Every word from
 * `difficultyWords`, the one function every surface reads, never a string written here.
 *
 * **The tooltip is two lines (§528, §563)**: the level of fifteen, «Mediu — nivelul 5 din 15», then
 * the whole ladder, «ușor 1–3 · mediu 4–6 · greuț 7–9 · greu 10–12 · foarte greu 13–15»
 * (`difficultyLadder`); never an example, which would say a non-Tâmpa «Mediu 4» is the Tâmpa run
 * (the examples live in the backoffice «?» and «Ghid» only). A screen reader hears it once, in
 * `srLabel`, in the shorter form with the band's own range — «Dificultate: mediu — nivelul 5 din 15
 * (mediu: 4–6)» — so no `srSuffix` repeats it,
 * and `GlyphChip` leaves the tooltip's description off for a chip with its own `srLabel`.
 */
function difficultyPillOf(level: number, t: Translate): Pill {
  const words = difficultyWords(level, t);
  return {
    glyph: difficultyLevelGlyph(level),
    label: words.short,
    srLabel: words.sr,
    // Where no chip is drawn — the emails' facts block (§392): «Mediu, nivelul 5 din 15».
    plain: words.plain,
    tooltip: words.tooltip,
    // Drawn as a block (§566): «Mediu — nivelul 5 din 15» in bold, then one aligned row per band.
    tooltipBlock: words.block,
  };
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
  const { startsAt } = event;
  if (startsAt === null) return null;
  const facts = clubNightEvent({ ...event, startsAt });
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
