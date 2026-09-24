"use client";

import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogContentText from "@mui/material/DialogContentText";
import DialogTitle from "@mui/material/DialogTitle";
import FormControlLabel from "@mui/material/FormControlLabel";
import Radio from "@mui/material/Radio";
import RadioGroup from "@mui/material/RadioGroup";
import Stack from "@mui/material/Stack";
import Tab from "@mui/material/Tab";
import Tabs from "@mui/material/Tabs";
import Typography from "@mui/material/Typography";
import { useCallback, useEffect, useRef, useState } from "react";
import { identicalInBothLanguages } from "@/shared/forms/both-languages";
import RecallField, { useRecall } from "@/shared/forms/recall";
import { ACTION_ICONS } from "@/shared/ui/action-icons";
import { CHECKBOX_TAP_TARGET, TAP_TARGET } from "@/shared/ui/tap-target";
import { previewPause, type PreviewLanguage } from "./preview-pause";

/**
 * One choice of who receives the message, with everything the page says about it already worded
 * on the server (§324: an island formats no number or date itself): the label and its count, the
 * recipients line, what it costs against the plan and how much of it waits, and the dialog's
 * question — so switching the choice switches sentences, never arithmetic.
 */
export type ComposerAudience = {
  value: string;
  label: string;
  /** Real registrations reached — what the club is told (test rows are counted apart, §12.6). */
  real: number;
  test: number;
  /** "12 destinatari", "Nu e nimeni în grupul ales." */
  recipientsLine: string;
  /** The test rows, when there are any: they receive it too and are counted nowhere. */
  testLine?: string;
  /** "Emailuri, cu tot cu copiile pentru club: 24 (planul Free: încă 63 azi)." */
  costLine?: string;
  /** Set when some of it waits for the allowance to come back (§40) — never a refusal. */
  deferredLine?: string;
  /** "Trimiți mesajul la 12 participanți?" */
  confirmTitle: string;
};

export type ComposerLabels = {
  audience: string;
  audienceHelp: string;
  languageRo: string;
  languageEn: string;
  subject: string;
  subjectHelp: string;
  body: string;
  bodyHelp: string;
  identical: string;
  preview: string;
  previewHelp: string;
  previewRo: string;
  previewEn: string;
  previewLoading: string;
  previewUnavailable: string;
  /** "Câmpuri necunoscute: {names}…" — `{names}` filled here with what the preview found. */
  previewUnknown: string;
  previewSubject: string;
  send: string;
  confirmBody: string;
  confirmSend: string;
  cancel: string;
};

export type PreviewInput = { eventId: string; language: string; subjectRo: string; subjectEn: string; bodyRo: string; bodyEn: string };
export type PreviewResult = { subject: string; html: string; unknown: string[] } | null;

type Props = {
  eventId: string;
  audiences: readonly ComposerAudience[];
  defaultAudience: string;
  maxSubject: number;
  maxBody: number;
  labels: ComposerLabels;
  /** The live preview, rendered on the server with the template the outbox uses. */
  preview: (input: PreviewInput) => Promise<PreviewResult>;
};

/** The four boxes as the form posts them, read from the form for the preview. */
type Words = Record<"subjectRo" | "subjectEn" | "bodyRo" | "bodyEn", string>;

/** How long typing has to pause before the preview is asked for again. */
const PREVIEW_PAUSE_MS = 500;

/**
 * "Trimite un mesaj participanților" (`DECISIONS.md` §364) — the composer: who, the words in both
 * languages, the message as it will arrive, and Send behind a question.
 *
 * Inside `ActionForm`, so a refused send comes back with every box as typed (§315); the boxes are
 * ordinary uncontrolled inputs (`RecallField`) and the preview reads them from the form. The
 * group is the one piece of state here, because the recipients line, the cost and the question
 * all follow it.
 *
 * **The preview is the real message.** Each pause in typing asks the server to render the words
 * through the same template the outbox sends with, over this event's facts, to a made-up runner —
 * the Romanian registrant's copy or the English one, as the tabs choose — and shows it sandboxed,
 * like `/admin/emails` (§91). Answers that arrive out of order are dropped, and a tab picked
 * cancels the pause still running from typing (`preview-pause.ts`), so the copy under a tab is
 * always that tab's. Without JavaScript there is no preview, and the form still sends.
 *
 * **Send asks first**, and only once the browser's own checks pass: an empty box is pointed at
 * before any question, so the question is only ever about sending.
 */
export default function ParticipantMessageComposer({ eventId, audiences, defaultAudience, maxSubject, maxBody, labels, preview }: Props) {
  const recall = useRecall();
  const recalledAudience = recall.value("audience");
  const [audience, setAudience] = useState(
    recalledAudience && audiences.some((choice) => choice.value === recalledAudience) ? recalledAudience : defaultAudience,
  );
  const chosen = audiences.find((choice) => choice.value === audience) ?? audiences[0];
  const nobody = !chosen || chosen.real + chosen.test === 0;

  const root = useRef<HTMLDivElement>(null);
  const readWords = useCallback((): Words => {
    const box = (name: string) => root.current?.querySelector<HTMLInputElement | HTMLTextAreaElement>(`[name="${name}"]`)?.value ?? "";
    return { subjectRo: box("subjectRo"), subjectEn: box("subjectEn"), bodyRo: box("bodyRo"), bodyEn: box("bodyEn") };
  }, []);

  const [identical, setIdentical] = useState(() => identicalInBothLanguages(recall.value("bodyRo") ?? "", recall.value("bodyEn") ?? ""));
  const [language, setLanguage] = useState<PreviewLanguage>("ro");
  const [shown, setShown] = useState<{ state: "loading" | "ready" | "unavailable"; result: PreviewResult }>({ state: "loading", result: null });
  const asked = useRef(0);
  // The pause after typing, which a tab picked cancels (`preview-pause.ts`): one for the composer's life.
  const [pause] = useState(() => previewPause(PREVIEW_PAUSE_MS, "ro"));

  const refresh = useCallback(
    (nextLanguage: PreviewLanguage) => {
      const ticket = ++asked.current;
      const words = readWords();
      preview({ eventId, language: nextLanguage, ...words })
        .then((result) => {
          if (ticket !== asked.current) return;
          setShown(result ? { state: "ready", result } : { state: "unavailable", result: null });
        })
        .catch(() => {
          if (ticket === asked.current) setShown({ state: "unavailable", result: null });
        });
    },
    [eventId, preview, readWords],
  );

  // The first preview once the boxes exist — after a refusal too, when they hold what was typed.
  useEffect(() => {
    // Asking afresh: a pause still running from before would only ask again for the same words.
    pause.cancel();
    refresh(language);
    return () => pause.cancel();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per answer; typing asks below
  }, [recall.generation]);

  const onInput = () => {
    const words = readWords();
    setIdentical(identicalInBothLanguages(words.bodyRo, words.bodyEn));
    // Asked when the pause ends, for the tab open then — not the one open when the key was pressed.
    pause.typed(refresh);
  };

  const [confirming, setConfirming] = useState(false);
  const sendButton = useRef<HTMLButtonElement>(null);
  const SendIcon = ACTION_ICONS.send;
  const unknown = shown.result?.unknown ?? [];

  return (
    <Stack spacing={3} ref={root} onInput={onInput}>
      <Box>
        <Typography id="participant-message-audience" variant="subtitle1" component="h3" sx={{ fontWeight: 600 }}>
          {labels.audience}
        </Typography>
        <RadioGroup
          key={recall.generation}
          id={recall.idOf("audience")}
          name="audience"
          value={audience}
          onChange={(event) => setAudience(event.target.value)}
          aria-labelledby="participant-message-audience"
          aria-describedby="participant-message-audience-help"
        >
          {audiences.map((choice) => (
            <FormControlLabel
              key={choice.value}
              value={choice.value}
              control={<Radio sx={CHECKBOX_TAP_TARGET} />}
              data-testid={`audience-${choice.value}`}
              label={
                <>
                  {choice.label}{" "}
                  <Typography component="span" variant="body2" color="text.secondary">
                    · {choice.real}
                  </Typography>
                </>
              }
            />
          ))}
        </RadioGroup>
        <Typography id="participant-message-audience-help" variant="caption" color="text.secondary" component="p">
          {labels.audienceHelp}
        </Typography>
        {chosen && (
          <Box sx={{ mt: 1 }} data-testid="participant-message-recipients" aria-live="polite">
            <Typography variant="body2" sx={{ fontWeight: 600 }}>
              {chosen.recipientsLine}
            </Typography>
            {chosen.testLine && (
              <Typography variant="body2" color="text.secondary">
                {chosen.testLine}
              </Typography>
            )}
            {chosen.costLine && (
              <Typography variant="body2" color="text.secondary">
                {chosen.costLine}
              </Typography>
            )}
            {chosen.deferredLine && (
              <Alert severity="info" sx={{ mt: 1 }} data-testid="participant-message-deferred">
                {chosen.deferredLine}
              </Alert>
            )}
          </Box>
        )}
      </Box>

      {/* The words, both languages side by side from `sm` — one text, never behind a tab (§354). */}
      {(
        [
          ["subject", labels.subject, labels.subjectHelp, maxSubject, false],
          ["body", labels.body, labels.bodyHelp, maxBody, true],
        ] as const
      ).map(([part, heading, help, max, multiline]) => (
        <Stack key={part} spacing={1} role="group" aria-labelledby={`participant-message-${part}`}>
          <Typography id={`participant-message-${part}`} variant="subtitle1" component="h3" sx={{ fontWeight: 600 }}>
            {heading}
          </Typography>
          <Stack direction={{ xs: "column", sm: "row" }} spacing={1}>
            {(
              [
                [`${part}Ro`, labels.languageRo],
                [`${part}En`, labels.languageEn],
              ] as const
            ).map(([name, language]) => (
              <RecallField
                key={name}
                name={name}
                label={language}
                required
                fullWidth
                multiline={multiline}
                minRows={multiline ? 6 : undefined}
                slotProps={{ htmlInput: { maxLength: max, "aria-describedby": `participant-message-${part}-help` } }}
              />
            ))}
          </Stack>
          <Typography id={`participant-message-${part}-help`} variant="caption" color="text.secondary">
            {help}
          </Typography>
          {part === "body" && identical && (
            <Alert severity="warning" data-testid="participant-message-identical">
              {labels.identical}
            </Alert>
          )}
        </Stack>
      ))}

      {/* The message as it will arrive (§364): the server renders it, the tabs pick whose copy. */}
      <Box data-testid="participant-message-preview">
        <Typography variant="subtitle1" component="h3" sx={{ fontWeight: 600 }}>
          {labels.preview}
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
          {labels.previewHelp}
        </Typography>
        <Tabs
          value={language}
          onChange={(_event, next: PreviewLanguage) => {
            setLanguage(next);
            // Now, for this tab, and the pause still running from typing is dropped: it was for the tab left.
            pause.switched(next, refresh);
          }}
          aria-label={labels.preview}
          sx={{ mb: 1, "& .MuiTab-root": TAP_TARGET }}
        >
          <Tab value="ro" label={labels.previewRo} />
          <Tab value="en" label={labels.previewEn} />
        </Tabs>
        {unknown.length > 0 && (
          <Alert severity="warning" sx={{ mb: 1 }} data-testid="participant-message-unknown">
            {labels.previewUnknown.replace("{names}", unknown.map((name) => `{${name}}`).join(", "))}
          </Alert>
        )}
        {shown.state === "unavailable" && <Alert severity="info">{labels.previewUnavailable}</Alert>}
        {shown.state === "loading" && (
          <Typography variant="body2" color="text.secondary">
            {labels.previewLoading}
          </Typography>
        )}
        {shown.result && (
          <>
            <Typography variant="body2" sx={{ mb: 1, wordBreak: "break-word" }} data-testid="participant-message-preview-subject">
              {labels.previewSubject}: {shown.result.subject}
            </Typography>
            {/* Sandboxed: an email has its own `<html>` and styles and must not inherit the backoffice's (§91). */}
            <Box
              component="iframe"
              srcDoc={shown.result.html}
              sandbox=""
              title={labels.preview}
              sx={{ width: "100%", height: 620, border: 1, borderColor: "divider", borderRadius: 1 }}
            />
          </>
        )}
      </Box>

      <Box>
        {/*
          A plain submit button without JavaScript — the server's checks are the ones that matter.
          With it, the browser's own checks run first and then the question; the dialog's Send is
          what submits, through this button so React's action receives the same fields.
        */}
        <Button
          ref={sendButton}
          type="submit"
          variant="contained"
          disabled={nobody}
          startIcon={<SendIcon fontSize="small" />}
          sx={TAP_TARGET}
          onClick={(event) => {
            event.preventDefault();
            if (!event.currentTarget.form?.reportValidity()) return;
            setConfirming(true);
          }}
        >
          {labels.send}
        </Button>
        <Dialog open={confirming} onClose={() => setConfirming(false)} aria-labelledby="participant-message-confirm">
          <DialogTitle id="participant-message-confirm">{chosen?.confirmTitle}</DialogTitle>
          <DialogContent>
            <DialogContentText>{labels.confirmBody}</DialogContentText>
            {chosen?.testLine && <DialogContentText sx={{ mt: 1 }}>{chosen.testLine}</DialogContentText>}
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setConfirming(false)} sx={TAP_TARGET}>
              {labels.cancel}
            </Button>
            <Button
              variant="contained"
              sx={TAP_TARGET}
              onClick={() => {
                setConfirming(false);
                const form = sendButton.current?.form;
                if (form && sendButton.current) form.requestSubmit(sendButton.current);
              }}
            >
              {labels.confirmSend}
            </Button>
          </DialogActions>
        </Dialog>
      </Box>
    </Stack>
  );
}
