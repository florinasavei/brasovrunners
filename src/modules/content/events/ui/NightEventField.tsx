"use client";

import FormControlLabel from "@mui/material/FormControlLabel";
import Radio from "@mui/material/Radio";
import RadioGroup from "@mui/material/RadioGroup";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { useEffect, useRef, useState } from "react";
import { type CalendarDayWords, composeCalendarDay } from "@/i18n/dates";
import { NIGHT_CHOICES, type NightChoice, type NightEventFacts, nightShape, nightSpan } from "@/modules/events/domain/night";
import { type Coordinates, sunTimes, wallClockTime } from "@/modules/events/domain/sun";
import { fromWallTimeInput } from "@/modules/events/domain/zoned-time";
import { paintedScheduler } from "@/shared/forms/after-paint";
import { fillIn } from "@/shared/forms/fill-in";
import { useRecall } from "@/shared/forms/recall";
import { CHECKBOX_TAP_TARGET } from "@/shared/ui/tap-target";

export type NightEventWords = {
  label: string;
  choices: Readonly<Record<NightChoice, string>>;
  /** "Automat: pe {day}, începe la {start}, apusul la {sunset} — {verdict}" — the start named before the sunset (§404). */
  autoLine: string;
  /**
   * "Automat: pe {day}, începe la {start}, înainte de răsăritul de la {sunrise} — {verdict}" (§404):
   * an early-morning night start names that day's sunrise, never the evening's sunset.
   */
  autoLineDawn: string;
  /** "Automat: pe {day}, apusul la {sunset} — alege ora startului" */
  autoLineNoTime: string;
  /** "Automat: alege data startului și se calculează aici." */
  autoLineNoDate: string;
  verdictNight: string;
  verdictDay: string;
  /** "… alergarea ține până la {end} …" — shown only when the start alone was not dark and the end came from «Durata» (§394). */
  endLine: string;
  /** "… programul zilei ține până la {end} (ultimul punct) …" — the same, when the end is the day's last programme row. */
  endLineProgramme: string;
  /** "Într-o serie, fiecare dată urmează apusul zilei ei …" */
  series: string;
  /** The day's words, written on the server (§324): the island formats no date itself. */
  day: CalendarDayWords;
};

/** One programme row as the form posts it (`event.schedule[i].<box>`, §117): wall-clock strings. */
export type NightProgrammeRow = { date: string; time: string; endTime: string };

const WALL_TIME = /^\d{2}:\d{2}$/;
/** One array for "no rows", so the effect's dependency does not change on every render. */
const NO_ROWS: readonly NightProgrammeRow[] = [];

/**
 * The span's end as the form stands, by the server's own rule (`night.ts#occurrenceSpanEnd`,
 * §394): «Durata»'s minutes added to the start when the box has a number — the event's own end;
 * else the latest programme row on the start's own date (its end time, or its start when it has
 * none); else none.
 */
function formSpanEnd(
  startsAt: Date,
  start: { date: string; timeZone: string },
  durationMinutes: number | null | undefined,
  programme: readonly NightProgrammeRow[],
): { end: Date; source: "event" | "programme" } | null {
  if (durationMinutes && durationMinutes > 0) return { end: new Date(startsAt.getTime() + durationMinutes * 60_000), source: "event" };
  const latest = programme
    .filter((row) => row.date === start.date && WALL_TIME.test(row.time))
    .map((row) => fromWallTimeInput(`${row.date}T${WALL_TIME.test(row.endTime) ? row.endTime : row.time}`, start.timeZone))
    .reduce<Date | null>((max, end) => (end && (!max || end.getTime() > max.getTime()) ? end : max), null);
  return latest ? { end: latest, source: "programme" } : null;
}

/**
 * The automatic answer's line, from the boxes as they stand: the event's day in words, its sunset
 * and the verdict (§394) — decided by the **whole span**, not the start alone, with the server's
 * own end rule (`formSpanEnd`) and its own span test (`nightSpan`): a run that starts in daylight
 * and finishes after dusk is a night run, and `endLine` (null otherwise) says until when and
 * whether «Durata» or the programme said so. Pure — the island reads the form and hands the
 * strings here — and the same `sun.ts` the server's pill asks, so the line cannot promise what
 * the page will not show.
 */
export function nightAutoLine(
  words: Pick<NightEventWords, "autoLine" | "autoLineDawn" | "autoLineNoTime" | "autoLineNoDate" | "verdictNight" | "verdictDay" | "endLine" | "endLineProgramme" | "day">,
  start: { date: string; time: string; timeZone: string },
  place: Coordinates,
  durationMinutes?: number | null,
  programme: readonly NightProgrammeRow[] = [],
): { line: string; endLine: string | null } {
  const day = composeCalendarDay(start.date, words.day);
  const sun = day ? sunTimes(start.date, place) : null;
  if (!day || !sun) return { line: words.autoLineNoDate, endLine: null };
  const sunset = sun.sunset ? wallClockTime(sun.sunset, start.timeZone) : "—";
  if (!WALL_TIME.test(start.time)) return { line: fillIn(words.autoLineNoTime, { day, sunset }), endLine: null };
  const startsAt = fromWallTimeInput(`${start.date}T${start.time}`, start.timeZone);
  const spanEnd = startsAt ? formSpanEnd(startsAt, start, durationMinutes, programme) : null;
  const { night, nightAtStart } = nightSpan(startsAt, spanEnd?.end ?? null, place, start.timeZone);
  const sunrise = sun.sunrise ? wallClockTime(sun.sunrise, start.timeZone) : null;
  const verdict = night ? words.verdictNight : words.verdictDay;
  // The start is named before the sunset, so the sunset is never read as the start (§404) — and the
  // shape (Dawn, End, EndProgramme, After or plain) is `nightShape`'s own answer, the same rule the
  // calendar and the reminder ask, never decided a second time here; the pill's tooltip names only
  // the sunset (§415) and asks nothing of it.
  const named = night && !nightAtStart && spanEnd ? spanEnd.source : null;
  const facts: NightEventFacts = {
    night,
    source: "automatic",
    start: start.time,
    sunset,
    sunrise,
    endSource: named,
    end: named && spanEnd ? wallClockTime(spanEnd.end, start.timeZone) : null,
  };
  const shape = nightShape(facts);
  const line =
    shape?.suffix === "Dawn"
      ? fillIn(words.autoLineDawn, { day, start: start.time, sunrise: shape.values.sunrise, verdict })
      : fillIn(words.autoLine, { day, start: start.time, sunset, verdict });
  if (!shape?.values.end) return { line, endLine: null };
  return { line, endLine: fillIn(shape.suffix === "EndProgramme" ? words.endLineProgramme : words.endLine, { end: shape.values.end }) };
}

/** The programme rows the form posts, gathered by index — `ScheduleRowsEditor`'s own names. */
function programmeRowsOf(data: FormData): NightProgrammeRow[] | null {
  const rows = new Map<number, NightProgrammeRow>();
  for (const [name, value] of data.entries()) {
    const match = /^event\.schedule\[(\d+)\]\.(date|time|endTime)$/.exec(name);
    if (!match) continue;
    const row = rows.get(Number(match[1])) ?? { date: "", time: "", endTime: "" };
    row[match[2] as keyof NightProgrammeRow] = String(value).trim();
    rows.set(Number(match[1]), row);
  }
  return rows.size > 0 ? [...rows.values()] : null;
}

const sameRows = (a: readonly NightProgrammeRow[], b: readonly NightProgrammeRow[]) =>
  a.length === b.length && a.every((row, i) => row.date === b[i].date && row.time === b[i].time && row.endTime === b[i].endTime);

/**
 * "Eveniment de noapte" in the "Traseul" card (§394, replacing §382's "Necesită frontală"
 * checkbox): Automat (după apus) / Da / Nu, and under it the automatic answer for the date in the
 * "Data și ora" card — recomputed as the date, the time or the zone is changed, so the organizer
 * sees what "Automat" will say before saving. A client island because it follows other boxes of the
 * form; the coordinates come from the server (the saved event's own place, `nightPlace`, §428;
 * `CLUB_COORDINATES` on the create page), the words too.
 *
 * On a series (the editor's `inSeries`, or the create page's "Se repetă" ticked) one more sentence
 * says each date follows its own sunset. After a refused submit the choice comes back as posted (§315).
 */
export default function NightEventField({
  name,
  defaultChoice,
  place,
  zone,
  start,
  durationMinutes = null,
  programme = NO_ROWS,
  inSeries = false,
  seriesToggleName,
  words,
}: {
  name: string;
  defaultChoice: NightChoice;
  place: Coordinates;
  /** The event's zone as the page rendered it; the form's own "event.timezone" wins once read. */
  zone: string;
  /** The start as the page rendered it (the editor's), `YYYY-MM-DD` and `HH:mm`; read from the form after. */
  start: { date: string; time: string };
  /** «Durata» as the page rendered it (the saved end minus the start), for the first paint; read from the form after. */
  durationMinutes?: number | null;
  /** The saved programme rows on the event's clock, for the first paint and a form without the programme's boxes. */
  programme?: readonly NightProgrammeRow[];
  inSeries?: boolean;
  /** On create: the box that turns the series on, whose tick shows the series sentence. */
  seriesToggleName?: string;
  words: NightEventWords;
}) {
  const recall = useRecall();
  const root = useRef<HTMLDivElement>(null);
  const [live, setLive] = useState({ date: start.date, time: start.time, timeZone: zone, series: inSeries, durationMinutes, programme });

  useEffect(() => {
    const form = root.current?.closest("form");
    if (!form) return;
    const read = () => {
      const data = new FormData(form);
      const text = (field: string) => String(data.get(field) ?? "");
      const duration = Number(text("event.durationMinutes"));
      const next = {
        date: text("event.startsAtDate") || (form.querySelector('[name="event.startsAtDate"]') ? "" : start.date),
        time: text("event.startsAtTime") || (form.querySelector('[name="event.startsAtTime"]') ? "" : start.time),
        timeZone: text("event.timezone") || zone,
        series: inSeries || (seriesToggleName ? data.get(seriesToggleName) === "on" : false),
        // "Cât durează" (§71), added to the start (§394): a run that finishes after dusk is a
        // night run even from a daylight start. No box, or not a number, means no end to name.
        durationMinutes: Number.isFinite(duration) && duration > 0 ? duration : null,
        // The programme's rows (§117), the end when «Durata» is empty — the server's own order
        // (§394). A form without the programme's boxes keeps the saved rows.
        programme: programmeRowsOf(data) ?? programme,
      };
      // The same answer keeps the same object, so a keystroke elsewhere in the form renders nothing here.
      setLive((current) =>
        current.date === next.date &&
        current.time === next.time &&
        current.timeZone === next.timeZone &&
        current.series === next.series &&
        current.durationMinutes === next.durationMinutes &&
        sameRows(current.programme, next.programme)
          ? current
          : next,
      );
    };
    // After the frame the keystroke leads to, once for a burst (§371), like the Recurență sentence.
    const scheduler = paintedScheduler(read);
    read();
    form.addEventListener("change", scheduler.schedule);
    form.addEventListener("input", scheduler.schedule);
    return () => {
      form.removeEventListener("change", scheduler.schedule);
      form.removeEventListener("input", scheduler.schedule);
      scheduler.cancel();
    };
  }, [start.date, start.time, zone, inSeries, seriesToggleName, programme]);

  const posted = recall.value(name);
  const initial = recall.has && posted && (NIGHT_CHOICES as readonly string[]).includes(posted) ? (posted as NightChoice) : defaultChoice;
  const auto = nightAutoLine(words, live, place, live.durationMinutes, live.programme);

  return (
    <Stack ref={root} spacing={0.5} data-testid="night-event-field">
      <Typography variant="body2" id={`${recall.idOf(name)}-label`}>
        {words.label}
      </Typography>
      <RadioGroup key={recall.generation} row name={name} defaultValue={initial} aria-labelledby={`${recall.idOf(name)}-label`}>
        {NIGHT_CHOICES.map((choice) => (
          <FormControlLabel key={choice} value={choice} control={<Radio sx={CHECKBOX_TAP_TARGET} />} label={words.choices[choice]} />
        ))}
      </RadioGroup>
      <Typography variant="body2" color="text.secondary" data-testid="night-auto-line" role="status">
        {auto.line}
      </Typography>
      {auto.endLine && (
        <Typography variant="body2" color="text.secondary" data-testid="night-end-line">
          {auto.endLine}
        </Typography>
      )}
      {live.series && (
        <Typography variant="body2" color="text.secondary" data-testid="night-series-line">
          {words.series}
        </Typography>
      )}
    </Stack>
  );
}
