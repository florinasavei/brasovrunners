"use client";

import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Checkbox from "@mui/material/Checkbox";
import FormControlLabel from "@mui/material/FormControlLabel";
import Radio from "@mui/material/Radio";
import RadioGroup from "@mui/material/RadioGroup";
import Stack from "@mui/material/Stack";
import Tab from "@mui/material/Tab";
import Tabs from "@mui/material/Tabs";
import Typography from "@mui/material/Typography";
import { type FormEvent, useCallback, useEffect, useRef, useState } from "react";
import ConfirmDialog from "@/shared/feedback/ConfirmDialog";
import { identicalInBothLanguages } from "@/shared/forms/both-languages";
import RecallField, { NeverKeptField, useRecall } from "@/shared/forms/recall";
import { ACTION_ICONS } from "@/shared/ui/action-icons";
import GlyphButton from "@/shared/ui/GlyphButton";
import { HEADING_SX } from "@/shared/ui/heading-scale";
import { CHECKBOX_TAP_TARGET, TAP_TARGET } from "@/shared/ui/tap-target";
import { writePlainBox } from "@/modules/translate/ui/form-fields";
import TranslateFieldButton from "@/modules/translate/ui/TranslateFieldButton";
import { type ChoosablePerson, pickedPeople, recalledPicks, tallyPicks, withPick } from "./chosen-recipients";
import ChosenRecipients, { type ChosenLabels } from "./ChosenRecipients";
import { previewPause, type PreviewLanguage } from "./preview-pause";
import { fillReminderBoxes, REMINDER_BOXES, reminderOverwrites } from "./reminder-fill";

/**
 * One choice of who receives the message, with everything the page says about it already worded
 * on the server (§324: an island formats no number or date itself): the label and its count, the
 * recipients line, what it costs against the plan and how much of it waits, and the dialog's
 * question — so switching the choice switches sentences, never arithmetic.
 */
export type ComposerAudience = {
  value: string;
  label: string;
  /** The group's short name, as «Mesaje trimise» says it: «Toți cei înscriși» — for the line beside «Scrie la câți trimiți». */
  short: string;
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
  /**
   * Set when a daily allowance cannot hold the send today (the decision «Cere reconfirmarea», part two): the days it
   * takes that allowance, which the registrations' own emails share meanwhile, and where a monthly plan is chosen.
   */
  warningLine?: string;
  /**
   * The line the question before «Trimite» carries (the decision «Cere reconfirmarea», part two): how long the send
   * takes at the queue's pace, and whether it fits the allowance — worded on the server.
   */
  paceLine?: string;
  /** "Trimiți mesajul la 12 participanți?" */
  confirmTitle: string;
};

/**
 * «Doar anumiți participanți» (§NNN), the fifth choice of «Cui îi trimiți» and not a group: what its radio posts, the
 * field its ticks post under, and everybody who can be ticked — a name and a state each, by name, read on the server.
 */
export type ComposerChosen = {
  value: string;
  field: string;
  people: readonly ChoosablePerson[];
};

/**
 * «Confirmă trimiterea» (§NNN; the owner: «si vreau extra extra confirmare»): the heading over who the message goes to,
 * said again where it is sent, and the box the number of recipients is typed into — the field's name, its label and
 * its one line of help.
 */
export type ComposerConfirm = { field: string; title: string; count: string; countHelp: string };

/**
 * What the boxes hold when the page is drawn right after a send to the people ticked (§NNN): that send's words and its
 * two ticks, so a trial is followed by the same message to everybody. Absent after any other send: the boxes are empty.
 */
export type ComposerKept = {
  subjectRo: string;
  subjectEn: string;
  bodyRo: string;
  bodyEn: string;
  askReconfirm: boolean;
  sendQr: boolean;
};

export type ComposerLabels = {
  audience: string;
  audienceHelp: string;
  /** «Doar anumiți participanți» (§NNN): the radio's words and the list's. */
  chosen: ChosenLabels;
  /** «Confirmă trimiterea» (§NNN): the typed number of recipients. */
  confirm: ComposerConfirm;
  languageRo: string;
  languageEn: string;
  subject: string;
  subjectHelp: string;
  body: string;
  bodyHelp: string;
  /**
   * What the message may be about (§419; Legea 506/2004 art. 12, GDPR art. 5(1)(b)): this event
   * only, never advertising, a sponsor's offer or another event. Under the body box, no tick.
   */
  bodyScope: string;
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
  /** «Cere reconfirmarea» (the decision «Cere reconfirmarea») and its help line: nobody is cancelled automatically. */
  reconfirm: string;
  reconfirmHelp: string;
  /** «Trimite și numărul de concurs și codul QR» (§943) and its help line: only the confirmed get them, each their own. */
  sendQr: string;
  sendQrHelp: string;
  /**
   * «Completează cu textul de reminder»: the button, its question before it replaces typed words, and the ready text in
   * both languages — read on the server from both catalogues with its `{placeholders}` literal, whatever the UI language.
   */
  reminderFill: {
    button: string;
    confirmTitle: string;
    confirmBody: string;
    confirmGo: string;
    confirmCancel: string;
    subjectRo: string;
    subjectEn: string;
    bodyRo: string;
    bodyEn: string;
  };
};

export type PreviewInput = {
  eventId: string;
  language: string;
  subjectRo: string;
  subjectEn: string;
  bodyRo: string;
  bodyEn: string;
  /** The tick «Cere reconfirmarea» as it stands: the preview draws «Vin» beside «Nu mai pot ajunge». */
  askReconfirm: boolean;
  /** The tick «Trimite și numărul de concurs și codul QR» as it stands: the preview draws the example runner's block (§943). */
  sendQr: boolean;
};
export type PreviewResult = { subject: string; html: string; unknown: string[] } | null;

type Props = {
  eventId: string;
  audiences: readonly ComposerAudience[];
  /** «Doar anumiți participanți» (§NNN): the people who can be ticked. */
  chosen: ComposerChosen;
  /** The words of the send to the people ticked that the page was just returned from (§NNN), when it was one. */
  kept?: ComposerKept;
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
 * **Send asks first** — through the form's own question (`ActionForm confirm`, §384): the page
 * words one dialog per group, with the count the send queues from, and the form opens the one
 * the chosen radio names. The browser's own checks run before it: an empty box is pointed at
 * before any question, so the question is only ever about sending.
 *
 * **«Doar anumiți participanți»** (§NNN) is the fifth choice and not a group: under its radio, the
 * list of everybody who can be written to (`ChosenRecipients`), a tick each. The ticks are held
 * here, since «Trimite» waits for one and the recipients line counts them; its question counts
 * them again from the form as posted. After such a send the page hands the words back (`kept`) —
 * the one send after which the boxes are not empty, because a trial's next press is the same
 * message to everybody. Without JavaScript the list never opens, and a press of that choice is
 * refused for having nobody ticked; the four groups send as they always did.
 *
 * **«Confirmă trimiterea»** (§NNN; the owner: «si vreau extra extra confirmare») stands right
 * above «Trimite mesajul»: who the message goes to, said again where it is sent — the group and
 * its number, or the people ticked by name — and a box the number of recipients is typed into.
 * The send insists on it, as the bulk erase insists on its own typed count (§287): the server
 * compares the number with the rows it is about to write and queues nothing on any other. The
 * box is never handed back after a refusal — it is typed again — and the question still follows.
 */
export default function ParticipantMessageComposer({ eventId, audiences, chosen, kept, defaultAudience, maxSubject, maxBody, labels, preview }: Props) {
  const recall = useRecall();
  const recalledAudience = recall.value("audience");
  const [audience, setAudience] = useState(
    recalledAudience && (recalledAudience === chosen.value || audiences.some((choice) => choice.value === recalledAudience)) ? recalledAudience : defaultAudience,
  );
  // The people ticked (§NNN): kept while another choice is looked at, and after a refused send as it posted them (§315).
  const [picked, setPicked] = useState(() => recalledPicks(chosen.people, recall.all(chosen.field)));
  const ticking = audience === chosen.value;
  const group = ticking ? undefined : (audiences.find((choice) => choice.value === audience) ?? audiences[0]);
  const nobody = ticking ? picked.size === 0 : !group || group.real + group.test === 0;
  // The ticks as the page says them: the real people — the number typed at «Scrie la câți trimiți» — and the test rows apart.
  const tally = tallyPicks(chosen.people, picked);
  const tickedLine = labels.chosen.count.replace("{count}", String(tally.real)).replace("{total}", String(tally.listed));
  const tickedTestLine = tally.test > 0 ? labels.chosen.testTicked.replace("{test}", String(tally.test)) : null;
  const tickedNames = pickedPeople(chosen.people, picked).map((person) => person.name);

  const root = useRef<HTMLDivElement>(null);
  const readWords = useCallback((): Words => {
    const box = (name: string) => root.current?.querySelector<HTMLInputElement | HTMLTextAreaElement>(`[name="${name}"]`)?.value ?? "";
    return { subjectRo: box("subjectRo"), subjectEn: box("subjectEn"), bodyRo: box("bodyRo"), bodyEn: box("bodyEn") };
  }, []);
  /*
    «Cere reconfirmarea» (the decision «Cere reconfirmarea»): controlled, because the fill button ticks it; kept after a
    refused send like every box (§315). The preview reads it from the form, as it reads the words.
  */
  const [askReconfirm, setAskReconfirm] = useState(() => (recall.has ? recall.value("askReconfirm") === "1" : kept?.askReconfirm === true));
  // «Trimite și numărul de concurs și codul QR» (§943): off unless ticked; controlled too, so a refused send keeps it (§315).
  // Either tick starts as the send to the people ticked left it, when the page comes back from one (§NNN).
  const [sendQr, setSendQr] = useState(() => (recall.has ? recall.value("sendQr") === "1" : kept?.sendQr === true));
  // Either tick as the form holds it now — what a press would post.
  const readTick = useCallback(
    (name: "askReconfirm" | "sendQr"): boolean => root.current?.querySelector<HTMLInputElement>(`input[name="${name}"]`)?.checked === true,
    [],
  );

  const [identical, setIdentical] = useState(() => identicalInBothLanguages(recall.value("bodyRo") ?? kept?.bodyRo ?? "", recall.value("bodyEn") ?? kept?.bodyEn ?? ""));
  const [language, setLanguage] = useState<PreviewLanguage>("ro");
  const [shown, setShown] = useState<{ state: "loading" | "ready" | "unavailable"; result: PreviewResult }>({ state: "loading", result: null });
  const asked = useRef(0);
  // The pause after typing, which a tab picked cancels (`preview-pause.ts`): one for the composer's life.
  const [pause] = useState(() => previewPause(PREVIEW_PAUSE_MS, "ro"));

  const refresh = useCallback(
    (nextLanguage: PreviewLanguage) => {
      const ticket = ++asked.current;
      const words = readWords();
      preview({ eventId, language: nextLanguage, ...words, askReconfirm: readTick("askReconfirm"), sendQr: readTick("sendQr") })
        .then((result) => {
          if (ticket !== asked.current) return;
          setShown(result ? { state: "ready", result } : { state: "unavailable", result: null });
        })
        .catch(() => {
          if (ticket === asked.current) setShown({ state: "unavailable", result: null });
        });
    },
    [eventId, preview, readWords, readTick],
  );

  // The first preview once the boxes exist — after a refusal too, when they hold what was typed.
  useEffect(() => {
    // Asking afresh: a pause still running from before would only ask again for the same words.
    pause.cancel();
    refresh(language);
    return () => pause.cancel();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per answer; typing asks below
  }, [recall.generation]);

  const onInput = (event: FormEvent<HTMLDivElement>) => {
    // Only the four boxes of words are typing: a tick asks for its own preview at once (below), never a second one after
    // the pause, and who receives it — a radio, a tick on the list, a name looked for (§NNN) — changes no word of it.
    const from = (event.target as HTMLInputElement | null)?.name;
    if (!(REMINDER_BOXES as readonly string[]).includes(from ?? "")) return;
    const words = readWords();
    setIdentical(identicalInBothLanguages(words.bodyRo, words.bodyEn));
    // Asked when the pause ends, for the tab open then — not the one open when the key was pressed.
    pause.typed(refresh);
  };

  /*
    «Completează cu textul de reminder» (the decision «Cere reconfirmarea»): the four boxes written from the catalogues'
    ready text, each as if typed — so the identical-text check and the preview run — and the tick ticked. A box that
    already holds words is not replaced without asking first (§384).
  */
  const [askingFill, setAskingFill] = useState(false);
  const fill = () => {
    const texts = {
      subjectRo: labels.reminderFill.subjectRo,
      subjectEn: labels.reminderFill.subjectEn,
      bodyRo: labels.reminderFill.bodyRo,
      bodyEn: labels.reminderFill.bodyEn,
    };
    fillReminderBoxes((name) => root.current?.querySelector<HTMLInputElement | HTMLTextAreaElement>(`[name="${name}"]`), texts, writePlainBox);
    setAskReconfirm(true);
  };
  const pressFill = () => {
    if (reminderOverwrites(readWords())) setAskingFill(true);
    else fill();
  };

  const SendIcon = ACTION_ICONS.send;
  const unknown = shown.result?.unknown ?? [];

  return (
    <Stack spacing={3} ref={root} onInput={onInput}>
      <Box>
        <Typography id="participant-message-audience" variant="h2" component="h3" sx={HEADING_SX[3]}>
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
          {/* «Doar anumiți participanți» (§NNN): not a group, so no count beside it — its number is the ticks, said below. */}
          <FormControlLabel value={chosen.value} control={<Radio sx={CHECKBOX_TAP_TARGET} />} data-testid={`audience-${chosen.value}`} label={labels.chosen.label} />
        </RadioGroup>
        {ticking && (
          <ChosenRecipients
            id={recall.idOf(chosen.field)}
            field={chosen.field}
            people={chosen.people}
            picked={picked}
            onPick={(id, on) => setPicked((current) => withPick(current, id, on))}
            labels={labels.chosen}
            refused={recall.named(chosen.field)}
          />
        )}
        <Typography id="participant-message-audience-help" variant="caption" color="text.secondary" component="p">
          {labels.audienceHelp}
        </Typography>
        {ticking && (
          // The ticks' own number, where each group says its own: no cost or pace is worked out for a list ticked in the browser.
          <Box sx={{ mt: 1 }} data-testid="participant-message-recipients" aria-live="polite">
            <Typography variant="body2" sx={{ fontWeight: 600 }}>
              {tickedLine}
            </Typography>
            {tickedTestLine && (
              <Typography variant="body2" color="text.secondary">
                {tickedTestLine}
              </Typography>
            )}
          </Box>
        )}
        {group && (
          <Box sx={{ mt: 1 }} data-testid="participant-message-recipients" aria-live="polite">
            <Typography variant="body2" sx={{ fontWeight: 600 }}>
              {group.recipientsLine}
            </Typography>
            {group.testLine && (
              <Typography variant="body2" color="text.secondary">
                {group.testLine}
              </Typography>
            )}
            {group.costLine && (
              <Typography variant="body2" color="text.secondary">
                {group.costLine}
              </Typography>
            )}
            {group.deferredLine && (
              <Alert severity="info" sx={{ mt: 1 }} data-testid="participant-message-deferred">
                {group.deferredLine}
              </Alert>
            )}
            {group.warningLine && (
              <Alert severity="warning" sx={{ mt: 1 }} data-testid="participant-message-daily-warning">
                {group.warningLine}
              </Alert>
            )}
          </Box>
        )}
      </Box>

      {/* The ready reminder (the decision «Cere reconfirmarea»): the four boxes and the tick in one press. */}
      <Box data-testid="participant-message-reminder-fill">
        <GlyphButton icon="template" variant="outlined" onClick={pressFill} sx={TAP_TARGET}>
          {labels.reminderFill.button}
        </GlyphButton>
        <ConfirmDialog
          open={askingFill}
          spec={{
            title: labels.reminderFill.confirmTitle,
            body: labels.reminderFill.confirmBody,
            confirmLabel: labels.reminderFill.confirmGo,
            cancelLabel: labels.reminderFill.confirmCancel,
          }}
          onCancel={() => setAskingFill(false)}
          onConfirm={() => {
            setAskingFill(false);
            fill();
          }}
        />
      </Box>

      {/* The words, both languages side by side from `sm` — one text, never behind a tab (§354). */}
      {(
        [
          ["subject", labels.subject, labels.subjectHelp, maxSubject, false],
          ["body", labels.body, labels.bodyHelp, maxBody, true],
        ] as const
      ).map(([part, heading, help, max, multiline]) => (
        <Stack key={part} spacing={1} role="group" aria-labelledby={`participant-message-${part}`}>
          <Typography id={`participant-message-${part}`} variant="h2" component="h3" sx={HEADING_SX[3]}>
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
                // The words of the send to the people ticked the page came back from (§NNN); nothing after any other.
                defaultValue={kept?.[name]}
                required
                fullWidth
                multiline={multiline}
                minRows={multiline ? 6 : undefined}
                slotProps={{ htmlInput: { maxLength: max, "aria-describedby": `participant-message-${part}-help` } }}
              />
            ))}
          </Stack>
          {/* «Tradu din română» (§464): the English subject or text from the Romanian one — the
              club's own words only; no participant's data is in either box. */}
          <TranslateFieldButton en={`${part}En`} />
          <Typography id={`participant-message-${part}-help`} variant="caption" color="text.secondary">
            {help}
          </Typography>
          {part === "body" && (
            <Typography variant="caption" color="text.secondary" data-testid="participant-message-scope">
              {labels.bodyScope}
            </Typography>
          )}
          {part === "body" && identical && (
            <Alert severity="warning" data-testid="participant-message-identical">
              {labels.identical}
            </Alert>
          )}
        </Stack>
      ))}

      {/*
        «Cere reconfirmarea» (the decision «Cere reconfirmarea»): the email of each registration the send asks gets «Vin»
        beside «Nu mai pot ajunge». Optional for the person, and the help line says so: nobody is cancelled for not answering.
      */}
      <Box data-testid="participant-message-reconfirm">
        <FormControlLabel
          control={
            <Checkbox
              name="askReconfirm"
              value="1"
              checked={askReconfirm}
              onChange={(event) => {
                setAskReconfirm(event.target.checked);
                // The preview at once, for the tab open now: the box decides a button, not words being typed. The
                // browser has already toggled the box when this runs, so the preview reads what it now says.
                pause.cancel();
                refresh(language);
              }}
              slotProps={{ input: { "aria-describedby": "participant-message-reconfirm-help" } }}
              sx={CHECKBOX_TAP_TARGET}
            />
          }
          label={labels.reconfirm}
        />
        <Typography id="participant-message-reconfirm-help" variant="caption" color="text.secondary" component="p">
          {labels.reconfirmHelp}
        </Typography>
      </Box>

      {/*
        «Trimite și numărul de concurs și codul QR» (§943): each confirmed runner's email gets, under these words, their own
        race number, QR and desk code — the confirmation's block. The help line says who gets them and who does not.
      */}
      <Box data-testid="participant-message-qr">
        <FormControlLabel
          control={
            <Checkbox
              name="sendQr"
              value="1"
              checked={sendQr}
              onChange={(event) => {
                setSendQr(event.target.checked);
                // The preview at once, as the tick above: the box decides a block, not words being typed.
                pause.cancel();
                refresh(language);
              }}
              slotProps={{ input: { "aria-describedby": "participant-message-qr-help" } }}
              sx={CHECKBOX_TAP_TARGET}
            />
          }
          label={labels.sendQr}
        />
        <Typography id="participant-message-qr-help" variant="caption" color="text.secondary" component="p">
          {labels.sendQrHelp}
        </Typography>
      </Box>

      {/* The message as it will arrive (§364): the server renders it, the tabs pick whose copy. */}
      <Box data-testid="participant-message-preview">
        <Typography variant="h2" component="h3" sx={HEADING_SX[3]}>
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

      {/*
        «Confirmă trimiterea» (§NNN; the owner: «si vreau extra extra confirmare»): who the message goes to, said again
        right where it is sent — the preview stands between the choice and this button — and the number of recipients
        typed by hand. The send insists on that number (§287's guard, for a message that cannot be taken back): the
        server compares it with the rows it is about to write. Never kept: after a refusal it is typed again (§315).
      */}
      <Box data-testid="participant-message-confirm">
        <Typography variant="h2" component="h3" sx={HEADING_SX[3]}>
          {labels.confirm.title}
        </Typography>
        <Box sx={{ mb: 1.5 }} aria-live="polite" data-testid="participant-message-confirm-who">
          <Typography variant="body2" sx={{ fontWeight: 600 }}>
            {ticking ? `${labels.chosen.short} · ${tickedLine}` : group ? `${group.short} · ${group.recipientsLine}` : ""}
          </Typography>
          {ticking && tickedNames.length > 0 && (
            <Typography variant="body2" sx={{ wordBreak: "break-word" }}>
              {labels.chosen.names.replace("{names}", tickedNames.join(", "))}
            </Typography>
          )}
          {(ticking ? tickedTestLine : group?.testLine) && (
            <Typography variant="body2" color="text.secondary">
              {ticking ? tickedTestLine : group?.testLine}
            </Typography>
          )}
        </Box>
        <NeverKeptField
          name={labels.confirm.field}
          label={labels.confirm.count}
          helperText={labels.confirm.countHelp}
          required
          size="small"
          slotProps={{ htmlInput: { inputMode: "numeric", pattern: "[0-9]{1,5}", maxLength: 5, autoComplete: "off" } }}
          sx={{ width: "100%", maxWidth: 360 }}
        />
      </Box>

      <Box>
        {/*
          A plain submit button: the browser's own checks run on the press, and the form's question
          (`ActionForm confirm`) opens from the submit — the server's checks are the ones that matter.
        */}
        <Button type="submit" variant="contained" disabled={nobody} startIcon={<SendIcon fontSize="small" />} sx={TAP_TARGET}>
          {labels.send}
        </Button>
      </Box>
    </Stack>
  );
}
