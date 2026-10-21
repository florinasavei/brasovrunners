"use client";

import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import { useEffect, useRef, useState } from "react";
import { useRecall } from "@/shared/forms/recall";
import CheckboxField from "@/shared/ui/CheckboxField";
import { openFoldsAround } from "@/shared/ui/fold";
import GlyphButton from "@/shared/ui/GlyphButton";
import StatusChip from "@/shared/ui/StatusChip";
import { EXTRA_ROWS, RESULT_ROW_BOXES, resultBox, type ResultRowBox, typedRowCountOf, typedRowKey } from "../rows";
import { RESULT_NAME_MAX, RESULT_NOTE_MAX } from "../domain/ranking";

/**
 * The lines of «Clasament»'s one form (§808): a line per runner, each with its boxes — «Timp», «Status», «Timp cip», «Notă» — named by
 * the line's key (`rows.ts`), all posted by the page's one «Salvează tot clasamentul».
 *
 * **Native boxes, not MUI's.** A race has a few hundred runners and a line is four to eight boxes: a `TextField` each is a thousand
 * and more components on a phone. A plain `<input>` and `<select>`, styled once (`BOX_SX`), is what the line needs and what keeps the
 * page's input latency where the event editor's is (§371) — still 44 pixels tall, still named by an `aria-label` that says whose
 * line it is, and still coming back as it was typed after a refusal (`useRecall`, §315), marked when the refusal named it.
 *
 * A client island because the recall and the «Adaugă un alergător» button are; plain data crosses the boundary — strings, numbers
 * and booleans — and never an element (`AGENTS.md` §14.1).
 */

/** What a line says of the runner's place after a save: the overall position, and the position by sex and by category beside it. */
export type PlaceView = { overall: string; detail: string };

export type ResultWords = {
  /** The boxes' own words, also their accessible names with the runner added. */
  time: string;
  status: string;
  chip: string;
  note: string;
  bib: string;
  name: string;
  sex: string;
  birthDate: string;
  place: string;
  timePlaceholder: string;
  birthDatePlaceholder: string;
  statusOptions: readonly { value: string; label: string }[];
  sexOptions: readonly { value: string; label: string }[];
  /** «Șterge rezultatul: {runner}» — the delete button's accessible name, `{runner}` filled here. */
  deleteFor: string;
  delete: string;
  /** «Prezent» on a checked-in runner's line. */
  present: string;
  /** What a line with no name says: the registration was erased. */
  nameless: string;
  /** «Adaugă un alergător neînscris». */
  addRow: string;
  /** The title of a typed runner's line, and its hint. */
  typedRow: string;
  /** «A acceptat să apară cu numele în clasament» — the typed line's tick (§810), and the line of help under it. */
  agreed: string;
  agreedHelp: string;
  /** «fără loc încă» in place of a position, on a line with no result yet. */
  noPlace: string;
  /** «fără loc» on a line whose saved result has none — a runner who dropped out, did not start or was disqualified. */
  noPlaceSettled: string;
};

/** The boxes of a line, as strings, exactly as the form would post them. */
export type LineValues = { time: string; status: string; chip: string; note: string };

export type RegisteredLine = {
  bibNumber: number;
  name: string;
  present: boolean;
  /** «Public: Participant #101» or «Public: cu numele» — what the published list would say of this runner. */
  publicLine: string;
  values: LineValues;
  place: PlaceView | null;
  /** A result is stored for this number: the line offers «Șterge». */
  hasResult: boolean;
};

export type TypedLine = {
  values: LineValues & { bib: string; name: string; sex: string; birthDate: string };
  /** The staff recorded that the person agreed to appear by name in the public ranking (`name_agreed_at` is set). */
  agreed: boolean;
  /** «Pe site: cu numele» or «Pe site: Participant #900» — what the published ranking would say of the stored line (`publicResultName`'s own answer), the registered lines' caption. */
  publicLine: string;
  place: PlaceView | null;
  hasResult: boolean;
};

/** The one delete form of the page (`ActionForm`, `id` below): a line's «Șterge» names it with `form=` and posts the number as its own value. */
export const DELETE_RESULT_FORM_ID = "delete-result";

const BOX_SX = {
  width: "100%",
  minHeight: 44,
  px: 1.25,
  font: "inherit",
  fontSize: "0.9375rem",
  color: "text.primary",
  bgcolor: "background.paper",
  border: 1,
  borderColor: "divider",
  borderRadius: 1,
  "&:focus-visible": { outline: "2px solid", outlineColor: "primary.main", outlineOffset: 1 },
  "&[aria-invalid=true]": { borderColor: "error.main", borderWidth: 2 },
} as const;

/** A caption above a box on a phone; from the medium width the column header says it once for every line. */
const CAPTION_SX = { display: { xs: "block", md: "none" }, color: "text.secondary", mb: 0.25 } as const;

/**
 * The captions' class: the typed runners' panel has no column header (its first cell holds four boxes the header could not name), so
 * its lines keep their captions at every width (§NNN; the consistency audit found its boxes unlabelled on a computer).
 */
const CAPTION_CLASS = "result-caption";

const LINE_SX = {
  display: "grid",
  gap: 1,
  alignItems: "start",
  gridTemplateColumns: {
    xs: "repeat(2, minmax(0, 1fr))",
    md: "minmax(0, 2.2fr) minmax(0, 1.2fr) minmax(0, 1.1fr) minmax(0, 1.1fr) minmax(0, 1fr) minmax(0, 1.4fr)",
  },
  borderTop: 1,
  borderColor: "divider",
  py: 1.5,
} as const;

/** Header over the lines, from the medium width up: the words of every column once. */
export function ResultsHeader({ words }: { words: ResultWords }) {
  return (
    <Box aria-hidden="true" sx={{ ...LINE_SX, display: { xs: "none", md: "grid" }, borderTop: 0, py: 0.5, color: "text.secondary" }}>
      <Typography variant="caption">{`${words.bib} · ${words.name}`}</Typography>
      <Typography variant="caption">{words.place}</Typography>
      <Typography variant="caption">{words.time}</Typography>
      <Typography variant="caption">{words.status}</Typography>
      <Typography variant="caption">{words.chip}</Typography>
      <Typography variant="caption">{words.note}</Typography>
    </Box>
  );
}

/** One native box, named, labelled for a screen reader with whose line it is, recalled after a refusal, marked when the refusal named it. */
function LineBox({
  name,
  caption,
  label,
  initial,
  kind = "text",
  options,
  maxLength,
  placeholder,
  inputMode,
  testId,
  span,
}: {
  name: string;
  caption: string;
  label: string;
  initial: string;
  kind?: "text" | "select";
  options?: readonly { value: string; label: string }[];
  maxLength?: number;
  placeholder?: string;
  inputMode?: "text" | "numeric" | "decimal";
  testId?: string;
  span?: boolean;
}) {
  const recall = useRecall();
  const value = recall.value(name) ?? initial;
  const named = recall.named(name);
  const common = {
    id: recall.idOf(name),
    name,
    "aria-label": label,
    "aria-invalid": named ? true : undefined,
    "data-testid": testId,
    sx: BOX_SX,
  };
  return (
    // On a phone the note takes the whole line; from the medium width it is the sixth column the header names, beside the others.
    // `minWidth: 0` (§NNN): a grid cell otherwise keeps its box's natural width and the line runs past the card.
    <Box sx={{ minWidth: 0, ...(span ? { gridColumn: { xs: "1 / -1", md: "auto" } } : {}) }}>
      <Typography variant="caption" sx={CAPTION_SX} className={CAPTION_CLASS} aria-hidden="true">
        {caption}
      </Typography>
      {kind === "select" ? (
        <Box component="select" key={recall.generation} {...common} defaultValue={value}>
          {(options ?? []).map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </Box>
      ) : (
        <Box
          component="input"
          key={recall.generation}
          {...common}
          type="text"
          defaultValue={value}
          maxLength={maxLength}
          placeholder={placeholder}
          inputMode={inputMode}
          autoComplete="off"
          autoCapitalize="off"
          spellCheck={false}
        />
      )}
      {named && recall.fieldError ? (
        <Typography variant="caption" color="error" sx={{ display: "block" }}>
          {recall.fieldError}
        </Typography>
      ) : null}
    </Box>
  );
}

/**
 * The place cell: «3» and, under it, the position by sex and by category; or a quiet «fără loc» — «încă» only for a line with no result
 * yet (`settled` false): a saved Abandon, Neprezentat or Descalificat will never have one.
 */
function PlaceCell({ place, words, settled }: { place: PlaceView | null; words: ResultWords; settled: boolean }) {
  return (
    <Box sx={{ gridColumn: { xs: "1 / -1", md: "auto" }, minWidth: 0, minHeight: { md: 44 }, display: "flex", alignItems: { md: "center" }, gap: 1, flexWrap: "wrap" }} data-testid="result-place">
      <Typography variant="caption" sx={{ ...CAPTION_SX, mb: 0 }} className={CAPTION_CLASS} aria-hidden="true">
        {words.place}:
      </Typography>
      {place ? (
        <>
          <Typography component="span" variant="body1" sx={{ fontWeight: 700 }}>
            {place.overall}
          </Typography>
          {place.detail !== "" && (
            <Typography component="span" variant="caption" color="text.secondary">
              {place.detail}
            </Typography>
          )}
        </>
      ) : (
        <Typography component="span" variant="caption" color="text.secondary">
          {settled ? words.noPlaceSettled : words.noPlace}
        </Typography>
      )}
    </Box>
  );
}

/** The four boxes every line has, in the column order; the line's key names them. */
function CommonBoxes({ rowKey, values, words, runner }: { rowKey: string; values: LineValues; words: ResultWords; runner: string }) {
  const box = (name: ResultRowBox) => resultBox(rowKey, name);
  return (
    <>
      <LineBox name={box("time")} caption={words.time} label={`${words.time}: ${runner}`} initial={values.time} placeholder={words.timePlaceholder} inputMode="text" maxLength={14} testId="result-time" />
      <LineBox name={box("status")} caption={words.status} label={`${words.status}: ${runner}`} initial={values.status} kind="select" options={words.statusOptions} testId="result-status" />
      <LineBox name={box("chip")} caption={words.chip} label={`${words.chip}: ${runner}`} initial={values.chip} placeholder={words.timePlaceholder} maxLength={14} testId="result-chip" />
      <LineBox name={box("note")} caption={words.note} label={`${words.note}: ${runner}`} initial={values.note} maxLength={RESULT_NOTE_MAX} testId="result-note" span />
    </>
  );
}

function DeleteButton({ bibNumber, runner, words }: { bibNumber: number; runner: string; words: ResultWords }) {
  return (
    <GlyphButton
      type="submit"
      form={DELETE_RESULT_FORM_ID}
      name="bibNumber"
      value={String(bibNumber)}
      icon="delete"
      color="error"
      variant="outlined"
      size="small"
      sx={{ minHeight: 44 }}
      aria-label={words.deleteFor.replace("{runner}", runner)}
      data-testid="result-delete"
    >
      {words.delete}
    </GlyphButton>
  );
}

/** The runners who registered: a line each, checked-in first, each with its four boxes and, once it has a result, «Șterge». */
export function RegisteredResultLines({ lines, words }: { lines: readonly RegisteredLine[]; words: ResultWords }) {
  return (
    <Box component="ul" sx={{ listStyle: "none", m: 0, p: 0 }} data-testid="result-lines">
      {lines.map((line) => {
        const runner = `#${line.bibNumber} ${line.name}`;
        return (
          <Box component="li" key={line.bibNumber} sx={LINE_SX} data-testid="result-line" data-bib={line.bibNumber}>
            <Box sx={{ gridColumn: { xs: "1 / -1", md: "auto" }, minWidth: 0 }}>
              <Typography component="p" variant="body2" sx={{ fontWeight: 700, overflowWrap: "anywhere" }}>
                <span data-testid="result-bib">#{line.bibNumber}</span> · {line.name}
              </Typography>
              <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.75, alignItems: "center", mt: 0.5 }}>
                {line.present && <StatusChip glyph="done" label={words.present} color="success" variant="outlined" />}
                <Typography variant="caption" color="text.secondary">
                  {line.publicLine}
                </Typography>
              </Box>
            </Box>
            <PlaceCell place={line.place} words={words} settled={line.hasResult} />
            <CommonBoxes rowKey={`r[${line.bibNumber}]`} values={line.values} words={words} runner={runner} />
            {line.hasResult && (
              <Box sx={{ gridColumn: "1 / -1" }}>
                <DeleteButton bibNumber={line.bibNumber} runner={runner} words={words} />
              </Box>
            )}
          </Box>
        );
      })}
    </Box>
  );
}

/**
 * The runners the club types by hand (no registration holds the number): the ones stored, the ones a CSV just added, and one blank line
 * more — «Adaugă un alergător neînscris» adds another. After a press the page draws as many lines as the form posted (`typedRowCountOf`
 * over the recalled names), so an import's new numbers stand in lines of their own with the name left for the club to write.
 */
export function TypedResultLines({ lines, words }: { lines: readonly TypedLine[]; words: ResultWords }) {
  // Keyed on the answer: every press re-mounts the lines from what the form posted, and the lines added by hand start again from none.
  const recall = useRecall();
  return <TypedLinesOf key={recall.generation} lines={lines} words={words} />;
}

function TypedLinesOf({ lines, words }: { lines: readonly TypedLine[]; words: ResultWords }) {
  const recall = useRecall();
  // The lines asked for by «Adaugă un alergător neînscris»: with scripts on, counted here; with scripts off, the press posts and the
  // answer comes back with one more in `extraRows`, which the hidden box below posts again (so a second press adds a second line).
  const requested = Number(recall.value(EXTRA_ROWS) ?? "0") || 0;
  const [extra, setExtra] = useState(0);
  // The lines the form posted that hold anything: the blank one at the end, posted empty, is not one — or every press would add another.
  const named = typedRowCountOf(recall.names());
  let posted = 0;
  for (let index = 0; index < named; index += 1) {
    if (RESULT_ROW_BOXES.some((box) => (recall.value(resultBox(typedRowKey(index), box)) ?? "").trim() !== "")) posted = index + 1;
  }
  const count = Math.max(lines.length, posted) + 1 + requested + extra;
  const container = useRef<HTMLDivElement>(null);
  // An import that added a number no registration holds puts a line here with the name left to write: the fold around it opens by itself
  // (§336 — a closed fold hides what needs doing), so the line is on the screen when the notice says it is there.
  const added = posted > lines.length;
  useEffect(() => {
    if (added) openFoldsAround(container.current);
  }, [added]);
  return (
    <Box ref={container} data-testid="typed-lines">
      <Box component="ul" sx={{ listStyle: "none", m: 0, p: 0, [`& .${CAPTION_CLASS}`]: { display: "block" } }}>
        {Array.from({ length: count }, (_, index) => {
          const line = lines[index];
          const key = typedRowKey(index);
          const box = (name: ResultRowBox) => resultBox(key, name);
          const initial = line?.values ?? { bib: "", name: "", sex: "", birthDate: "", time: "", status: "", chip: "", note: "" };
          const runner = `${words.typedRow} ${index + 1}`;
          return (
            <Box component="li" key={index} sx={LINE_SX} data-testid="typed-line" aria-label={runner}>
              <Box sx={{ gridColumn: { xs: "1 / -1", md: "auto" }, display: "grid", gap: 1, gridTemplateColumns: "minmax(0, 0.8fr) minmax(0, 2fr)", minWidth: 0 }}>
                <LineBox name={box("bib")} caption={words.bib} label={`${words.bib}: ${runner}`} initial={initial.bib} inputMode="numeric" maxLength={6} testId="typed-bib" />
                <LineBox name={box("name")} caption={words.name} label={`${words.name}: ${runner}`} initial={initial.name} maxLength={RESULT_NAME_MAX} testId="typed-name" />
                <LineBox name={box("sex")} caption={words.sex} label={`${words.sex}: ${runner}`} initial={initial.sex} kind="select" options={words.sexOptions} />
                <LineBox name={box("birthDate")} caption={words.birthDate} label={`${words.birthDate}: ${runner}`} initial={initial.birthDate} placeholder={words.birthDatePlaceholder} maxLength={10} inputMode="numeric" />
                {/* The agreement the person gave the staff (§810): off unless ticked, posted with the line, back as posted after a refusal. */}
                <Box sx={{ gridColumn: "1 / -1" }} data-testid="typed-agreed">
                  <CheckboxField name={box("agreed")} defaultChecked={line?.agreed ?? false} help={words.agreedHelp}>
                    {words.agreed}
                  </CheckboxField>
                </Box>
                {line && initial.name === "" && (
                  <Typography variant="caption" color="text.secondary" sx={{ gridColumn: "1 / -1" }}>
                    {words.nameless}
                  </Typography>
                )}
                {/* What the site would print for the stored line, drawn as the registered lines draw theirs: a tick saved while no notice describes the results names nobody. */}
                {line && (
                  <Typography variant="caption" color="text.secondary" sx={{ gridColumn: "1 / -1" }} data-testid="typed-public-line">
                    {line.publicLine}
                  </Typography>
                )}
              </Box>
              <PlaceCell place={line?.place ?? null} words={words} settled={line?.hasResult === true} />
              <CommonBoxes rowKey={key} values={initial} words={words} runner={runner} />
              {/* «Șterge» removes the stored result of the number the line was drawn with, whatever has been typed in the box since. */}
              {line?.hasResult && Number(initial.bib) > 0 && (
                <Box sx={{ gridColumn: "1 / -1" }}>
                  <DeleteButton bibNumber={Number(initial.bib)} runner={`#${initial.bib}`} words={words} />
                </Box>
              )}
            </Box>
          );
        })}
      </Box>
      <input type="hidden" name={EXTRA_ROWS} value={String(requested + extra)} />
      {/* A submit, so the button works with scripts off (`intent=addRow` answers with one more line); with scripts on it adds the line here and posts nothing. */}
      <GlyphButton
        type="submit"
        name="intent"
        value="addRow"
        icon="addPerson"
        variant="outlined"
        size="small"
        sx={{ minHeight: 44, mt: 1 }}
        onClick={(event) => {
          event.preventDefault();
          setExtra((current) => current + 1);
        }}
        data-testid="typed-add"
      >
        {words.addRow}
      </GlyphButton>
    </Box>
  );
}
