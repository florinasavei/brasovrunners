"use client";

import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Checkbox from "@mui/material/Checkbox";
import FormControlLabel from "@mui/material/FormControlLabel";
import Paper from "@mui/material/Paper";
import Radio from "@mui/material/Radio";
import RadioGroup from "@mui/material/RadioGroup";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { type ChangeEvent, useState } from "react";
import { countForm } from "@/i18n/count-form";
import GlyphButton from "@/shared/ui/GlyphButton";
import type { ChangeValue } from "../diff";
import type { MediaFailure } from "../media";
import type { AsNewOutcome, DiffOutcome, ImportRefusal, OverOutcome, PreviewOutcome } from "../outcomes";
import {
  diffEventImportAction,
  importEventAsNewAction,
  importEventOverAction,
  previewEventImportAction,
} from "@/app/[locale]/admin/events/import/actions";

/** The input's id: the choose button is a label for it, so the native picker opens with no script. */
export const EVENT_IMPORT_INPUT_ID = "event-json-input";

/** Every word the island says, rendered on the server in the reader's language (the route GPX field's way). */
export type EventImportWords = {
  choose: string;
  chooseAgain: string;
  chooseHelp: string;
  reading: string;
  failed: string;
  summaryHeading: string;
  summaryFrom: string;
  summaryWhen: string;
  summaryWhenNone: string;
  summaryMedia: Record<"one" | "few" | "other", string>;
  summarySeries: string;
  modeHeading: string;
  asNewTitle: string;
  asNewHelp: string;
  asNewSlugs: string;
  asNewSuffixed: string;
  asNewAction: string;
  asNewWorking: string;
  asNewDone: string;
  overTitle: string;
  overHelp: string;
  overPick: string;
  overPickNone: string;
  overOption: string;
  overStatus: Record<string, string>;
  overRegistrations: Record<"one" | "few" | "other", string>;
  overDiffHeading: string;
  overNothing: string;
  overNow: string;
  overIncoming: string;
  overSlugsKept: string;
  overMediaHeading: string;
  overMediaState: Record<"same" | "copy" | "unverifiable", string>;
  overPublished: string;
  overPeople: string;
  overConfirm: string;
  overProductionHeading: string;
  overProductionBody: string;
  overProductionLabel: string;
  overAction: string;
  overWorking: string;
  overDone: Record<"one" | "few" | "other", string>;
  overOffered: string;
  open: string;
  mediaProblemsHeading: string;
  mediaProblems: Record<MediaFailure, string>;
  notes: { slugSuffixed: string; publicListOff: string; seriesNotApplied: string };
  languages: Record<"ro" | "en", string>;
  roles: Record<string, string>;
  fields: Record<string, string>;
  errors: Record<string, string>;
  refusals: Record<string, string>;
  values: { empty: string; yes: string; no: string; picture: string; pictureLoose: string; pictures: Record<"one" | "few" | "other", string> };
};

type PreviewOk = Extract<PreviewOutcome, { ok: true }>;
type DiffOk = Extract<DiffOutcome, { ok: true }>;
type AsNewOk = Extract<AsNewOutcome, { ok: true }>;
type OverOk = Extract<OverOutcome, { ok: true }>;

const fill = (template: string, values: Record<string, string | number>) =>
  Object.entries(values).reduce((text, [name, value]) => text.split(`{${name}}`).join(String(value)), template);

/**
 * «Importă un eveniment (JSON)» (§751): the file chosen, read by the server (never trusted from here),
 * then two ways in — **«Ca eveniment nou»**, a draft with the pictures copied, and **«Peste un eveniment
 * existent»**, which shows the diff of every field that would change, both languages, the pictures
 * named, and asks for a confirmation before anything is written; on production a second one that
 * names the event and how many people are registered for it.
 *
 * Nothing is kept on the server between the steps: the file's text stays here and goes with every
 * call, each of which reads it again and asks the session who is calling. The file is the browser's
 * only until a button presses.
 */
export default function EventImportPanel({
  locale,
  production,
  maxBytes,
  words,
}: {
  locale: string;
  production: boolean;
  maxBytes: number;
  words: EventImportWords;
}) {
  const [file, setFile] = useState<{ name: string; text: string } | null>(null);
  const [busy, setBusy] = useState<"reading" | "new" | "diff" | "over" | null>(null);
  const [problem, setProblem] = useState<{ sentence: string; detail?: string } | null>(null);
  const [preview, setPreview] = useState<PreviewOk | null>(null);
  const [mode, setMode] = useState<"new" | "over">("new");
  const [targetId, setTargetId] = useState("");
  const [diff, setDiff] = useState<DiffOk | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [typedTitle, setTypedTitle] = useState("");
  const [created, setCreated] = useState<AsNewOk | null>(null);
  const [applied, setApplied] = useState<OverOk | null>(null);

  const reset = () => {
    setProblem(null);
    setPreview(null);
    setDiff(null);
    setTargetId("");
    setConfirmed(false);
    setTypedTitle("");
    setCreated(null);
    setApplied(null);
  };

  const sentenceOf = (refusal: ImportRefusal) => {
    if (refusal.kind === "file") return { sentence: words.refusals[refusal.refusal] ?? words.failed, detail: refusal.detail };
    return { sentence: words.errors[refusal.code] ?? words.errors.VALIDATION_ERROR ?? words.failed, detail: refusal.detail };
  };

  const onChoose = async (event: ChangeEvent<HTMLInputElement>) => {
    const chosen = event.target.files?.[0];
    event.target.value = "";
    if (!chosen || busy) return;
    reset();
    if (chosen.size > maxBytes) {
      setProblem({ sentence: words.refusals.tooLarge });
      return;
    }
    setBusy("reading");
    try {
      const text = await chosen.text();
      const outcome = await previewEventImportAction(text, locale);
      if (!outcome.ok) {
        setProblem(sentenceOf(outcome));
        setFile(null);
        return;
      }
      setFile({ name: chosen.name, text });
      setPreview(outcome);
    } catch {
      setProblem({ sentence: words.failed });
    } finally {
      setBusy(null);
    }
  };

  const onPick = async (id: string) => {
    setTargetId(id);
    setDiff(null);
    setConfirmed(false);
    setTypedTitle("");
    setApplied(null);
    if (!id || !file) return;
    setProblem(null);
    setBusy("diff");
    try {
      const outcome = await diffEventImportAction(file.text, id);
      if (outcome.ok) setDiff(outcome);
      else setProblem(sentenceOf(outcome));
    } catch {
      setProblem({ sentence: words.failed });
    } finally {
      setBusy(null);
    }
  };

  const createNew = async () => {
    if (!file || busy) return;
    setProblem(null);
    setBusy("new");
    try {
      const outcome = await importEventAsNewAction(file.text, locale);
      if (outcome.ok) setCreated(outcome);
      else setProblem(sentenceOf(outcome));
    } catch {
      setProblem({ sentence: words.failed });
    } finally {
      setBusy(null);
    }
  };

  const applyOver = async () => {
    if (!file || !diff || busy) return;
    setProblem(null);
    setBusy("over");
    try {
      const outcome = await importEventOverAction({
        json: file.text,
        eventId: diff.target.id,
        expectedVersion: diff.target.version,
        translationVersions: diff.target.translationVersions,
        locale,
        ...(production ? { typedTitle, registrations: diff.target.registrations } : {}),
      });
      if (outcome.ok) setApplied(outcome);
      else setProblem(sentenceOf(outcome));
    } catch {
      setProblem({ sentence: words.failed });
    } finally {
      setBusy(null);
    }
  };

  const form = (count: number, forms: Record<"one" | "few" | "other", string>) => fill(forms[countForm(count, locale)], { count });

  const valueOf = (value: ChangeValue): string => {
    switch (value.type) {
      case "empty":
        return words.values.empty;
      case "boolean":
        return value.value ? words.values.yes : words.values.no;
      case "text":
        return value.value;
      case "picture":
        return value.known ? words.values.picture : words.values.pictureLoose;
      case "document":
        return value.pictures > 0 ? `${value.text} · ${form(value.pictures, words.values.pictures)}` : value.text;
    }
  };

  const mediaProblems = (outcome: AsNewOk | OverOk) =>
    outcome.media.problems.length > 0 && (
      <Alert severity="warning" data-testid="event-json-media-problems">
        <Typography variant="body2" sx={{ fontWeight: 600 }}>
          {words.mediaProblemsHeading}
        </Typography>
        <Box component="ul" sx={{ m: 0, pl: 2.5 }}>
          {outcome.media.problems.map((item) => (
            <li key={`${item.role}-${item.reason}`}>
              {words.roles[item.roleKey]}: {words.mediaProblems[item.reason]}
            </li>
          ))}
        </Box>
      </Alert>
    );

  const typedTitleOk = !production || (diff !== null && typedTitle.trim() !== "");
  const mayApply = diff !== null && diff.changes.length > 0 && diff.refusal === null && confirmed && typedTitleOk && busy === null;

  return (
    <Stack spacing={2.5} data-testid="event-json-panel">
      <Stack spacing={1}>
        <GlyphButton htmlFor={EVENT_IMPORT_INPUT_ID} icon="upload" variant="outlined" disabled={busy !== null} sx={{ minHeight: 44, alignSelf: "flex-start" }}>
          {busy === "reading" ? words.reading : file ? words.chooseAgain : words.choose}
          <input id={EVENT_IMPORT_INPUT_ID} type="file" accept=".json,application/json" hidden onChange={onChoose} data-testid="event-json-input" />
        </GlyphButton>
        <Typography variant="body2" color="text.secondary">
          {file ? file.name : words.chooseHelp}
        </Typography>
      </Stack>

      {problem && (
        <Alert severity="error" data-testid="event-json-problem">
          {problem.sentence}
          {problem.detail ? (
            <Typography component="p" variant="caption" sx={{ mt: 0.5, fontFamily: "monospace", wordBreak: "break-word" }}>
              {problem.detail}
            </Typography>
          ) : null}
        </Alert>
      )}

      {preview && (
        <Paper variant="outlined" sx={{ p: { xs: 1.5, sm: 2 } }} data-testid="event-json-summary">
          <Stack spacing={0.5}>
            <Typography variant="subtitle2" component="h2">
              {words.summaryHeading}
            </Typography>
            <Typography variant="body1" sx={{ fontWeight: 600 }}>
              {preview.summary.titles.ro}
            </Typography>
            <Typography variant="body2">{preview.summary.titles.en}</Typography>
            <Typography variant="body2" color="text.secondary">
              {preview.summary.day === "" ? words.summaryWhenNone : fill(words.summaryWhen, { day: preview.summary.day, zone: preview.summary.timezone })}
            </Typography>
            <Typography variant="body2" color="text.secondary">
              {fill(words.summaryFrom, { environment: preview.summary.environment, baseline: preview.summary.baseline || "—", date: preview.summary.exportedAt.slice(0, 10) })}
              {" · "}
              {form(preview.summary.media, words.summaryMedia)}
            </Typography>
            {preview.summary.seriesNotApplied && (
              <Typography variant="body2" color="text.secondary">
                {words.summarySeries}
              </Typography>
            )}
          </Stack>
        </Paper>
      )}

      {preview && !created && !applied && (
        <Stack spacing={1.5}>
          <Typography variant="subtitle2" component="h2">
            {words.modeHeading}
          </Typography>
          <RadioGroup
            value={mode}
            onChange={(event) => {
              setMode(event.target.value === "over" ? "over" : "new");
              setProblem(null);
            }}
            data-testid="event-json-mode"
          >
            <FormControlLabel value="new" control={<Radio />} label={words.asNewTitle} sx={{ minHeight: 44 }} data-testid="event-json-mode-new" />
            <FormControlLabel value="over" control={<Radio />} label={words.overTitle} sx={{ minHeight: 44 }} data-testid="event-json-mode-over" />
          </RadioGroup>

          {mode === "new" && (
            <Paper variant="outlined" sx={{ p: { xs: 1.5, sm: 2 } }} data-testid="event-json-new">
              <Stack spacing={1.5}>
                <Typography variant="body2">{words.asNewHelp}</Typography>
                <Typography variant="body2" color="text.secondary">
                  {fill(words.asNewSlugs, { ro: preview.newEvent.slugs.ro, en: preview.newEvent.slugs.en })}
                  {preview.newEvent.suffixed ? ` ${words.asNewSuffixed}` : ""}
                </Typography>
                <Box>
                  <GlyphButton icon="duplicate" variant="contained" onClick={createNew} disabled={busy !== null} sx={{ minHeight: 44 }} data-testid="event-json-new-button">
                    {busy === "new" ? words.asNewWorking : words.asNewAction}
                  </GlyphButton>
                </Box>
              </Stack>
            </Paper>
          )}

          {mode === "over" && (
            <Paper variant="outlined" sx={{ p: { xs: 1.5, sm: 2 } }} data-testid="event-json-over">
              <Stack spacing={2}>
                <Typography variant="body2">{words.overHelp}</Typography>
                <TextField
                  select
                  label={words.overPick}
                  value={targetId}
                  onChange={(event) => void onPick(event.target.value)}
                  fullWidth
                  slotProps={{ select: { native: true }, inputLabel: { shrink: true }, htmlInput: { "data-testid": "event-json-target" } }}
                >
                  <option value="">{words.overPickNone}</option>
                  {preview.targets.map((target) => (
                    <option key={target.id} value={target.id}>
                      {fill(words.overOption, { title: target.title, day: target.day || "—", status: words.overStatus[target.editorialStatus] ?? target.editorialStatus, registrations: form(target.registrations, words.overRegistrations) })}
                    </option>
                  ))}
                </TextField>

                {busy === "diff" && <Typography variant="body2">{words.reading}</Typography>}

                {diff && (
                  <Stack spacing={2} data-testid="event-json-diff">
                    <Typography variant="subtitle2" component="h3">
                      {fill(words.overDiffHeading, { count: diff.changes.length })}
                    </Typography>
                    {diff.changes.length === 0 ? (
                      <Alert severity="info">{words.overNothing}</Alert>
                    ) : (
                      <Stack spacing={1.5} component="ul" sx={{ m: 0, p: 0, listStyle: "none" }}>
                        {diff.changes.map((change) => (
                          <Box component="li" key={change.key} data-testid="event-json-change" data-key={change.key} sx={{ borderLeft: 3, borderColor: "divider", pl: 1.5 }}>
                            <Typography variant="body2" sx={{ fontWeight: 600 }}>
                              {words.fields[change.label] ?? change.label}
                              {change.locale ? ` (${words.languages[change.locale]})` : ""}
                            </Typography>
                            <Typography variant="body2" color="text.secondary" sx={{ wordBreak: "break-word" }}>
                              {words.overNow}: {valueOf(change.from)}
                            </Typography>
                            <Typography variant="body2" sx={{ wordBreak: "break-word" }}>
                              {words.overIncoming}: {valueOf(change.to)}
                            </Typography>
                          </Box>
                        ))}
                      </Stack>
                    )}

                    {diff.slugsKept && <Typography variant="body2">{words.overSlugsKept}</Typography>}
                    {diff.seriesNotApplied && <Typography variant="body2">{words.summarySeries}</Typography>}

                    {diff.media.length > 0 && (
                      <Stack spacing={0.5} data-testid="event-json-media">
                        <Typography variant="subtitle2" component="h3">
                          {words.overMediaHeading}
                        </Typography>
                        <Box component="ul" sx={{ m: 0, pl: 2.5 }}>
                          {diff.media.map((entry) => (
                            <li key={entry.role}>
                              {words.roles[entry.roleKey]}: {words.overMediaState[entry.state]}
                            </li>
                          ))}
                        </Box>
                      </Stack>
                    )}

                    <Typography variant="body2" color="text.secondary">
                      {diff.target.published ? `${words.overPublished} ` : ""}
                      {fill(words.overPeople, { count: form(diff.target.registrations, words.overRegistrations) })}
                    </Typography>

                    {diff.refusal && (
                      <Alert severity="error" data-testid="event-json-refusal">
                        {diff.refusal}
                      </Alert>
                    )}

                    {diff.changes.length > 0 && diff.refusal === null && (
                      <Stack spacing={1.5}>
                        <FormControlLabel
                          control={<Checkbox checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} />}
                          label={words.overConfirm}
                          sx={{ minHeight: 44, alignItems: "center" }}
                          data-testid="event-json-confirm"
                        />
                        {production && (
                          <Alert severity="warning" data-testid="event-json-production">
                            <Stack spacing={1}>
                              <Typography variant="body2" sx={{ fontWeight: 600 }}>
                                {words.overProductionHeading}
                              </Typography>
                              <Typography variant="body2">{fill(words.overProductionBody, { title: diff.target.titles.ro || diff.target.titles.en, count: form(diff.target.registrations, words.overRegistrations) })}</Typography>
                              <TextField
                                label={words.overProductionLabel}
                                value={typedTitle}
                                onChange={(event) => setTypedTitle(event.target.value)}
                                autoComplete="off"
                                slotProps={{ htmlInput: { "data-testid": "event-json-typed-title" } }}
                                fullWidth
                              />
                            </Stack>
                          </Alert>
                        )}
                        <Box>
                          <GlyphButton icon="confirm" variant="contained" color="warning" onClick={applyOver} disabled={!mayApply} sx={{ minHeight: 44 }} data-testid="event-json-over-button">
                            {busy === "over" ? words.overWorking : words.overAction}
                          </GlyphButton>
                        </Box>
                      </Stack>
                    )}
                  </Stack>
                )}
              </Stack>
            </Paper>
          )}
        </Stack>
      )}

      {created && (
        <Stack spacing={1.5} data-testid="event-json-result">
          <Alert severity="success">{words.asNewDone}</Alert>
          {created.notes.map((note) => (
            <Alert severity="info" key={`${note.code}-${"locale" in note ? note.locale : ""}`}>
              {note.code === "slugSuffixed" ? fill(words.notes.slugSuffixed, { language: words.languages[note.locale], slug: note.slug }) : words.notes[note.code]}
            </Alert>
          ))}
          {mediaProblems(created)}
          <Box>
            <GlyphButton href={created.path} icon="edit" variant="contained" sx={{ minHeight: 44 }} data-testid="event-json-open">
              {words.open}
            </GlyphButton>
          </Box>
        </Stack>
      )}

      {applied && (
        <Stack spacing={1.5} data-testid="event-json-result">
          <Alert severity="success">
            {form(applied.changed.length, words.overDone)}
            {applied.offered > 0 ? ` ${fill(words.overOffered, { count: applied.offered })}` : ""}
          </Alert>
          {mediaProblems(applied)}
          <Box>
            <GlyphButton href={applied.path} icon="edit" variant="contained" sx={{ minHeight: 44 }} data-testid="event-json-open">
              {words.open}
            </GlyphButton>
          </Box>
        </Stack>
      )}
    </Stack>
  );
}
