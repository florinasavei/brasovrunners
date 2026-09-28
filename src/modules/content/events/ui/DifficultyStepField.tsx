"use client";

import Box from "@mui/material/Box";
import SvgIcon from "@mui/material/SvgIcon";
import Typography from "@mui/material/Typography";
import { DIFFICULTY_STEPS, type DifficultyStep } from "@/modules/events/domain/difficulty";
import { useRecall } from "@/shared/forms/recall";
import QuietHelp from "@/shared/ui/QuietHelp";

/**
 * Three dots, the first `step` lit, as the gauge draws them (`DifficultyGaugeIcon`). Decorative:
 * the option's number and accessible name say it.
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
 * The outline's geometry matched to the band select beside it (§537): a 56-px outlined select with
 * its label in the edge. The `legend` fieldset is 6 px taller (half the legend's line), taken back
 * by a −6 px margin, so both visible outlines are 56 px on one line.
 */
export const STEP_FRAME = { height: 62, legendLine: 12, marginTop: -6, segmentHeight: 44 } as const;

/**
 * «Treapta» (§526): where in the band the event stands, 1 · 2 · 3; with the band it is the level
 * of fifteen the save writes (`fields.ts`, `difficultyLevel`). Native radios, visually hidden, so
 * it posts `event.difficultyStep` without a script and moves like a radio group; segments are
 * 44 × ≥56 px (BR-REQ-041-01 criterion 6). Client only for the recall (§315). Laid out by
 * `DifficultyRow`: the root is `display: contents`, filling the `step` and `help` cells.
 */
export default function DifficultyStepField({
  name,
  defaultStep,
  words,
}: {
  name: string;
  defaultStep: DifficultyStep;
  /** `scale`: the club's whole scale in words (§528), behind a «?» beside the toggle. */
  words: { label: string; help: string; scale?: string; choices: Record<`step${DifficultyStep}`, string> };
}) {
  const recall = useRecall();
  const posted = recall.value(name);
  const initial = recall.has && posted && DIFFICULTY_STEPS.some((step) => String(step) === posted) ? posted : String(defaultStep);
  const labelId = `${recall.idOf(name)}-label`;
  const helpId = `${recall.idOf(name)}-help`;
  // What is left below the legend, less the bottom edge, round the 44-px segments: 5 px.
  const inset = STEP_FRAME.height - STEP_FRAME.legendLine - 1 - STEP_FRAME.segmentHeight;
  return (
    <Box data-testid="difficulty-step-field" sx={{ display: "contents" }}>
      <Box data-testid="difficulty-step-control" sx={{ gridArea: "step", display: "flex", alignItems: "center", minWidth: 0 }}>
        {/* The fieldset is the radio group: named by its legend, described by the help line below. */}
        <Box
          component="fieldset"
          role="radiogroup"
          aria-labelledby={labelId}
          aria-describedby={helpId}
          sx={(theme) => ({
            m: 0,
            mt: `${STEP_FRAME.marginTop}px`,
            p: 0,
            minWidth: 0,
            height: STEP_FRAME.height,
            boxSizing: "border-box",
            flex: { xs: 1, sm: "0 0 auto" },
            border: "1px solid",
            // The outlined input's own edge colour, in either scheme.
            borderColor: theme.vars ? `rgba(${theme.vars.palette.common.onBackgroundChannel} / 0.23)` : "divider",
            borderRadius: 1,
          })}
        >
          <Box
            component="legend"
            id={labelId}
            sx={{ ml: "9px", px: "5px", fontSize: "0.75rem", lineHeight: `${STEP_FRAME.legendLine}px`, color: "text.secondary" }}
          >
            {words.label}
          </Box>
          <Box
            key={recall.generation}
            sx={{ display: "flex", gap: "4px", px: `${inset}px`, pb: `${inset}px`, boxSizing: "border-box" }}
          >
            {DIFFICULTY_STEPS.map((step) => (
              <Box
                key={step}
                component="label"
                sx={{
                  position: "relative",
                  flex: 1,
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 0.25,
                  minWidth: 56,
                  height: STEP_FRAME.segmentHeight,
                  px: 1.5,
                  borderRadius: "3px",
                  cursor: "pointer",
                  color: "text.secondary",
                  "&:hover": { bgcolor: "action.hover" },
                  "&:has(input:checked)": { bgcolor: "primary.main", color: "primary.contrastText" },
                  "&:has(input:focus-visible)": { outline: 2, outlineColor: "primary.main", outlineOffset: 1 },
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
        </Box>
        {/* The whole scale behind a «?» (§528, §537), outside the group's short description. */}
        {words.scale && <QuietHelp text={words.scale} testId="difficulty-scale-help" />}
      </Box>
      <Typography variant="caption" color="text.secondary" sx={{ gridArea: "help", display: "block", width: 0, minWidth: "100%" }}>
        <span id={helpId}>{words.help}</span>
      </Typography>
    </Box>
  );
}
