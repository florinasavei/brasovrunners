"use client";

import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import { useState } from "react";
import { useRecall } from "@/shared/forms/recall";
import GlyphButton from "@/shared/ui/GlyphButton";
import StatusChip from "@/shared/ui/StatusChip";
import { typedRowCountOf, typedRowKey, resultBox, type ResultRowBox } from "../rows";
import { RESULT_NAME_MAX, RESULT_NOTE_MAX } from "../domain/ranking";

/**
 * The lines of «Clasament»'s one form (§NNN): a line per runner, each with its boxes — «Timp», «Status», «Timp cip», «Notă» — named by
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
  /** «Fără rezultat încă» in place of a position. */
  noPlace: string;
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
    <Box sx={span ? { gridColumn: "1 / -1" } : undefined}>
      <Typography variant="caption" sx={CAPTION_SX} aria-hidden="true">
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

/** The place cell: «3» and, under it, the position by sex and by category; or the quiet «fără rezultat». */
function PlaceCell({ place, words }: { place: PlaceView | null; words: ResultWords }) {
  return (
    <Box sx={{ gridColumn: { xs: "1 / -1", md: "auto" }, minHeight: { md: 44 }, display: "flex", alignItems: { md: "center" }, gap: 1, flexWrap: "wrap" }} data-testid="result-place">
      <Typography variant="caption" sx={{ ...CAPTION_SX, mb: 0 }} aria-hidden="true">
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
          {words.noPlace}
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
            <PlaceCell place={line.place} words={words} />
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
  const [extra, setExtra] = useState(0);
  const posted = typedRowCountOf(recall.names());
  const count = Math.max(lines.length, posted) + 1 + extra;
  return (
    <Box data-testid="typed-lines">
      <Box component="ul" sx={{ listStyle: "none", m: 0, p: 0 }}>
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
                {line && initial.name === "" && (
                  <Typography variant="caption" color="text.secondary" sx={{ gridColumn: "1 / -1" }}>
                    {words.nameless}
                  </Typography>
                )}
              </Box>
              <PlaceCell place={line?.place ?? null} words={words} />
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
      <GlyphButton icon="addPerson" variant="outlined" size="small" sx={{ minHeight: 44, mt: 1 }} onClick={() => setExtra((current) => current + 1)} data-testid="typed-add">
        {words.addRow}
      </GlyphButton>
    </Box>
  );
}
