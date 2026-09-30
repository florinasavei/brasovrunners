"use client";

import HourglassEmptyIcon from "@mui/icons-material/HourglassEmpty";
import Box from "@mui/material/Box";
import Checkbox from "@mui/material/Checkbox";
import FormControlLabel from "@mui/material/FormControlLabel";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { useState } from "react";
import DateField from "@/shared/forms/pickers/DateField";
import TimeField from "@/shared/forms/pickers/TimeField";
import { useRecall } from "@/shared/forms/recall";
import { CHECKBOX_TAP_TARGET } from "@/shared/ui/tap-target";
import { RACE_START_NOT_SET } from "../race-start";

type Props = {
  labels: { date: string; time: string; help: string; tick: string; tickHelp: string };
  /** The boxes as the stored gun time fills them, "" for none. */
  values: { date: string; time: string };
  /** Ticked when the race has no gun time yet (`race_starts_at` null). */
  defaultNotSet: boolean;
  required: boolean;
};

/**
 * «Startul cursei» and its tick «Startul cursei nu e stabilit» (§NNN; the owner, 2026-09-30:
 * «Race start must be nullable … a checkbox with "undefined race start"»). Ticked, the two boxes
 * are gone and the save stores no gun time (`race-start.ts#raceStartWallTime`); unticked, they are
 * back with what they held. The boxes post `event.raceStartsAtDate` / `…Time`, as `WallTimeField`
 * did. After a refusal the tick comes back as it was posted (§315): an unticked box posts nothing.
 */
export default function RaceStartNotSet(props: Props) {
  const recall = useRecall();
  const initial = recall.has ? recall.value(RACE_START_NOT_SET) === "on" : props.defaultNotSet;
  return <Island key={recall.generation} {...props} initial={initial} />;
}

function Island({ labels, values, required, initial }: Props & { initial: boolean }) {
  const [notSet, setNotSet] = useState(initial);
  return (
    <Stack spacing={1} data-testid="race-start">
      {!notSet && (
        <Stack spacing={0.5}>
          <Box sx={{ display: "flex", flexWrap: "wrap", gap: 1.5, alignItems: "flex-start" }}>
            <DateField name="event.raceStartsAtDate" label={labels.date} defaultValue={values.date} required={required} sx={{ flex: "1 1 200px" }} />
            <TimeField name="event.raceStartsAtTime" label={labels.time} defaultValue={values.time} required={required} clearable={false} sx={{ flex: "0 0 140px" }} />
          </Box>
          <Typography variant="caption" color="text.secondary" sx={{ px: 1.75 }}>
            {labels.help}
          </Typography>
        </Stack>
      )}
      <Stack spacing={0.5}>
        <FormControlLabel
          sx={{ alignSelf: "flex-start" }}
          control={
            <Checkbox
              name={RACE_START_NOT_SET}
              checked={notSet}
              onChange={(event) => setNotSet(event.target.checked)}
              sx={CHECKBOX_TAP_TARGET}
              slotProps={{ input: { "aria-describedby": "race-start-not-set-help" } }}
            />
          }
          label={
            <Box component="span" sx={{ display: "inline-flex", alignItems: "center", gap: 0.75 }}>
              <HourglassEmptyIcon aria-hidden="true" fontSize="small" sx={{ color: "text.secondary" }} />
              {labels.tick}
            </Box>
          }
        />
        <Typography id="race-start-not-set-help" variant="body2" color="text.secondary">
          {labels.tickHelp}
        </Typography>
      </Stack>
    </Stack>
  );
}
