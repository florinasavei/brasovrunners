"use client";

import FormControlLabel from "@mui/material/FormControlLabel";
import Radio from "@mui/material/Radio";
import RadioGroup from "@mui/material/RadioGroup";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { type ReactNode, useState } from "react";
import { useRecall } from "@/shared/forms/recall";
import { CHECKBOX_TAP_TARGET } from "@/shared/ui/tap-target";
import { readWeatherMode, WEATHER_MODES, type WeatherMode } from "@/modules/weather/domain/mode";
import { ShownWhen } from "./OnlyForType";

export type WeatherModeWords = {
  label: string;
  choices: Readonly<Record<WeatherMode, { label: string; help: string }>>;
  /** «Nu ai scris încă textul…»: `custom` chosen and no language has a text yet — a hint, never a refusal. */
  noNote: string;
};

/**
 * «Vremea» (§NNN): whose weather the page and the reminder show — «Prognoza automată», «Text scris de
 * club» or «Fără vreme» — as three radios, each with its sentence under it, so the choice reads
 * without opening anything. Radios rather than a select because the three need their help visible
 * side by side, and each row is a 44-pixel target (BR-REQ-041-01 criterion 6).
 *
 * The club's text (`children`: the language panels, rendered on the server) shows only while
 * «Text scris de club» is chosen — hidden, never removed, so what was typed is still posted and
 * kept, and switching back finds it (`ShownWhen`). While chosen with no text in any language, the
 * hint says the page will show nothing until one is written: the save is not refused for it.
 */
export default function WeatherModeField({
  name,
  defaultMode,
  hasNote,
  words,
  children,
}: {
  name: string;
  defaultMode: string;
  /** Whether any language has a stored text — read on the server, as saved. */
  hasNote: boolean;
  words: WeatherModeWords;
  children: ReactNode;
}) {
  const recall = useRecall();
  const posted = recall.value(name);
  const initial = recall.has && posted !== undefined ? readWeatherMode(posted) : readWeatherMode(defaultMode);
  const [mode, setMode] = useState<WeatherMode>(initial);
  // A refused save re-mounts the radios with what was posted (§315); the state follows it.
  const [generation, setGeneration] = useState(recall.generation);
  if (generation !== recall.generation) {
    setGeneration(recall.generation);
    setMode(initial);
  }
  const labelId = `${recall.idOf(name)}-label`;

  return (
    <Stack spacing={0.5} data-testid="weather-mode-field">
      <Typography variant="body2" id={labelId}>
        {words.label}
      </Typography>
      <RadioGroup
        key={recall.generation}
        name={name}
        defaultValue={initial}
        aria-labelledby={labelId}
        onChange={(event) => setMode(readWeatherMode(event.target.value))}
      >
        {WEATHER_MODES.map((choice) => (
          <FormControlLabel
            key={choice}
            value={choice}
            data-testid={`weather-mode-${choice}`}
            control={<Radio sx={CHECKBOX_TAP_TARGET} />}
            sx={{ alignItems: "flex-start", py: 0.25 }}
            label={
              <Stack component="span" spacing={0.25} sx={{ pt: 1.25 }}>
                <Typography component="span" variant="body2">
                  {words.choices[choice].label}
                </Typography>
                <Typography component="span" variant="caption" color="text.secondary">
                  {words.choices[choice].help}
                </Typography>
              </Stack>
            }
          />
        ))}
      </RadioGroup>
      <ShownWhen shown={mode === "custom"} answer={mode}>
        <Stack spacing={1}>
          {!hasNote && (
            <Typography variant="body2" color="text.secondary" role="status" data-testid="weather-mode-no-note">
              {words.noNote}
            </Typography>
          )}
          {children}
        </Stack>
      </ShownWhen>
    </Stack>
  );
}
