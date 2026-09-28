"use client";

import Box from "@mui/material/Box";
import SvgIcon from "@mui/material/SvgIcon";
import Typography from "@mui/material/Typography";
import { DIFFICULTY_STEPS, type DifficultyStep } from "@/modules/events/domain/difficulty";
import { useRecall } from "@/shared/forms/recall";
import QuietHelp from "@/shared/ui/QuietHelp";

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
 * The outline's geometry (§NNN), matched to the band select beside it — an outlined MUI select,
 * 56 px tall, its shrunk label (0.75rem) in the top edge. Here the label is a `legend`, which
 * draws the same notch natively; the fieldset is 6 px taller than the select (half the legend's
 * line above the edge) and a −6 px top margin takes that back, so in `DifficultyRow`'s centred row
 * the two visible outlines are the same 56 px on the same line.
 */
export const STEP_FRAME = { height: 62, legendLine: 12, marginTop: -6, segmentHeight: 44 } as const;

/**
 * «Treapta» (§526): the editor's second difficulty control, beside the band select in «Ce fel de
 * eveniment» — where inside the band the event stands, as a segmented 1 · 2 · 3, each segment with
 * its dots glyph. With the band it is the level on the club's scale of fifteen, which the save
 * writes (`fields.ts`, `difficultyLevel`).
 *
 * Native radios, visually hidden inside their segments, so the choice posts `event.difficultyStep`
 * with or without a script and the keyboard moves through the three as a radio group does; each
 * segment is 44 pixels tall and at least 56 wide (BR-REQ-041-01 criterion 6). A client component
 * only for the recall after a refused save (§315): the choice that was posted comes back. Words
 * only, as strings — no element crosses from the Server Component that renders it (§370).
 *
 * Laid out by `DifficultyRow` (§NNN): the root is `display: contents`, the outline with its «?» is
 * the grid's `step` cell — on the band select's axis — and the help line is the `help` cell under
 * it, so the line never lifts the toggle. Below `sm` the outline takes the full width.
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
        {/* The fieldset is the radio group itself: one group, named by its legend, described by the
            help line in the cell under it. */}
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
        {/* The whole scale behind a «?» (§528, the §511 way), beside the toggle as the band's is
            beside its select (§NNN) — outside the radio group's description, the one short line. */}
        {words.scale && <QuietHelp text={words.scale} testId="difficulty-scale-help" />}
      </Box>
      <Typography variant="caption" color="text.secondary" sx={{ gridArea: "help", display: "block" }}>
        <span id={helpId}>{words.help}</span>
      </Typography>
    </Box>
  );
}
