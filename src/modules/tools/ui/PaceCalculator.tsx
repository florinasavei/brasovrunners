"use client";

import OutlinedFlagIcon from "@mui/icons-material/OutlinedFlag";
import Box from "@mui/material/Box";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { useLocale, useTranslations } from "next-intl";
import { useState, type ChangeEvent, type FormEvent } from "react";
import PressButton from "@/shared/ui/PressButton";
import RadioField from "@/shared/ui/RadioField";
import { durationSeconds, formatDuration, type PaceResult, type PaceSolve, parseDecimal, RACE_DISTANCES, solvePace, speedKmh, splitDuration } from "../pace";

/** What the boxes hold, as typed: text, so a half-typed `21,` stays on the screen while it is wrong. */
type Fields = { distance: string; hours: string; minutes: string; seconds: string; paceMinutes: string; paceSeconds: string };

/** A first answer on the screen before anything is typed: 10 km in 50 minutes, 5:00 a kilometre — consistent, so a switch keeps it. */
const START: Fields = { distance: "10", hours: "0", minutes: "50", seconds: "00", paceMinutes: "5", paceSeconds: "00" };

const FIELDSET_SX = { border: 0, m: 0, p: 0, minWidth: 0 } as const;
const LEGEND_SX = { p: 0, mb: 1, fontWeight: 600 } as const;
/** A duration's box: narrow, three of them fit a 320-pixel phone beside each other. */
const PART_SX = { width: { xs: "5.5rem", sm: "6.5rem" } } as const;

/**
 * «Calculator de ritm» on «Unelte»: the visitor picks which of distance, time and pace to work out (a
 * radio — a choice, never a toggle) and types the other two; the answer, and the speed in km/h, follow
 * every keystroke. Nothing is sent anywhere: no form posts, no button computes. A switch carries the
 * last answer into the boxes it now needs, so the three stay one consistent run.
 */
export default function PaceCalculator() {
  const t = useTranslations("Tools");
  const locale = useLocale();
  const [solve, setSolve] = useState<PaceSolve>("pace");
  const [fields, setFields] = useState<Fields>(START);

  const result = solvePace(solve, {
    distanceKm: parseDecimal(fields.distance),
    timeSeconds: durationSeconds(fields.hours, fields.minutes, fields.seconds),
    paceSeconds: durationSeconds("", fields.paceMinutes, fields.paceSeconds),
  });

  // The field's own spelling of a distance: the locale's decimal sign, no grouping, four places for a half marathon.
  const distanceText = (km: number) => new Intl.NumberFormat(locale, { maximumFractionDigits: 4, useGrouping: false }).format(km);
  const shownNumber = (value: number, digits: number) => new Intl.NumberFormat(locale, { maximumFractionDigits: digits }).format(value);

  // Each key spelled out, so the catalogue's checker sees every message the island asks for.
  const raceLabel: Record<(typeof RACE_DISTANCES)[number]["key"], string> = {
    preset5: t("pace.preset5"),
    preset10: t("pace.preset10"),
    presetHalf: t("pace.presetHalf"),
    presetMarathon: t("pace.presetMarathon"),
  };

  const set = (name: keyof Fields) => (event: ChangeEvent<HTMLInputElement>) => setFields((previous) => ({ ...previous, [name]: event.target.value }));

  /** The answer, written into the boxes of the value it answered, before that value becomes one the visitor types. */
  const carried = (from: PaceSolve, answer: PaceResult): Partial<Fields> => {
    if (from === "distance") return { distance: distanceText(Math.round(answer.distanceKm * 100) / 100) };
    if (from === "time") {
      const { hours, minutes, seconds } = splitDuration(answer.timeSeconds);
      return { hours: String(hours), minutes: String(minutes).padStart(2, "0"), seconds: String(seconds).padStart(2, "0") };
    }
    const { hours, minutes, seconds } = splitDuration(answer.paceSeconds);
    return { paceMinutes: String(hours * 60 + minutes), paceSeconds: String(seconds).padStart(2, "0") };
  };

  // The radios are native (`RadioField`): their change bubbles to the group, which is the one place that listens.
  const choose = (event: FormEvent<HTMLFieldSetElement>) => {
    const next = (event.target as HTMLInputElement).value as PaceSolve;
    if (next === solve) return;
    if (result) setFields((previous) => ({ ...previous, ...carried(solve, result) }));
    setSolve(next);
  };

  const numeric = (testId: string, mode: "numeric" | "decimal" = "numeric") => ({
    htmlInput: { inputMode: mode, autoComplete: "off", "data-testid": testId },
  });

  return (
    <Stack spacing={3} data-testid="pace-calculator">
      <Box component="fieldset" sx={FIELDSET_SX} onChange={choose}>
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

      {solve !== "distance" && (
        <Box component="fieldset" sx={FIELDSET_SX}>
          <Typography component="legend" sx={LEGEND_SX}>
            {t("pace.distance")}
          </Typography>
          <TextField
            label={t("pace.distanceUnit")}
            value={fields.distance}
            onChange={set("distance")}
            helperText={t("pace.distanceHelp")}
            error={parseDecimal(fields.distance) === null}
            slotProps={numeric("pace-distance", "decimal")}
            sx={{ width: { xs: "100%", sm: "12rem" } }}
          />
          <Box role="group" aria-label={t("pace.presets")} sx={{ display: "flex", flexWrap: "wrap", gap: 1, mt: 1.5 }}>
            {RACE_DISTANCES.map((race) => (
              <PressButton
                key={race.key}
                icon={OutlinedFlagIcon}
                variant="outlined"
                size="small"
                onClick={() => setFields((previous) => ({ ...previous, distance: distanceText(race.km) }))}
                data-testid={`pace-${race.key}`}
              >
                {raceLabel[race.key]}
              </PressButton>
            ))}
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
            {t("pace.pace")}
          </Typography>
          <Stack direction="row" spacing={1}>
            <TextField label={t("pace.minutes")} value={fields.paceMinutes} onChange={set("paceMinutes")} slotProps={numeric("pace-pace-minutes")} sx={PART_SX} />
            <TextField label={t("pace.seconds")} value={fields.paceSeconds} onChange={set("paceSeconds")} slotProps={numeric("pace-pace-seconds")} sx={PART_SX} />
          </Stack>
        </Box>
      )}

      {/* The answer, said once to a screen reader each time it changes. */}
      <Box role="status" aria-live="polite" sx={{ borderTop: 1, borderColor: "divider", pt: 2 }} data-testid="pace-result">
        {result ? (
          <>
            <Typography variant="body2" color="text.secondary">
              {solve === "pace" ? t("pace.solvePace") : solve === "time" ? t("pace.solveTime") : t("pace.solveDistance")}
            </Typography>
            <Typography sx={{ fontSize: { xs: "2rem", sm: "2.5rem" }, fontWeight: 700, lineHeight: 1.2, fontVariantNumeric: "tabular-nums" }}>
              {solve === "pace"
                ? t("pace.paceResult", { pace: formatDuration(result.paceSeconds) })
                : solve === "time"
                  ? formatDuration(result.timeSeconds)
                  : t("pace.distanceResult", { distance: shownNumber(result.distanceKm, 2) })}
            </Typography>
            <Typography variant="body1" color="text.secondary">
              {t("pace.speed", { speed: shownNumber(speedKmh(result.paceSeconds), 1) })}
            </Typography>
          </>
        ) : (
          <Typography variant="body1" color="text.secondary">
            {t("pace.missing")}
          </Typography>
        )}
      </Box>
    </Stack>
  );
}
