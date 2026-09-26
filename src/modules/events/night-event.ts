import { forecastPlace, type PlaceColumns } from "@/modules/weather/domain/place";
import { env } from "@/shared/config/env";
import { nightEvent, type NightEventFacts, type NightEventSource, nightShape } from "./domain/night";
import type { Coordinates } from "./domain/sun";

/**
 * Where an event's sun is read (§NNN, amending §394): **the event's own place**, by the one rule the
 * forecast already follows (§416's `forecastPlace`) — the map link's pin, else the typed
 * «Coordonate», else the club's place (`CLUB_COORDINATES`), and the club's while the place is still
 * to be announced (§328), since no public reader is handed the real one then. A race in Cluj sets
 * its sun over Cluj — a few minutes from Brașov's, which is enough to move a verdict at dusk — and
 * the pill, the forecast and the map the page links to all read one point. Every surface's row
 * already carries these columns (the public row withholds them while the place is to be announced,
 * and the flag says so to the backoffice's own), so no reader passes a place of its own.
 */
export function nightPlace(event: PlaceColumns): Coordinates {
  return forecastPlace(event, env.CLUB_COORDINATES).coordinates;
}

/**
 * `nightEvent` at the event's own place (`nightPlace`, §NNN; the club's `CLUB_COORDINATES` when it
 * names none, §394) — the binding every server surface calls, so the place is resolved in one
 * place. The occurrence is the row's own start unless the caller names another: a series' dates are
 * rows of their own (§113), each with its own start and so its own sunset.
 */
export function clubNightEvent(
  event: NightEventSource & PlaceColumns & { startsAt: Date },
  occurrenceStartsAt: Date | null = event.startsAt,
): NightEventFacts {
  return nightEvent(event, occurrenceStartsAt, nightPlace(event));
}

type Translate = (key: string, values?: Record<string, string | number>) => string;

/**
 * The pill's tooltip (§394, §415) — the sunset alone, "Soarele apune la 16:44": the owner, 2026-09-25,
 * "la alergarea de noapte, pe tooltip trebuie doar să zic când apune soarele". §404's five shapes
 * (naming the start, and the end when it is the reason) stay on the calendar entry, the `.ics`
 * line and the reminder (`nightLine`) — only the tooltip was asked to say one thing. Null when the
 * day has no sunset to name (a polar day or night).
 *
 * On a pre-dawn start (`nightShape`'s `Dawn` case, e.g. a 06:30 run) the day's sunset is hours
 * after the run ends and reads as useless there — the tooltip names the sunrise instead (§415).
 * `t` is the `Event` namespace.
 */
export function nightTooltip(facts: NightEventFacts, t: Translate): string | null {
  if (nightShape(facts)?.suffix === "Dawn") return t("night.tooltipDawn", { sunrise: facts.sunrise as string });
  return facts.sunset ? t("night.tooltip", { sunset: facts.sunset }) : null;
}

/**
 * The calendar entry's line («Alergare de noapte: începe la 19:00, apusul la 19:00, …») or the
 * `.ics` description's (the same, then «— ia o frontală»), §394, §404: the label by type — a group
 * run is «Alergare de noapte» — then the same times `nightShape` names. The label alone when there
 * is no time to name. (The pill's tooltip is a different sentence, the sunset alone, §415; the
 * pill's own word is the short «Noapte», §NNN — a sentence keeps the longer label.)
 */
export function nightLine(facts: NightEventFacts, t: Translate, groupRun: boolean, kind: "calendar" | "ics"): string {
  const label = t(groupRun ? "night.runPill" : "night.pill");
  const shape = nightShape(facts);
  if (!shape) return label;
  return t(`night.${kind}`, { label, times: t(`night.times${shape.suffix}`, shape.values) });
}
