"use client";

import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Checkbox from "@mui/material/Checkbox";
import FormControlLabel from "@mui/material/FormControlLabel";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { type FormEvent, useState } from "react";
import { identicalInBothLanguages } from "@/shared/forms/both-languages";
import RecallField, { useRecall } from "@/shared/forms/recall";
import { CHECKBOX_TAP_TARGET } from "@/shared/ui/tap-target";
import TranslateFieldButton from "@/modules/translate/ui/TranslateFieldButton";
import { useSelectedValue } from "./OnlyForType";

/** The words, all of them already translated on the server; the counts are in the sentences. */
export type EventNoticeLabels = {
  notify: string;
  /** "12 participanți ar primi emailul…": the count and the allowance, before the press. */
  notifyHelp: string;
  note: string;
  noteHelp: string;
  cancelTitle: string;
  cancelIntro: string;
  cancelReason: string;
  cancelReasonHelp: string;
  cancelNotify: string;
  cancelNotifyHelp: string;
  /** Each language's own name over its box (§354). */
  languageRo: string;
  languageEn: string;
  /** The amber line under a pair whose two boxes say the same words — "is it translated?". */
  identical: string;
};

type NoticeProps = {
  statusSelectName: string;
  /** The status the page rendered with. */
  initialStatus: string;
  /** Whether the event is stored as cancelled: saving it so again is not a cancellation. */
  wasCancelled: boolean;
  /** Whether there is anybody to tell (registration here). A group run still asks why it is cancelled, for the audit. */
  offerNotice: boolean;
  maxLength: number;
  labels: EventNoticeLabels;
};

/**
 * Whether the participants hear about this save (§331), by what the status select says now:
 * - Cancelled, on an event that was not (`EventCancelFields`, in the status card): the reason,
 *   required in both languages (§354), and "tell the participants", ticked. Rendered only while
 *   "Anulat" is chosen, so the browser's `required` never blocks an ordinary save; the service
 *   checks again (BR-REQ-060-01).
 * - Scheduled (`EventNoticeUpdateFields`, beside the save button): "Anunță participanții despre
 *   schimbare", unticked on every load, with an optional note in both languages or neither.
 * - Completed or already cancelled: neither.
 * A hidden note stays in the form (the service ignores it); boxes recall after a refusal (§315),
 * except a block the refused form never drew.
 */
export function EventNoticeUpdateFields({ statusSelectName, initialStatus, offerNotice, maxLength, labels }: NoticeProps) {
  const status = useSelectedValue(statusSelectName, initialStatus);
  const recall = useRecall();
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

/** The cancellation's reason and its "tell them", while "Anulat" is chosen (see above). */
export function EventCancelFields({ statusSelectName, initialStatus, wasCancelled, offerNotice, maxLength, labels }: NoticeProps) {
  const status = useSelectedValue(statusSelectName, initialStatus);
  const recall = useRecall();

  if (status === "CANCELLED" && !wasCancelled) {
    return (
      <Alert severity="warning" icon={false} data-testid="cancel-fields" sx={{ "& .MuiAlert-message": { width: "100%" } }}>
        {/* An h3 inside the status card. */}
        <Typography variant="subtitle1" component="h3" sx={{ fontWeight: 600 }}>
          {labels.cancelTitle}
        </Typography>
        <Typography variant="body2" sx={{ mb: 1.5 }}>
          {labels.cancelIntro}
        </Typography>
        {/* Each registrant reads the reason in their language, so both are required (§354). */}
        <NoticeTextPair prefix="cancel.reason" label={labels.cancelReason} help={labels.cancelReasonHelp} required maxLength={maxLength} labels={labels} onPaper />
        {offerNotice && (
          <Box sx={{ mt: 1 }}>
            {/*
              Ticked when it appears. After a refused save it recalls only if that save carried the
              cancellation; otherwise "not posted" means "not drawn", so the default holds (§315, §331).
            */}
            <FormControlLabel
              control={
                <Checkbox
                  key={recall.generation}
                  name="cancel.notify"
                  defaultChecked={recall.has && recall.value("cancel.reasonRo") !== undefined ? recall.value("cancel.notify") === "on" : true}
                  sx={CHECKBOX_TAP_TARGET}
                />
              }
              label={labels.cancelNotify}
            />
            <Typography variant="body2" color="text.secondary" data-testid="cancel-count">
              {labels.cancelNotifyHelp}
            </Typography>
          </Box>
        )}
      </Alert>
    );
  }
  return null;
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
        <NoticeTextPair prefix="notice.note" label={labels.note} help={labels.noteHelp} maxLength={maxLength} labels={labels} />
      </Box>
    </Box>
  );
}

/**
 * One organizer text as two boxes, Română and English side by side (§354), never behind tabs,
 * since each registrant is written to in their language. The service refuses a one-language note
 * on the empty box. Identical words in both get an amber warning line, never a refusal.
 */
function NoticeTextPair({
  prefix,
  label,
  help,
  required = false,
  maxLength,
  labels,
  onPaper = false,
}: {
  prefix: "notice.note" | "cancel.reason";
  label: string;
  help: string;
  required?: boolean;
  maxLength: number;
  labels: EventNoticeLabels;
  /** Inside the amber cancellation block: the boxes on the page's own paper, as before. */
  onPaper?: boolean;
}) {
  const recall = useRecall();
  const names = { ro: `${prefix}Ro`, en: `${prefix}En` } as const;
  const [identical, setIdentical] = useState(() => identicalInBothLanguages(recall.value(names.ro) ?? "", recall.value(names.en) ?? ""));
  const headingId = `${prefix.replace(".", "-")}-heading`;
  const helpId = `${prefix.replace(".", "-")}-help`;
  // Read from the two uncontrolled inputs themselves.
  const measure = (event: FormEvent<HTMLDivElement>) => {
    const box = (name: string) => event.currentTarget.querySelector<HTMLTextAreaElement>(`[name="${name}"]`)?.value ?? "";
    setIdentical(identicalInBothLanguages(box(names.ro), box(names.en)));
  };
  return (
    <Stack spacing={1} role="group" aria-labelledby={headingId} aria-describedby={helpId} onInput={measure}>
      <Typography id={headingId} variant="body2" sx={{ fontWeight: 600 }}>
        {label}
      </Typography>
      <Stack direction={{ xs: "column", sm: "row" }} spacing={1}>
        {(
          [
            [names.ro, labels.languageRo],
            [names.en, labels.languageEn],
          ] as const
        ).map(([name, languageLabel]) => (
          <RecallField
            key={name}
            name={name}
            label={languageLabel}
            required={required}
            multiline
            minRows={2}
            fullWidth
            slotProps={{ htmlInput: { maxLength, "aria-describedby": helpId } }}
            sx={onPaper ? { bgcolor: "background.paper" } : undefined}
          />
        ))}
      </Stack>
      {/* «Tradu din română» (§464): the English note or reason from the Romanian one. */}
      <TranslateFieldButton en={names.en} />
      <Typography id={helpId} variant="caption" color="text.secondary">
        {help}
      </Typography>
      {identical && (
        <Alert severity="warning" data-testid={`${prefix.replace(".", "-")}-identical`}>
          {labels.identical}
        </Alert>
      )}
    </Stack>
  );
}
