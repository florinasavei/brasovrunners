import { ageOn } from "@/modules/registrations/domain/age";
import type { SexChoice } from "@/modules/registrations/domain/sex";
import { readTypedDate } from "@/shared/forms/pickers/wall-values";
import { parseResultTime } from "./result-time";
import { isResultStatus, RESULT_NAME_MAX, RESULT_NOTE_MAX, type ResultStatus } from "./ranking";

/**
 * One row of the «Clasament» form, read (§808): what the boxes say, as values, or what is wrong with them. Pure — the service asks
 * it row by row and adds the two things only the database knows (whether a registration holds the race number, and whether another
 * row names the same one).
 *
 * The rules, in the order they are asked, the first that fails being the row's refusal:
 *
 * 1. a **race number** is a whole number from 1 (a registered row's is its key's);
 * 2. a **status** is blank or one of the four codes; blank is `FINISHED` when a time is typed and `DNS` when none is;
 * 3. a **finisher has a time** (`h:mm:ss`, `m:ss`, `mm:ss.t`) and may have the chip's; **the others have neither**;
 * 4. a **note** is at most `RESULT_NOTE_MAX` characters;
 * 5. for a runner the club types by hand, a **name** of at most `RESULT_NAME_MAX` characters (whether it is *needed* is the service's
 *    question), a **sex** blank or one of the registration form's two answers, and a **birth date** blank or a day that is not after
 *    the race's.
 *
 * 6. for a typed runner, the **agreement tick** («A acceptat să apară cu numele în clasament», §810) needs a name to show: ticked with the
 *    name left blank is `agreedNameMissing`. A registered runner's row ignores the tick — their name follows their own.
 *
 * A row with every box empty is not a result and is `blank`: the table draws a line for every registered runner, and most lines
 * stay empty until the runner finishes. A tick alone on an otherwise empty typed line is no result either: it is blank.
 */

/** What is wrong with a row, in the words the page's sentence picks (`Admin.results.problems.<problem>`). */
export type ResultRowProblem =
  | "bib"
  | "bibDuplicate"
  | "bibNotConfirmed"
  | "bibRegistered"
  | "status"
  | "time"
  | "timeMissing"
  | "timeWithStatus"
  | "chip"
  | "note"
  | "nameMissing"
  | "nameLong"
  | "agreedNameMissing"
  | "sex"
  | "birthDate"
  | "tooMany";

/** The posted boxes of one row, all strings; `kind` says whether the row is a registered runner's (`r[…]`) or typed (`n[…]`). */
export type RowBoxes = {
  kind: "registered" | "typed";
  bib: string;
  name: string;
  sex: string;
  birthDate: string;
  time: string;
  status: string;
  chip: string;
  note: string;
  /** "on" when the typed line's agreement tick was posted; anything else (or nothing) is unticked. Ignored for a registered row. */
  agreed?: string;
};

/** A row, read: the values the save compares and writes. `name`, `sex`, `birthDate` and `nameAgreed` count only if no registration holds the bib. */
export type ReadRow = {
  bibNumber: number;
  status: ResultStatus;
  gunTimeMs: number | null;
  chipTimeMs: number | null;
  note: string | null;
  name: string | null;
  sex: SexChoice | null;
  birthDate: string | null;
  /** A typed row: the staff recorded that the person agreed to appear by name in the public ranking. Always false for a registered row. */
  nameAgreed: boolean;
};

export type ReadResult = { kind: "blank" } | { kind: "row"; row: ReadRow } | { kind: "refused"; problem: ResultRowProblem; boxes: readonly string[] };

const refuse = (problem: ResultRowProblem, ...boxes: string[]): ReadResult => ({ kind: "refused", problem, boxes });

/** A sex box as a sex: the two codes in either case, or null for nothing; `undefined` for anything else. */
function readSex(text: string): SexChoice | null | undefined {
  const upper = text.trim().toUpperCase();
  if (upper === "") return null;
  return upper === "FEMALE" || upper === "MALE" ? upper : undefined;
}

/**
 * Reads one row. `eventDay` is the race's calendar day, `YYYY-MM-DD`, in the event's own zone — the day a typed birth date is counted
 * against (a birth date after it is a typo, and a runner not yet born is no runner).
 */
export function readResultRow(boxes: RowBoxes, eventDay: string): ReadResult {
  const typed = boxes.kind === "typed";
  const bibText = boxes.bib.trim();
  const status = boxes.status.trim().toUpperCase();
  const time = boxes.time.trim();
  const chip = boxes.chip.trim();
  const note = boxes.note.trim();
  const name = boxes.name.trim();
  const sexText = boxes.sex.trim();
  const birthText = boxes.birthDate.trim();
  // The tick of a registered row means nothing (their name follows their own tick on the form): only a typed row has one.
  const agreed = typed && (boxes.agreed ?? "").trim() === "on";

  const everyBoxEmpty = status === "" && time === "" && chip === "" && note === "" && (!typed || (bibText === "" && name === "" && sexText === "" && birthText === ""));
  if (everyBoxEmpty) return { kind: "blank" };

  // 1. The race number: a typed row names it in a box of its own, a registered row never has a bad one.
  const bibNumber = /^\d{1,6}$/.test(bibText) ? Number(bibText) : 0;
  if (bibNumber <= 0) return refuse("bib", typed ? "bib" : "time");

  // 2 and 3. The status, and what a time has to be beside it.
  if (status !== "" && !isResultStatus(status)) return refuse("status", "status");
  const resolved: ResultStatus = isResultStatus(status) ? status : time === "" ? "DNS" : "FINISHED";
  let gunTimeMs: number | null = null;
  let chipTimeMs: number | null = null;
  if (resolved === "FINISHED") {
    if (time === "") return refuse("timeMissing", "time");
    gunTimeMs = parseResultTime(time);
    if (gunTimeMs === null) return refuse("time", "time");
    if (chip !== "") {
      chipTimeMs = parseResultTime(chip);
      if (chipTimeMs === null) return refuse("chip", "chip");
    }
  } else if (time !== "" || chip !== "") {
    return refuse("timeWithStatus", time !== "" ? "time" : "chip");
  }

  // 4. The note.
  if (note.length > RESULT_NOTE_MAX) return refuse("note", "note");

  // 5. What the club typed about a runner it typed by hand.
  let sex: SexChoice | null = null;
  let birthDate: string | null = null;
  if (typed) {
    if (name.length > RESULT_NAME_MAX) return refuse("nameLong", "name");
    if (agreed && name === "") return refuse("agreedNameMissing", "name");
    const read = readSex(sexText);
    if (read === undefined) return refuse("sex", "sex");
    sex = read;
    if (birthText !== "") {
      const day = readTypedDate(birthText);
      const age = day === "" ? null : ageOn(day, eventDay);
      if (day === "" || age === null || age < 0) return refuse("birthDate", "birthDate");
      birthDate = day;
    }
  }

  return {
    kind: "row",
    row: { bibNumber, status: resolved, gunTimeMs, chipTimeMs, note: note === "" ? null : note, name: name === "" ? null : name, sex, birthDate, nameAgreed: agreed },
  };
}
