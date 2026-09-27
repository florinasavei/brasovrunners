"use client";

import FormControlLabel from "@mui/material/FormControlLabel";
import Radio from "@mui/material/Radio";
import RadioGroup from "@mui/material/RadioGroup";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { DIFFICULTY_STEPS, type DifficultyStep } from "@/modules/events/domain/difficulty";
import { useRecall } from "@/shared/forms/recall";
import { CHECKBOX_TAP_TARGET } from "@/shared/ui/tap-target";

/**
 * «Treapta» (§NNN): the editor's second difficulty control, beside the band select — where inside
 * the band the event stands, «Spre ușor» / «La mijloc» / «Spre greu». With the band it is the
 * level on the club's scale of fifteen, which the save writes (`fields.ts`, `difficultyLevel`).
 *
 * Three radios in a row, like «Eveniment de noapte» (`NightEventField`), each with the 44-pixel
 * reach of a checkbox (`CHECKBOX_TAP_TARGET`, BR-REQ-041-01 criterion 6) and a native input that
 * posts `event.difficultyStep` with or without a script. A client component only for the recall
 * after a refused save (§315): the choice that was posted comes back. Words only, as strings — no
 * element crosses from the Server Component that renders it (§370).
 */
export default function DifficultyStepField({
  name,
  defaultStep,
  words,
}: {
  name: string;
  defaultStep: DifficultyStep;
  words: { label: string; choices: Record<`step${DifficultyStep}`, string> };
}) {
  const recall = useRecall();
  const posted = recall.value(name);
  const initial = recall.has && posted && DIFFICULTY_STEPS.some((step) => String(step) === posted) ? posted : String(defaultStep);
  const labelId = `${recall.idOf(name)}-label`;
  return (
    <Stack spacing={0.5} data-testid="difficulty-step-field">
      <Typography variant="body2" id={labelId}>
        {words.label}
      </Typography>
      <RadioGroup key={recall.generation} row name={name} defaultValue={initial} aria-labelledby={labelId}>
        {DIFFICULTY_STEPS.map((step) => (
          <FormControlLabel key={step} value={String(step)} control={<Radio sx={CHECKBOX_TAP_TARGET} />} label={words.choices[`step${step}`]} />
        ))}
      </RadioGroup>
    </Stack>
  );
}
