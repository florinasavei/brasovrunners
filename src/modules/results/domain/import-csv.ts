import { DomainError } from "@/shared/errors/domain-error";
import en from "../../../../messages/en.json";
import ro from "../../../../messages/ro.json";
import { parseResultTime } from "./result-time";
import { isResultStatus, RESULTS_MAX, type ResultStatus } from "./ranking";

/**
 * «Importă din CSV» (§808): the file a timing sheet or a spreadsheet gives the club, read into rows — nothing else.
 * It never touches the database and never saves: the page shows what was read in the boxes of the table, the club
 * reviews it, and «Salvează tot clasamentul» is the one thing that writes.
 *
 * The shape is `bib,time[,chip][,status]`, **with a header or without**, the separator a comma, a semicolon or a
 * tab (whichever the file's first line uses — a spreadsheet in a Romanian locale writes semicolons), cells quoted
 * or not. With a header, the columns are found by their names — in Romanian or English (`BIB`, `Nr.`, `Număr`,
 * `Time`, `Timp`, `Chip`, `Timp cip`, `Status`, `Stare`) — in any order, and an unknown column is ignored. Without
 * one, the columns are the shape above, and a third cell that is not a time is the status. Times are
 * `h:mm:ss`, `m:ss` or `mm:ss.t` (`parseResultTime`); the status is one of the four codes or its word in either
 * language (`FINISHED`, `sosit`, `DNF`, `abandon`, `DNS`, `neprezentat`, `DSQ`, `descalificat`); with none, a row
 * with a time finished and a row without one did not start.
 *
 * **The first bad line refuses the whole file**, naming the line and what is wrong with it, like the save does
 * (§791): half a file read is a ranking nobody checked.
 */

export type ParsedResultRow = {
  /** The line of the file it came from, from 1, the header counted. */
  line: number;
  bibNumber: number;
  status: ResultStatus;
  gunTimeMs: number | null;
  chipTimeMs: number | null;
};

/** What is wrong with a line, in the words the page's sentence picks (`Admin.results.csvProblems.<problem>`). */
export type ResultsCsvProblem =
  | "empty"
  | "tooLarge"
  | "tooMany"
  | "headerBib"
  | "bib"
  | "duplicate"
  | "time"
  | "chip"
  | "status"
  | "needsTime"
  | "timeWithStatus";

/** A file refused: the line (0 for the file as a whole) and the problem, for the sentence `RESULTS_IMPORT_INVALID` says. */
export class ResultsCsvError extends DomainError {
  readonly line: number;
  readonly problem: ResultsCsvProblem;

  constructor(line: number, problem: ResultsCsvProblem) {
    super("RESULTS_IMPORT_INVALID", `the results file cannot be read: line ${line}, ${problem}`, ["importText"]);
    this.name = "ResultsCsvError";
    this.line = line;
    this.problem = problem;
  }
}

/** Half a megabyte: a race's results are a few hundred lines; more is the wrong file. */
export const RESULTS_CSV_MAX_CHARS = 500_000;

/** A header or a status word, folded for comparing: lower case, no diacritics, letters and digits only. */
function fold(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

const BIB_HEADERS: ReadonlySet<string> = new Set(["bib", "nr", "no", "numar", "numarul", "nrconcurs", "numarconcurs", "numardeconcurs", "number", "startnumber", "nrstart"]);
const TIME_HEADERS: ReadonlySet<string> = new Set(["time", "timp", "guntime", "gun", "timpgun", "timpoficial", "oficial", "official", "officialtime", "timpfinal", "finishtime", "sosire"]);
const CHIP_HEADERS: ReadonlySet<string> = new Set(["chip", "cip", "chiptime", "timpcip", "net", "nettime", "timpnet"]);
const STATUS_HEADERS: ReadonlySet<string> = new Set(["status", "stare"]);

/**
 * The words the backoffice itself writes for the four states, in both languages, folded: the file «Descarcă clasamentul (CSV)» writes
 * (`t("results.status.<state>")`) can be imported again whatever the language it was downloaded in — read from the catalogues, so the
 * words on the page and the words the importer knows cannot drift apart.
 */
function catalogueStatusWords(): Record<string, ResultStatus> {
  const words: Record<string, ResultStatus> = {};
  for (const catalogue of [ro, en]) {
    for (const [status, word] of Object.entries(catalogue.Admin.results.status)) if (isResultStatus(status)) words[fold(word)] = status;
  }
  return words;
}

const STATUS_WORDS: Readonly<Record<string, ResultStatus>> = {
  ...catalogueStatusWords(),
  finished: "FINISHED",
  finish: "FINISHED",
  fin: "FINISHED",
  sosit: "FINISHED",
  terminat: "FINISHED",
  dnf: "DNF",
  abandon: "DNF",
  abandonat: "DNF",
  didnotfinish: "DNF",
  dns: "DNS",
  neprezentat: "DNS",
  absent: "DNS",
  didnotstart: "DNS",
  nuaplecat: "DNS",
  dsq: "DSQ",
  dq: "DSQ",
  descalificat: "DSQ",
  disqualified: "DSQ",
};

/** A status cell as a status, or null for a word nobody knows. */
export function resultStatusOfWord(word: string): ResultStatus | null {
  const upper = word.trim().toUpperCase();
  if (isResultStatus(upper)) return upper;
  return STATUS_WORDS[fold(word)] ?? null;
}

/** One line split into cells on `separator`, a double-quoted cell keeping its separators and `""` its quote. */
function splitLine(line: string, separator: string): string[] {
  const cells: string[] = [];
  let cell = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (quoted) {
      if (char === '"') {
        if (line[index + 1] === '"') {
          cell += '"';
          index += 1;
        } else quoted = false;
      } else cell += char;
    } else if (char === '"') quoted = true;
    else if (char === separator) {
      cells.push(cell.trim());
      cell = "";
    } else cell += char;
  }
  cells.push(cell.trim());
  return cells;
}

/** The separator the first line uses: tab, else semicolon, else comma (a one-column file has none and is read as comma). */
function separatorOf(line: string): string {
  if (line.includes("\t")) return "\t";
  if (line.includes(";")) return ";";
  return ",";
}

const NO_TIME: ReadonlySet<string> = new Set(["", "-", "–", "—"]);

type Columns = { bib: number; time: number; chip: number; status: number };

/** The columns a header names, or null when it names no bib column. Unknown names are ignored; the first of each kind wins. */
function columnsOf(header: readonly string[]): Columns | null {
  const columns: Columns = { bib: -1, time: -1, chip: -1, status: -1 };
  header.forEach((cell, index) => {
    const name = fold(cell);
    if (columns.bib < 0 && BIB_HEADERS.has(name)) columns.bib = index;
    else if (columns.time < 0 && TIME_HEADERS.has(name)) columns.time = index;
    else if (columns.chip < 0 && CHIP_HEADERS.has(name)) columns.chip = index;
    else if (columns.status < 0 && STATUS_HEADERS.has(name)) columns.status = index;
  });
  return columns.bib < 0 ? null : columns;
}

const BIB_CELL = /^#?\s*(\d{1,6})$/;

/** Whether a first cell is a number, so the line is data (a bad number is that line's refusal, not a header's); anything else is taken for a header. */
function isNumberCell(cell: string): boolean {
  return /^#?\s*\d+$/.test(cell.trim());
}

/**
 * Every row of a results file, or a `ResultsCsvError` naming the first line that cannot be read. The rows come in the
 * file's order; a bib named twice is refused at its second line (the table has one row per bib).
 */
export function parseResultsCsv(text: string): ParsedResultRow[] {
  if (text.length > RESULTS_CSV_MAX_CHARS) throw new ResultsCsvError(0, "tooLarge");
  const lines = text
    .replace(/^﻿/, "")
    .split(/\r\n|\n|\r/)
    .map((raw, index) => ({ raw, line: index + 1 }))
    .filter((entry) => entry.raw.trim() !== "");
  if (lines.length === 0) throw new ResultsCsvError(0, "empty");

  const separator = separatorOf(lines[0].raw);
  const firstCells = splitLine(lines[0].raw, separator);
  const hasHeader = !isNumberCell(firstCells[0] ?? "");
  let columns: Columns = { bib: 0, time: 1, chip: 2, status: 3 };
  if (hasHeader) {
    const named = columnsOf(firstCells);
    if (!named) throw new ResultsCsvError(lines[0].line, "headerBib");
    columns = named;
  }
  const data = hasHeader ? lines.slice(1) : lines;
  if (data.length === 0) throw new ResultsCsvError(0, "empty");
  if (data.length > RESULTS_MAX) throw new ResultsCsvError(0, "tooMany");

  const seen = new Set<number>();
  return data.map(({ raw, line }): ParsedResultRow => {
    const cells = splitLine(raw, separator);
    const cell = (index: number): string => (index >= 0 ? (cells[index] ?? "") : "");

    const bibMatch = BIB_CELL.exec(cell(columns.bib));
    const bibNumber = bibMatch ? Number(bibMatch[1]) : 0;
    if (bibNumber <= 0) throw new ResultsCsvError(line, "bib");
    if (seen.has(bibNumber)) throw new ResultsCsvError(line, "duplicate");
    seen.add(bibNumber);

    let timeCell = cell(columns.time);
    let chipCell = cell(columns.chip);
    let statusCell = cell(columns.status);
    // Without a header the third cell is the chip when it is a time and the status when it is a word (`101,45:12,DNF`).
    if (!hasHeader && statusCell === "" && chipCell !== "" && !NO_TIME.has(chipCell) && parseResultTime(chipCell) === null && resultStatusOfWord(chipCell) !== null) {
      statusCell = chipCell;
      chipCell = "";
    }
    if (NO_TIME.has(timeCell)) timeCell = "";
    if (NO_TIME.has(chipCell)) chipCell = "";

    const gunTimeMs = timeCell === "" ? null : parseResultTime(timeCell);
    if (timeCell !== "" && gunTimeMs === null) throw new ResultsCsvError(line, "time");
    const chipTimeMs = chipCell === "" ? null : parseResultTime(chipCell);
    if (chipCell !== "" && chipTimeMs === null) throw new ResultsCsvError(line, "chip");

    let status: ResultStatus;
    if (statusCell === "") status = gunTimeMs === null ? "DNS" : "FINISHED";
    else {
      const named = resultStatusOfWord(statusCell);
      if (!named) throw new ResultsCsvError(line, "status");
      status = named;
    }
    if (status === "FINISHED" && gunTimeMs === null) throw new ResultsCsvError(line, "needsTime");
    if (status !== "FINISHED" && (gunTimeMs !== null || chipTimeMs !== null)) throw new ResultsCsvError(line, "timeWithStatus");
    return { line, bibNumber, status, gunTimeMs, chipTimeMs };
  });
}
