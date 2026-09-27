"use client";

import Box from "@mui/material/Box";
import SvgIcon from "@mui/material/SvgIcon";
import Typography from "@mui/material/Typography";
import { DIFFICULTY_STEPS, type DifficultyStep } from "@/modules/events/domain/difficulty";
import { useRecall } from "@/shared/forms/recall";

/**
 * Three dots, the first `step` of them lit — the same dots the event's gauge draws under its hub
 * (`DifficultyGaugeIcon`), so the control and the pill say a step the same way. Decorative: the
 * option's number and its accessible name say it.
 */
function StepDotsIcon({ step }: { step: DifficultyStep }) {
  return (
    <SvgIcon viewBox="0 0 24 8" aria-hidden="true" sx={{ width: 24, height: 8 }}>
      {DIFFICULTY_STEPS.map((dot) => (
        <circle key={dot} cx={4 + (dot - 1) * 8} cy={4} r={2.6} fill="currentColor" opacity={dot <= step ? 1 : 0.3} />
      ))}
    </SvgIcon>
  );
}

/**
 * «Treapta» (§NNN): the editor's second difficulty control, beside the band select in «Ce fel de
 * eveniment» — where inside the band the event stands, as a segmented 1 · 2 · 3, each segment with
 * its dots glyph. With the band it is the level on the club's scale of fifteen, which the save
 * writes (`fields.ts`, `difficultyLevel`).
 *
 * Native radios, visually hidden inside their segments, so the choice posts `event.difficultyStep`
 * with or without a script and the keyboard moves through the three as a radio group does; each
 * segment is 44 pixels tall and wide (BR-REQ-041-01 criterion 6). A client component only for the
 * recall after a refused save (§315): the choice that was posted comes back. Words only, as
 * strings — no element crosses from the Server Component that renders it (§370).
 */
export default function DifficultyStepField({
  name,
  defaultStep,
  words,
}: {
  name: string;
  defaultStep: DifficultyStep;
  words: { label: string; help: string; choices: Record<`step${DifficultyStep}`, string> };
}) {
  const recall = useRecall();
  const posted = recall.value(name);
  const initial = recall.has && posted && DIFFICULTY_STEPS.some((step) => String(step) === posted) ? posted : String(defaultStep);
  const labelId = `${recall.idOf(name)}-label`;
  const helpId = `${recall.idOf(name)}-help`;
  return (
    <Box data-testid="difficulty-step-field">
      <Typography variant="body2" id={labelId} color="text.secondary" sx={{ mb: 0.5 }}>
        {words.label}
      </Typography>
      <Box
        key={recall.generation}
        role="radiogroup"
        aria-labelledby={labelId}
        aria-describedby={helpId}
        sx={{ display: "inline-flex", border: 1, borderColor: "divider", borderRadius: 1, overflow: "hidden" }}
      >
        {DIFFICULTY_STEPS.map((step) => (
          <Box
            key={step}
            component="label"
            sx={{
              position: "relative",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              gap: 0.25,
              minWidth: 56,
              minHeight: 44,
              px: 1.5,
              cursor: "pointer",
              color: "text.secondary",
              "& + &": { borderLeft: 1, borderColor: "divider" },
              "&:has(input:checked)": { bgcolor: "primary.main", color: "primary.contrastText" },
              "&:has(input:focus-visible)": { outline: 2, outlineColor: "primary.main", outlineOffset: -4 },
            }}
          >
            <Box
              component="input"
              type="radio"
              name={name}
              value={String(step)}
              defaultChecked={String(step) === initial}
              aria-label={words.choices[`step${step}`]}
              sx={{ position: "absolute", inset: 0, opacity: 0, width: 1, height: 1, m: 0, cursor: "pointer" }}
            />
            <StepDotsIcon step={step} />
            <Typography component="span" variant="body2" sx={{ fontWeight: 600, lineHeight: 1 }} aria-hidden="true">
              {step}
            </Typography>
          </Box>
        ))}
      </Box>
      <Typography variant="caption" color="text.secondary" id={helpId} sx={{ display: "block", mt: 0.5 }}>
        {words.help}
      </Typography>
    </Box>
  );
}
