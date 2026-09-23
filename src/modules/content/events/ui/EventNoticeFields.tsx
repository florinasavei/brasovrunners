"use client";

import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Checkbox from "@mui/material/Checkbox";
import FormControlLabel from "@mui/material/FormControlLabel";
import Typography from "@mui/material/Typography";
import { useState } from "react";
import RecallField, { useRecall } from "@/shared/forms/recall";
import CheckboxField from "@/shared/ui/CheckboxField";
import { CHECKBOX_TAP_TARGET } from "@/shared/ui/tap-target";
import { useSelectedValue } from "./OnlyForType";

/** The words, all of them already translated on the server; the counts are in the sentences. */
export type EventNoticeLabels = {
  notify: string;
  /** "12 participanți ar primi emailul…" — the count and the allowance, said before the press. */
  notifyHelp: string;
  note: string;
  noteHelp: string;
  cancelTitle: string;
  cancelIntro: string;
  cancelReason: string;
  cancelReasonHelp: string;
  cancelNotify: string;
  cancelNotifyHelp: string;
};

/**
 * Beside the editor's save button: whether the participants hear about this save (`DECISIONS.md`
 * §NNN; the owner: "I want to know exactly when and if participants get email alerts").
 *
 * Two blocks, and at most one of them, chosen by what the status select says *now*:
 *
 * - **Scheduled** — "Anunță participanții despre schimbare", unticked on every page load, and
 *   under it, once ticked, a short note. Unticked, the save emails nobody; ticked, the service
 *   decides whether there is anything to tell (a new place, start or programme, or a note).
 * - **Cancelled, on an event that was not** — the reason, required, and "tell the participants",
 *   ticked. Rendered only while the select says "Anulat", so the browser's `required` is honest:
 *   a hidden required box would refuse every ordinary save with a message pointing at nothing.
 *   The service asks for the reason again whatever the browser did (BR-REQ-060-01).
 *
 * Completed, or cancelled already: neither — nothing is sent about an event that is over.
 *
 * The note stays in the form while its tick is off, hidden rather than removed, so unticking by
 * mistake does not lose what was typed; the service ignores a note nobody asked to send. After a
 * refused submit every box comes back as it was posted (§315).
 */
export default function EventNoticeFields({
  statusSelectName,
  initialStatus,
  wasCancelled,
  offerNotice,
  maxLength,
  labels,
}: {
  statusSelectName: string;
  /** The status the page rendered with. */
  initialStatus: string;
  /** Whether the event is cancelled in the database — a save that keeps it so is not a cancellation. */
  wasCancelled: boolean;
  /**
   * Whether the event has anybody to tell: it takes registrations here. A group run has no
   * participants, so no box — but cancelling one still asks why, for the audit trail.
   */
  offerNotice: boolean;
  maxLength: number;
  labels: EventNoticeLabels;
}) {
  const status = useSelectedValue(statusSelectName, initialStatus);
  const recall = useRecall();

  if (status === "CANCELLED" && !wasCancelled) {
    return (
      <Alert severity="warning" icon={false} data-testid="cancel-fields" sx={{ "& .MuiAlert-message": { width: "100%" } }}>
        <Typography variant="subtitle1" component="h3" sx={{ fontWeight: 600 }}>
          {labels.cancelTitle}
        </Typography>
        <Typography variant="body2" sx={{ mb: 1.5 }}>
          {labels.cancelIntro}
        </Typography>
        <RecallField
          name="cancel.reason"
          label={labels.cancelReason}
          helperText={labels.cancelReasonHelp}
          required
          multiline
          minRows={2}
          fullWidth
          slotProps={{ htmlInput: { maxLength } }}
          sx={{ bgcolor: "background.paper" }}
        />
        {offerNotice && (
          <Box sx={{ mt: 1 }}>
            <CheckboxField name="cancel.notify" defaultChecked>
              {labels.cancelNotify}
            </CheckboxField>
            <Typography variant="body2" color="text.secondary" data-testid="cancel-count">
              {labels.cancelNotifyHelp}
            </Typography>
          </Box>
        )}
      </Alert>
    );
  }

  if (status !== "SCHEDULED" || !offerNotice) return null;
  return (
    <NotifyToggle
      key={recall.generation}
      on={recall.has ? recall.value("notice.notify") === "on" : false}
      maxLength={maxLength}
      labels={labels}
    />
  );
}

function NotifyToggle({ on: initialOn, maxLength, labels }: { on: boolean; maxLength: number; labels: EventNoticeLabels }) {
  const [on, setOn] = useState(initialOn);
  return (
    <Box data-testid="notice-fields">
      <FormControlLabel
        control={
          <Checkbox name="notice.notify" checked={on} onChange={(event) => setOn(event.target.checked)} sx={CHECKBOX_TAP_TARGET} />
        }
        label={labels.notify}
      />
      <Typography variant="body2" color="text.secondary" data-testid="notice-count">
        {labels.notifyHelp}
      </Typography>
      <Box sx={{ display: on ? "block" : "none", mt: 1.5 }}>
        <RecallField
          name="notice.note"
          label={labels.note}
          helperText={labels.noteHelp}
          multiline
          minRows={2}
          fullWidth
          slotProps={{ htmlInput: { maxLength } }}
        />
      </Box>
    </Box>
  );
}
