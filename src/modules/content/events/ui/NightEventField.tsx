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
import { readTypedTime } from "@/shared/forms/pickers/wall-values";
import { useRecall } from "@/shared/forms/recall";
import { CHECKBOX_TAP_TARGET } from "@/shared/ui/tap-target";
import { joinDuration } from "../duration";

export type NightEventWords = {
  label: string;
  choices: Readonly<Record<NightChoice, string>>;
  /** "Automat: {day}, începe la {start}, apusul la {sunset} — {verdict}": the start before the sunset (§404). */
  autoLine: string;
  /** "Automat: {day}, începe la {start}, înainte de răsăritul de la {sunrise} — {verdict}": a pre-dawn start (§404). */
  autoLineDawn: string;
  /** "Automat: {day}, apusul la {sunset} — alege ora startului" */
  autoLineNoTime: string;
  /** "Automat: alege data startului și se calculează aici." */
  autoLineNoDate: string;
  verdictNight: string;
  verdictDay: string;
  /** "… alergarea ține până la {end} …": only when the start was not dark and the end came from «Durata» (§394). */
  endLine: string;
  /** "… programul zilei ține până la {end} (ultimul punct) …": the same, when the end is the last programme row. */
  endLineProgramme: string;
  /** "Într-o serie, fiecare dată urmează apusul zilei ei …" */
  series: string;
  /** The day's words, written on the server (§324). */
  day: CalendarDayWords;
};

/** One programme row as the form posts it (`event.schedule[i].<box>`, §117): wall-clock strings. */
export type NightProgrammeRow = { date: string; time: string; endTime: string };

const WALL_TIME = /^\d{2}:\d{2}$/;
/** One stable array for "no rows", so the effect's dependency does not change on every render. */
const NO_ROWS: readonly NightProgrammeRow[] = [];

/**
 * The span's end as the form stands, by the server's rule (`night.ts#occurrenceSpanEnd`, §394):
 * start + «Durata», else the latest programme row on the start's date (its end, else its start),
 * else none.
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
 * The automatic answer's line from the boxes (§394): judged on the whole span, with the server's
 * own `formSpanEnd` and `nightSpan`, so a run starting in daylight and ending after dusk is a night
 * run and `endLine` says until when. Pure, and the same `sun.ts` as the pill, so the line cannot
 * promise what the page will not show.
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
  // The start is named before the sunset (§404); the shape is `nightShape`'s answer, the rule the
  // calendar and the reminder use, never decided again here.
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

/** The programme rows the form posts, by index (`ScheduleRowsEditor`'s names). */
export function programmeRowsOf(data: FormData): NightProgrammeRow[] | null {
  const rows = new Map<number, NightProgrammeRow>();
  for (const [name, value] of data.entries()) {
    const match = /^event\.schedule\[(\d+)\]\.(date|time|endTime)$/.exec(name);
    if (!match) continue;
    const row = rows.get(Number(match[1])) ?? { date: "", time: "", endTime: "" };
    const box = match[2] as keyof NightProgrammeRow;
    // Typed boxes (§439): read as they will post.
    row[box] = box === "date" ? String(value).trim() : readTypedTime(String(value));
    rows.set(Number(match[1]), row);
  }
  return rows.size > 0 ? [...rows.values()] : null;
}

const sameRows = (a: readonly NightProgrammeRow[], b: readonly NightProgrammeRow[]) =>
  a.length === b.length && a.every((row, i) => row.date === b[i].date && row.time === b[i].time && row.endTime === b[i].endTime);

/**
 * "Eveniment de noapte" in «Traseul» (§394): Automat / Da / Nu, with the automatic answer for the
 * start date recomputed as date, time or zone change. Client to follow other boxes; coordinates
 * and words come from the server (`nightPlace`, §428; `CLUB_COORDINATES` on create). On a series
 * one sentence says each date follows its own sunset. Recalls after a refused submit (§315).
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
  /** The zone as rendered; the form's "event.timezone" wins once read. */
  zone: string;
  /** The start as rendered (`YYYY-MM-DD`, `HH:mm`); read from the form after. */
  start: { date: string; time: string };
  /** «Durata» as rendered, for the first paint; read from the form after. */
  durationMinutes?: number | null;
  /** The saved programme rows on the event's clock, for the first paint and a form without the rows. */
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
      // «Durata» (§433), joined as the save joins it.
      const duration = Number(joinDuration(text("event.durationHours"), text("event.durationMinutesPart")));
      const next = {
        date: text("event.startsAtDate") || (form.querySelector('[name="event.startsAtDate"]') ? "" : start.date),
        // The typed box as it will post («1900» → 19:00, §439), agreeing with the series sentence.
        time: readTypedTime(text("event.startsAtTime")) || (form.querySelector('[name="event.startsAtTime"]') ? "" : start.time),
        timeZone: text("event.timezone") || zone,
        series: inSeries || (seriesToggleName ? data.get(seriesToggleName) === "on" : false),
        // «Durata» added to the start (§394): finishing after dusk makes a night run.
        durationMinutes: Number.isFinite(duration) && duration > 0 ? duration : null,
        // The programme's rows when «Durata» is empty (§394); without their boxes, the saved rows.
        programme: programmeRowsOf(data) ?? programme,
      };
      // The same answer keeps the same object, so an unrelated keystroke renders nothing.
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
    // After the frame, once per burst (§371).
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
