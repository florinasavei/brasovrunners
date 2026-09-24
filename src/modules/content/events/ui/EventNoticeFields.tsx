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
  /** Each language in its own words, over its box: "Română", "English" (§354, bilingual everywhere). */
  languageRo: string;
  languageEn: string;
  /** The amber line under a pair whose two boxes say the same words — "is it translated?". */
  identical: string;
};

type NoticeProps = {
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
};

/**
 * Whether the participants hear about this save (`DECISIONS.md` §331; the owner: "I want to know
 * exactly when and if participants get email alerts") — two blocks, and at most one of them,
 * chosen by what the status select says *now*, each in the box of the editor it belongs to
 * (§350):
 *
 * - **Cancelled, on an event that was not** (`EventCancelFields`, in "Starea evenimentului",
 *   beside the select that cancels) — the reason, required in Română and in English (§354,
 *   bilingual everywhere: `NoticeTextPair`), and "tell the participants", ticked.
 *   Rendered only while the select says "Anulat", so the browser's `required` is honest: a hidden
 *   required box would refuse every ordinary save with a message pointing at nothing. The service
 *   asks for the reason again whatever the browser did (BR-REQ-060-01).
 * - **Scheduled** (`EventNoticeUpdateFields`, in "Salvare", beside the button, because it is a
 *   decision made at the moment of the press) — "Anunță participanții despre schimbare",
 *   unticked on every page load, and under it, once ticked, a short note in both languages or in
 *   neither. Unticked, the save
 *   emails nobody; ticked, the service decides whether there is anything to tell.
 *
 * Completed, or cancelled already: neither — nothing is sent about an event that is over.
 *
 * The note stays in the form while its tick is off, hidden rather than removed, so unticking by
 * mistake does not lose what was typed; the service ignores a note nobody asked to send. After a
 * refused submit every box comes back as it was posted (§315) — except a block the refused form
 * never drew, which starts as it would on a fresh page: "tell them" ticked.
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
        {/* An h4: the status card is a level-3 card inside "Ce fel de eveniment" (§358). */}
        <Typography variant="subtitle1" component="h4" sx={{ fontWeight: 600 }}>
          {labels.cancelTitle}
        </Typography>
        <Typography variant="body2" sx={{ mb: 1.5 }}>
          {labels.cancelIntro}
        </Typography>
        {/* Why, in both languages (§354): each registrant reads the reason in theirs, so both are required. */}
        <NoticeTextPair prefix="cancel.reason" label={labels.cancelReason} help={labels.cancelReasonHelp} required maxLength={maxLength} labels={labels} onPaper />
        {offerNotice && (
          <Box sx={{ mt: 1 }}>
            {/*
              Ticked when it appears. After a refused save it comes back as posted — but only when
              that save carried the cancellation at all (its reason boxes post even when empty). One
              posted while the select still said "Programat" never had this box, and "not posted"
              there means "not drawn", not "unticked", so the box keeps its default (§315, §331).
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
 * One of the organizer's texts as two boxes, Română and English side by side from `sm` (§354,
 * bilingual everywhere — the partner description's pattern): every registrant is written to in
 * the language they registered in, so the words they read have to exist in it. Always seen
 * together, never behind a tab, because they are one text.
 *
 * The note is optional in both at once and the reason is required in both; the service refuses a
 * note in one language only on the empty box (§315 keeps the rest). Two boxes saying the same
 * words get an amber line under them — the Romanian pasted into the English box would reach the
 * English readers in Romanian — re-read as either is typed, and never a refusal.
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
  // Read from the two boxes themselves: they are ordinary uncontrolled inputs, like every box here.
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
