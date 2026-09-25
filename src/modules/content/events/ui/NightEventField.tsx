"use client";

import FormControlLabel from "@mui/material/FormControlLabel";
import Radio from "@mui/material/Radio";
import RadioGroup from "@mui/material/RadioGroup";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { useEffect, useRef, useState } from "react";
import { type CalendarDayWords, composeCalendarDay } from "@/i18n/dates";
import { NIGHT_CHOICES, type NightChoice } from "@/modules/events/domain/night";
import { type Coordinates, isNightEvent, sunTimes, wallClockTime } from "@/modules/events/domain/sun";
import { fromWallTimeInput } from "@/modules/events/domain/zoned-time";
import { paintedScheduler } from "@/shared/forms/after-paint";
import { fillIn } from "@/shared/forms/fill-in";
import { useRecall } from "@/shared/forms/recall";
import { CHECKBOX_TAP_TARGET } from "@/shared/ui/tap-target";

export type NightEventWords = {
  label: string;
  choices: Readonly<Record<NightChoice, string>>;
  /** "Automat: pe {day}, apusul e la {time} — {verdict}" */
  autoLine: string;
  /** "Automat: pe {day}, apusul e la {time} — alege ora startului" */
  autoLineNoTime: string;
  /** "Automat: alege data startului și se calculează aici." */
  autoLineNoDate: string;
  verdictNight: string;
  verdictDay: string;
  /** "Într-o serie, fiecare dată urmează apusul zilei ei …" */
  series: string;
  /** The day's words, written on the server (§324): the island formats no date itself. */
  day: CalendarDayWords;
};

/**
 * The automatic answer's line, from the boxes as they stand: the event's day in words, its sunset
 * and the verdict (§NNN). Pure — the island reads the form and hands the strings here — and the
 * same `sun.ts` the server's pill asks, so the line cannot promise what the page will not show.
 */
export function nightAutoLine(
  words: Pick<NightEventWords, "autoLine" | "autoLineNoTime" | "autoLineNoDate" | "verdictNight" | "verdictDay" | "day">,
  start: { date: string; time: string; timeZone: string },
  place: Coordinates,
): string {
  const day = composeCalendarDay(start.date, words.day);
  const sun = day ? sunTimes(start.date, place) : null;
  if (!day || !sun) return words.autoLineNoDate;
  const time = sun.sunset ? wallClockTime(sun.sunset, start.timeZone) : "—";
  if (!/^\d{2}:\d{2}$/.test(start.time)) return fillIn(words.autoLineNoTime, { day, time });
  const startsAt = fromWallTimeInput(`${start.date}T${start.time}`, start.timeZone);
  const verdict = isNightEvent(startsAt, place, start.timeZone) ? words.verdictNight : words.verdictDay;
  return fillIn(words.autoLine, { day, time, verdict });
}

/**
 * "Eveniment de noapte" in the "Traseul" card (§NNN, replacing §382's "Necesită frontală"
 * checkbox): Automat (după apus) / Da / Nu, and under it the automatic answer for the date in the
 * "Data și ora" card — recomputed as the date, the time or the zone is changed, so the organizer
 * sees what "Automat" will say before saving. A client island because it follows other boxes of the
 * form; the coordinates come from the server (`CLUB_COORDINATES`), the words too.
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
  inSeries?: boolean;
  /** On create: the box that turns the series on, whose tick shows the series sentence. */
  seriesToggleName?: string;
  words: NightEventWords;
}) {
  const recall = useRecall();
  const root = useRef<HTMLDivElement>(null);
  const [live, setLive] = useState({ date: start.date, time: start.time, timeZone: zone, series: inSeries });

  useEffect(() => {
    const form = root.current?.closest("form");
    if (!form) return;
    const read = () => {
      const data = new FormData(form);
      const text = (field: string) => String(data.get(field) ?? "");
      const next = {
        date: text("event.startsAtDate") || (form.querySelector('[name="event.startsAtDate"]') ? "" : start.date),
        time: text("event.startsAtTime") || (form.querySelector('[name="event.startsAtTime"]') ? "" : start.time),
        timeZone: text("event.timezone") || zone,
        series: inSeries || (seriesToggleName ? data.get(seriesToggleName) === "on" : false),
      };
      // The same answer keeps the same object, so a keystroke elsewhere in the form renders nothing here.
      setLive((current) =>
        current.date === next.date && current.time === next.time && current.timeZone === next.timeZone && current.series === next.series ? current : next,
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
  }, [start.date, start.time, zone, inSeries, seriesToggleName]);

  const posted = recall.value(name);
  const initial = recall.has && posted && (NIGHT_CHOICES as readonly string[]).includes(posted) ? (posted as NightChoice) : defaultChoice;

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
        {nightAutoLine(words, live, place)}
      </Typography>
      {live.series && (
        <Typography variant="body2" color="text.secondary" data-testid="night-series-line">
          {words.series}
        </Typography>
      )}
    </Stack>
  );
}
