"use client";

import ScheduleSendIcon from "@mui/icons-material/ScheduleSend";
import Box from "@mui/material/Box";
import FormControlLabel from "@mui/material/FormControlLabel";
import Stack from "@mui/material/Stack";
import Switch from "@mui/material/Switch";
import Typography from "@mui/material/Typography";
import { type ChangeEvent, useSyncExternalStore } from "react";
import { useFormStatus } from "react-dom";
import GlyphSubmitButton from "@/shared/ui/GlyphSubmitButton";

const noChanges = () => () => {};

type Props = {
  /** «La trecerea programată» is the setting in force (§513). */
  checked: boolean;
  /** «Trimite la trecerea programată», the switch's own label. */
  label: string;
  /** The button a browser without JavaScript presses instead: the other value, in words. */
  fallbackLabel: string;
  /** «Se salvează…», while the press is on its way. */
  pendingLabel: string;
};

/**
 * «Când pleacă emailurile» as a switch (the owner, on the queue panel: «nu e clar cum funcționează
 * acest toggle»; §529, §513): on is «La trecerea programată», off is «Imediat după cerere», and the
 * sentence under it — the page's, not this island's — says the mode in force and what it means.
 *
 * The switch posts nothing of its own: the form's hidden `timing` already names the other value, so a
 * change calls `requestSubmit()` and the form does what the old button did — `ActionFormIsland`
 * asks first (§384), the action saves and flashes the toast. The switch stays where the server put
 * it until the page comes back with the new setting, so a cancelled question leaves it as it was.
 *
 * Without JavaScript a switch cannot send a form: until the page is running it is shown disabled,
 * with the old button beside it, which posts the same form.
 */
export default function DeliveryTimingSwitch({ checked, label, fallbackLabel, pendingLabel }: Props) {
  // False in the server's HTML and while hydrating, true from then on (`PlaceToBeAnnounced`'s pattern).
  const running = useSyncExternalStore(
    noChanges,
    () => true,
    () => false,
  );
  const { pending } = useFormStatus();

  const onChange = (event: ChangeEvent<HTMLInputElement>) => {
    event.currentTarget.form?.requestSubmit();
  };

  return (
    <Stack direction="row" sx={{ alignItems: "center", flexWrap: "wrap", gap: 1 }}>
      <FormControlLabel
        control={
          <Switch
            checked={checked}
            onChange={onChange}
            disabled={!running || pending}
            slotProps={{ input: { "aria-describedby": "outbox-when-state" } }}
            data-testid="outbox-timing-switch"
          />
        }
        label={
          <Box component="span" sx={{ display: "inline-flex", alignItems: "center", gap: 0.75 }}>
            <ScheduleSendIcon fontSize="small" aria-hidden />
            {label}
          </Box>
        }
        sx={{ mr: 0 }}
      />
      {pending && (
        <Typography variant="body2" color="text.secondary" role="status">
          {pendingLabel}
        </Typography>
      )}
      {!running && <GlyphSubmitButton label={fallbackLabel} pendingLabel={pendingLabel} icon={checked ? "turnOff" : "turnOn"} variant="outlined" size="small" />}
    </Stack>
  );
}
