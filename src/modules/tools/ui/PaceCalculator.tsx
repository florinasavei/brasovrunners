"use client";

import OutlinedFlagIcon from "@mui/icons-material/OutlinedFlag";
import Box from "@mui/material/Box";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useRef, useState, type ChangeEvent, type FormEvent } from "react";
import PressButton from "@/shared/ui/PressButton";
import QuietHelp from "@/shared/ui/QuietHelp";
import RadioField from "@/shared/ui/RadioField";
import {
  convertDistance,
  convertPace,
  type DistanceUnit,
  durationSeconds,
  formatDuration,
  type PaceResult,
  type PaceSolve,
  parseDecimal,
  RACE_DISTANCES,
  settled,
  solvePace,
  speedPerHour,
  splitDuration,
} from "../pace";

/** What the boxes hold, as typed: text, so a half-typed `21,` stays on the screen while it is wrong. */
type Fields = { distance: string; hours: string; minutes: string; seconds: string; paceMinutes: string; paceSeconds: string };

/**
 * A distance or a pace the calculator wrote into its boxes — an answer carried, a race picked, a unit converted — kept
 * whole while the boxes still show it. The boxes round (four places, whole seconds), so without it a switch would round
 * the run: a marathon moved to miles and back would come back 42,1951 km and seconds slower. Typing in a box lets it go.
 */
type Written = { distance?: { text: string; exact: number }; pace?: { minutes: string; seconds: string; exact: number } };

/** A first answer on the screen before anything is typed: 10 km in 50 minutes, 5:00 a kilometre — consistent, so a switch keeps it. */
const START: Fields = { distance: "10", hours: "0", minutes: "50", seconds: "00", paceMinutes: "5", paceSeconds: "00" };

const FIELDSET_SX = { border: 0, m: 0, p: 0, minWidth: 0 } as const;
const LEGEND_SX = { p: 0, mb: 1, fontWeight: 600 } as const;
/** A duration's box: narrow, three of them fit a 320-pixel phone beside each other. */
const PART_SX = { width: { xs: "5.5rem", sm: "6.5rem" } } as const;

/**
 * «Calculator de ritm» on «Unelte»: the visitor picks which of distance, time and pace to work out (a
 * radio — a choice, never a toggle) and types the other two; the answer, and the speed, follow every
 * keystroke. Kilometres unless «Unitatea de măsură» says miles. Nothing is sent anywhere: no form posts,
 * no button computes. A switch — of what is worked out, or of the unit — keeps the same run on the screen.
 */
export default function PaceCalculator() {
  const t = useTranslations("Tools");
  const locale = useLocale();
  const [solve, setSolve] = useState<PaceSolve>("pace");
  const [unit, setUnit] = useState<DistanceUnit>("km");
  const [fields, setFields] = useState<Fields>(START);
  const [written, setWritten] = useState<Written>({});
  const miles = unit === "mi";

  // The distance and the pace as typed — or, while a box still shows what the calculator wrote there, that value unrounded.
  const distance = written.distance?.text === fields.distance ? written.distance.exact : parseDecimal(fields.distance);
  const pace =
    written.pace?.minutes === fields.paceMinutes && written.pace.seconds === fields.paceSeconds
      ? written.pace.exact
      : durationSeconds("", fields.paceMinutes, fields.paceSeconds);
  const result = solvePace(solve, {
    distance,
    timeSeconds: durationSeconds(fields.hours, fields.minutes, fields.seconds),
    paceSeconds: pace,
  });

  // The field's own spelling of a distance: the locale's decimal sign, no grouping, four places for a half marathon. Both
  // spellings round a settled value, so a conversion's float residue never tips a figure on a boundary (`settled`).
  const distanceText = (value: number) => new Intl.NumberFormat(locale, { maximumFractionDigits: 4, useGrouping: false }).format(settled(value));
  const shownNumber = (value: number, digits: number) => new Intl.NumberFormat(locale, { maximumFractionDigits: digits }).format(settled(value));

  // Each key spelled out, so the catalogue's checker sees every message the island asks for.
  const raceLabel: Record<(typeof RACE_DISTANCES)[number]["key"], string> = {
    preset5: t("pace.preset5"),
    preset10: t("pace.preset10"),
    presetHalf: t("pace.presetHalf"),
    presetMarathon: t("pace.presetMarathon"),
  };

  // Typing in a box lets go of what the calculator wrote there: the box is the visitor's again, whatever is typed next.
  const set = (name: keyof Fields) => (event: ChangeEvent<HTMLInputElement>) => {
    const value = event.target.value;
    setFields((previous) => ({ ...previous, [name]: value }));
    if (name === "distance") setWritten((previous) => ({ ...previous, distance: undefined }));
    if (name === "paceMinutes" || name === "paceSeconds") setWritten((previous) => ({ ...previous, pace: undefined }));
  };

  // A distance or a pace into its boxes, the unrounded value kept beside them. Called from a handler, never from a state update.
  const writeDistance = (exact: number, shown = exact): Partial<Fields> => {
    const text = distanceText(shown);
    setWritten((previous) => ({ ...previous, distance: { text, exact } }));
    return { distance: text };
  };
  const writePace = (exact: number): Partial<Fields> => {
    const { hours, minutes, seconds } = splitDuration(exact);
    const boxes = { paceMinutes: String(hours * 60 + minutes), paceSeconds: String(seconds).padStart(2, "0") };
    setWritten((previous) => ({ ...previous, pace: { minutes: boxes.paceMinutes, seconds: boxes.paceSeconds, exact } }));
    return boxes;
  };

  /** The answer, written into the boxes of the value it answered, before that value becomes one the visitor types. */
  const carried = (from: PaceSolve, answer: PaceResult): Partial<Fields> => {
    if (from === "distance") return writeDistance(answer.distance, Math.round(answer.distance * 100) / 100);
    if (from === "time") {
      const { hours, minutes, seconds } = splitDuration(answer.timeSeconds);
      return { hours: String(hours), minutes: String(minutes).padStart(2, "0"), seconds: String(seconds).padStart(2, "0") };
    }
    return writePace(answer.paceSeconds);
  };

  /** «Ce vrei să afli?» set to `next`: the answer carried into the boxes it now needs. From a handler or the mount read below. */
  const applySolve = (next: PaceSolve) => {
    if (next === solve) return;
    if (result) {
      const patch = carried(solve, result);
      setFields((previous) => ({ ...previous, ...patch }));
    }
    setSolve(next);
  };

  /** «Unitatea de măsură» set to `next`: the distance and the pace convert, the time is the time — the same run, in the other unit. */
  const applyUnit = (next: DistanceUnit) => {
    if (next === unit) return;
    const patch: Partial<Fields> = {
      ...(distance === null ? {} : writeDistance(convertDistance(distance, unit, next))),
      ...(pace === null ? {} : writePace(convertPace(pace, unit, next))),
    };
    setFields((previous) => ({ ...previous, ...patch }));
    setUnit(next);
  };

  // The radios are native (`RadioField`): their change bubbles to the group, which is the one place that listens.
  const choose = (event: FormEvent<HTMLFieldSetElement>) => applySolve((event.target as HTMLInputElement).value as PaceSolve);
  const switchUnit = (event: FormEvent<HTMLFieldSetElement>) => applyUnit((event.target as HTMLInputElement).value as DistanceUnit);

  /*
    A choice the browser made before the island listened — §337's rule for the phone's country: Firefox restores a radio on
    reload, and a press can land before hydration, each with no change event — would leave the dot saying miles while the
    boxes count kilometres. Read once, right after mount, and taken as if pressed.
  */
  const solveGroup = useRef<HTMLFieldSetElement>(null);
  const unitGroup = useRef<HTMLFieldSetElement>(null);
  useEffect(() => {
    const checked = (group: HTMLFieldSetElement | null) => group?.querySelector<HTMLInputElement>("input:checked")?.value;
    const solveNow = checked(solveGroup.current);
    if (solveNow === "time" || solveNow === "distance") applySolve(solveNow);
    if (checked(unitGroup.current) === "mi") applyUnit("mi");
    // Once, right after mount: the two read this first render's state, which is what the boxes show.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const numeric = (testId: string, mode: "numeric" | "decimal" = "numeric") => ({
    htmlInput: { inputMode: mode, autoComplete: "off", "data-testid": testId },
  });

  // What is worked out and how, in the unit picked: the formula behind the «?», the answer and the speed.
  const formula = miles
    ? `${solve === "pace" ? t("pace.formulaPaceMiles") : solve === "time" ? t("pace.formulaTimeMiles") : t("pace.formulaDistanceMiles")} ${t("pace.formulaSpeedMiles")} ${t("pace.formulaMile")}`
    : `${solve === "pace" ? t("pace.formulaPace") : solve === "time" ? t("pace.formulaTime") : t("pace.formulaDistance")} ${t("pace.formulaSpeed")}`;
  const answer = (shown: PaceResult) => {
    if (solve === "time") return formatDuration(shown.timeSeconds);
    if (solve === "pace") {
      const value = { pace: formatDuration(shown.paceSeconds) };
      return miles ? t("pace.paceResultMiles", value) : t("pace.paceResult", value);
    }
    const value = { distance: shownNumber(shown.distance, 2) };
    return miles ? t("pace.distanceResultMiles", value) : t("pace.distanceResult", value);
  };
  const speed = (shown: PaceResult) => {
    const value = { speed: shownNumber(speedPerHour(shown.paceSeconds), 1) };
    return miles ? t("pace.speedMiles", value) : t("pace.speed", value);
  };

  return (
    <Stack spacing={3} data-testid="pace-calculator">
      <Box component="fieldset" ref={solveGroup} sx={FIELDSET_SX} onChange={choose}>
        <Typography component="legend" sx={LEGEND_SX}>
          {t("pace.solveFor")}
        </Typography>
        <Box sx={{ display: "flex", flexWrap: "wrap", columnGap: 2 }}>
          <RadioField name="solve" value="pace" defaultChecked>
            {t("pace.solvePace")}
          </RadioField>
          <RadioField name="solve" value="time">
            {t("pace.solveTime")}
          </RadioField>
          <RadioField name="solve" value="distance">
            {t("pace.solveDistance")}
          </RadioField>
        </Box>
      </Box>

      {/* The owner, 2026-11-10: «vreau să pot schimba și unitatea de măsură, deși default să fie km și minute». */}
      <Box component="fieldset" ref={unitGroup} sx={FIELDSET_SX} onChange={switchUnit} data-testid="pace-unit">
        <Typography component="legend" sx={LEGEND_SX}>
          {t("pace.unit")}
        </Typography>
        <Box sx={{ display: "flex", flexWrap: "wrap", columnGap: 2 }}>
          <RadioField name="unit" value="km" defaultChecked>
            {t("pace.unitKm")}
          </RadioField>
          <RadioField name="unit" value="mi">
            {t("pace.unitMiles")}
          </RadioField>
        </Box>
      </Box>

      {solve !== "distance" && (
        <Box component="fieldset" sx={FIELDSET_SX}>
          <Typography component="legend" sx={LEGEND_SX}>
            {t("pace.distance")}
          </Typography>
          {/*
            The box and the four races on one row (the owner, 2026-11-09: «asta vreau să fie inline»), the races level with
            the box rather than its help line; a phone too narrow for all of them wraps the rest under it. A race fills in
            its length in the unit picked: the half marathon is 13,1094 miles.
          */}
          <Box sx={{ display: "flex", flexWrap: "wrap", alignItems: "flex-start", columnGap: 2, rowGap: 1 }}>
            <TextField
              label={miles ? t("pace.distanceUnitMiles") : t("pace.distanceUnit")}
              value={fields.distance}
              onChange={set("distance")}
              helperText={t("pace.distanceHelp")}
              error={parseDecimal(fields.distance) === null}
              slotProps={numeric("pace-distance", "decimal")}
              sx={{ width: { xs: "100%", sm: "12rem" } }}
            />
            <Box role="group" aria-label={t("pace.presets")} sx={{ display: "flex", flexWrap: "wrap", gap: 1, pt: 1.5 }}>
              {RACE_DISTANCES.map((race) => (
                <PressButton
                  key={race.key}
                  icon={OutlinedFlagIcon}
                  variant="outlined"
                  size="small"
                  onClick={() => {
                    const patch = writeDistance(convertDistance(race.km, "km", unit));
                    setFields((previous) => ({ ...previous, ...patch }));
                  }}
                  data-testid={`pace-${race.key}`}
                >
                  {raceLabel[race.key]}
                </PressButton>
              ))}
            </Box>
          </Box>
        </Box>
      )}

      {solve !== "time" && (
        <Box component="fieldset" sx={FIELDSET_SX}>
          <Typography component="legend" sx={LEGEND_SX}>
            {t("pace.time")}
          </Typography>
          <Stack direction="row" spacing={1}>
            <TextField label={t("pace.hours")} value={fields.hours} onChange={set("hours")} slotProps={numeric("pace-hours")} sx={PART_SX} />
            <TextField label={t("pace.minutes")} value={fields.minutes} onChange={set("minutes")} slotProps={numeric("pace-minutes")} sx={PART_SX} />
            <TextField label={t("pace.seconds")} value={fields.seconds} onChange={set("seconds")} slotProps={numeric("pace-seconds")} sx={PART_SX} />
          </Stack>
        </Box>
      )}

      {solve !== "pace" && (
        <Box component="fieldset" sx={FIELDSET_SX}>
          <Typography component="legend" sx={LEGEND_SX}>
            {miles ? t("pace.paceMiles") : t("pace.pace")}
          </Typography>
          <Stack direction="row" spacing={1}>
            <TextField label={t("pace.minutes")} value={fields.paceMinutes} onChange={set("paceMinutes")} slotProps={numeric("pace-pace-minutes")} sx={PART_SX} />
            <TextField label={t("pace.seconds")} value={fields.paceSeconds} onChange={set("paceSeconds")} slotProps={numeric("pace-pace-seconds")} sx={PART_SX} />
          </Stack>
        </Box>
      )}

      <Box sx={{ borderTop: 1, borderColor: "divider", pt: 2 }}>
        {/*
          What is worked out, and the «?» with how (the owner, 2026-11-09: «tooltip cu ? cu formula de calcul»): outside the
          live region below, so a screen reader is not read the formula again at every keystroke.
        */}
        {result && (
          <Box sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
            <Typography variant="body2" color="text.secondary">
              {solve === "pace" ? t("pace.solvePace") : solve === "time" ? t("pace.solveTime") : t("pace.solveDistance")}
            </Typography>
            <QuietHelp text={formula} testId="pace-formula-help" />
          </Box>
        )}
        {/* The answer, said once to a screen reader each time it changes. */}
        <Box role="status" aria-live="polite" data-testid="pace-result">
          {result ? (
            <>
              <Typography sx={{ fontSize: { xs: "2rem", sm: "2.5rem" }, fontWeight: 700, lineHeight: 1.2, fontVariantNumeric: "tabular-nums" }}>
                {answer(result)}
              </Typography>
              <Typography variant="body1" color="text.secondary">
                {speed(result)}
              </Typography>
            </>
          ) : (
            <Typography variant="body1" color="text.secondary">
              {t("pace.missing")}
            </Typography>
          )}
        </Box>
      </Box>
    </Stack>
  );
}
