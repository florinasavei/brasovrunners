"use client";

import Box from "@mui/material/Box";
import Checkbox from "@mui/material/Checkbox";
import FormControlLabel from "@mui/material/FormControlLabel";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { useEffect, useRef, useState } from "react";
import DateField from "@/shared/forms/pickers/DateField";
import TimeField from "@/shared/forms/pickers/TimeField";
import { useIslandRunning } from "@/shared/forms/pickers/picker-island";
import { useRecall } from "@/shared/forms/recall";
import { CHECKBOX_TAP_TARGET } from "@/shared/ui/tap-target";
import { startBoxesRequired } from "../start";

/** What the two switches post; `admin/actions.ts#eventFieldsFrom` reads them by these names. */
const DATE_SWITCH = "event.dateToBeAnnounced";
const TIME_SWITCH = "event.timeToBeAnnounced";

type Props = {
  labels: {
    /** «Începutul evenimentului» — the date box, and the refusal's name for both (§47). */
    date: string;
    /** «Ora». */
    time: string;
    /** «Ora locală a evenimentului (…)», under the two boxes. */
    help: string;
    dateSwitch: string;
    dateSwitchHelp: string;
    timeSwitch: string;
    timeSwitchHelp: string;
  };
  /** The boxes as the stored start fills them — "" for a part left blank (`startBoxValues`). */
  values: { date: string; time: string };
  defaults: { dateToBeAnnounced: boolean; timeToBeAnnounced: boolean };
  /** Whether the schema requires the start at all (`eventInputConstraints`): the switches only take it away. */
  required: boolean;
};

/**
 * The start of «Când și unde» and its two switches (`DECISIONS.md` §545, amending §533; the owner,
 * 2026-09-28: «în V2.23 trebuie să pot să nu pun data și ora evenimentului! momentan am validare pe
 * asta»): the date and hour boxes, then «Data se anunță mai târziu» and «Ora se anunță mai târziu».
 *
 * The boxes' `required` follows the switches, by the service's own rule (`startBoxesRequired`):
 * the date's switch excuses both boxes, the time's alone the hour. So a ticked switch takes the
 * asterisk away and the browser lets the save through with the box empty; unticked, the box is
 * required again and an empty one is refused by the browser. Only once the island runs, though: in
 * the server's HTML (and with JavaScript off) the boxes carry no `required` at all, because either
 * switch could still be ticked before the press and a static attribute could not be lifted by it.
 * There the server's rule is the only one (`resolveStart`), and it refuses an empty box the
 * switches do not excuse, naming it through §47's summary. Nothing typed is cleared by a switch:
 * a provisional date stays in its box, unpublished, as §533 keeps it.
 *
 * A client island for the same reason as the place's (`PlaceToBeAnnounced`, §328): `required` is
 * what changes, and MUI draws the asterisk from it. The boxes are the `WallTimeField` pair, posting
 * `event.startsAtDate` and `event.startsAtTime` as before. After a refusal the switches come back
 * as they were posted (§315): an unticked box posts nothing, so "not posted" is "off".
 */
export default function StartToBeAnnounced(props: Props) {
  const recall = useRecall();
  const initial = {
    dateToBeAnnounced: recall.has ? recall.value(DATE_SWITCH) === "on" : props.defaults.dateToBeAnnounced,
    timeToBeAnnounced: recall.has ? recall.value(TIME_SWITCH) === "on" : props.defaults.timeToBeAnnounced,
  };
  return <Island key={recall.generation} {...props} initial={initial} />;
}

function Island({ labels, values, required, initial }: Props & { initial: Props["defaults"] }) {
  const recall = useRecall();
  const [switches, setSwitches] = useState(initial);
  const own = useRef<HTMLDivElement>(null);
  const mounted = useRef(false);
  // False in the server's HTML and while hydrating: no `required` a switch could not lift (see above).
  const running = useIslandRunning();
  const needs = startBoxesRequired(switches);
  const dateRequired = running && required && needs.date;
  const timeRequired = running && required && needs.time;

  // The form's own watchers measure on `change`, which the box fires before React has re-rendered
  // the boxes' `required`: told again once it has (the place's switch does the same, §328).
  useEffect(() => {
    if (!mounted.current) {
      mounted.current = true;
      return;
    }
    own.current?.closest("form")?.dispatchEvent(new Event("change"));
    // And once the island runs, when the boxes first take their `required`.
  }, [switches, running]);

  const toggle = (name: string, key: keyof Props["defaults"], label: string, help: string, helpId: string) => (
    <Stack spacing={0.5}>
      <FormControlLabel
        sx={{ alignSelf: "flex-start" }}
        control={
          <Checkbox
            // The id a refusal's summary links to, when the refusal named this box (§47, §315).
            id={recall.named(name) ? recall.idOf(name) : undefined}
            name={name}
            checked={switches[key]}
            onChange={(event) => setSwitches((current) => ({ ...current, [key]: event.target.checked }))}
            sx={CHECKBOX_TAP_TARGET}
            slotProps={{ input: { "aria-describedby": helpId } }}
          />
        }
        label={label}
      />
      <Typography id={helpId} variant="body2" color="text.secondary">
        {help}
      </Typography>
    </Stack>
  );

  return (
    <Stack spacing={2} ref={own}>
      <Stack spacing={0.5}>
        {/* Side by side where there is room, the hour under the date on a phone (`WallTimeField`). */}
        <Box sx={{ display: "flex", flexWrap: "wrap", gap: 1.5, alignItems: "flex-start" }}>
          <DateField name="event.startsAtDate" label={labels.date} defaultValue={values.date} required={dateRequired} clearable sx={{ flex: "1 1 200px" }} />
          <TimeField name="event.startsAtTime" label={labels.time} defaultValue={values.time} required={timeRequired} clearable={false} sx={{ flex: "0 0 140px" }} />
        </Box>
        <Typography variant="caption" color="text.secondary" sx={{ px: 1.75 }}>
          {labels.help}
        </Typography>
      </Stack>
      {/* The marker says the form carried the boxes, so an unticked one reads as "off", not "not edited" (§451). */}
      <Box data-testid="date-to-be-announced">
        <input type="hidden" name={`${DATE_SWITCH}.present`} value="1" />
        {toggle(DATE_SWITCH, "dateToBeAnnounced", labels.dateSwitch, labels.dateSwitchHelp, "date-to-be-announced-help")}
        <input type="hidden" name={`${TIME_SWITCH}.present`} value="1" />
        {toggle(TIME_SWITCH, "timeToBeAnnounced", labels.timeSwitch, labels.timeSwitchHelp, "time-to-be-announced-help")}
      </Box>
    </Stack>
  );
}
