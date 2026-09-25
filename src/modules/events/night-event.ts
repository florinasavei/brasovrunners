import { env } from "@/shared/config/env";
import { nightEvent, type NightEventFacts, type NightEventSource } from "./domain/night";

/**
 * `nightEvent` at the club's own place (`CLUB_COORDINATES`, §394) — the binding every server
 * surface calls, so the coordinates are read in one place. The occurrence is the row's own start
 * unless the caller names another: a series' dates are rows of their own (§113), each with its
 * own start and so its own sunset.
 */
export function clubNightEvent(event: NightEventSource & { startsAt: Date }, occurrenceStartsAt: Date | null = event.startsAt): NightEventFacts {
  return nightEvent(event, occurrenceStartsAt, env.CLUB_COORDINATES);
}

type Translate = (key: string, values?: Record<string, string | number>) => string;

/**
 * Which of the three shapes a night event's sentence takes (§NNN): the start and the sunset
 * always, and the end only when it is why the date is dark — «Durata»'s end (`End`) or the day's
 * last programme row (`EndProgramme`). The start is named first so the sunset is never read as it.
 */
function nightShape(facts: NightEventFacts): { suffix: "" | "End" | "EndProgramme"; values: Record<string, string> } | null {
  if (!facts.sunset || !facts.start) return null;
  const values = { start: facts.start, sunset: facts.sunset };
  if (!facts.end) return { suffix: "", values };
  return { suffix: facts.endSource === "programme" ? "EndProgramme" : "End", values: { ...values, end: facts.end } };
}

/**
 * The pill's tooltip (§394, §NNN), a sentence of its own: «Începe la 19:00, apusul la 19:00, se
 * termină la 20:40 — ia o frontală» — or null when there is no time to name. `t` is the `Event`
 * namespace.
 */
export function nightTooltip(facts: NightEventFacts, t: Translate): string | null {
  const shape = nightShape(facts);
  return shape ? t(`night.tooltip${shape.suffix}`, shape.values) : null;
}

/**
 * The calendar entry's line («Alergare de noapte: începe la 19:00, apusul la 19:00, …») or the
 * `.ics` description's (the same, then «— ia o frontală»), §394, §NNN: the label by type — a group
 * run is «Alergare de noapte» — then the same times the tooltip names. The label alone when there
 * is no time to name.
 */
export function nightLine(facts: NightEventFacts, t: Translate, groupRun: boolean, kind: "calendar" | "ics"): string {
  const label = t(groupRun ? "night.runPill" : "night.pill");
  const shape = nightShape(facts);
  if (!shape) return label;
  return t(`night.${kind}`, { label, times: t(`night.times${shape.suffix}`, shape.values) });
}
