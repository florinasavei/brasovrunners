import { toWallTimeInput } from "@/modules/events/domain/zoned-time";
import { DomainError } from "@/shared/errors/domain-error";

/*
  The words of an internal note, and the cell a file writes them in — the same for a registration's notes (§777, §785) and a
  volunteer's («Note interne» for volunteers). Pure: no table, no role test, no query. Each side keeps its own table, its own
  service and its own reader (`modules/registrations/notes.ts`, `modules/volunteers/volunteer-notes.ts`) and hands this module
  the rows it read; nothing here knows whose notes they are.
*/

/**
 * The words of a note, ready to store: line breaks as `\n`, the ends trimmed. Refused when nothing is left (`NOTE_EMPTY`) or when
 * more than `max` characters remain (`NOTE_TOO_LONG`), each naming the `box` the words were typed in. Counted in characters the way
 * the tables' checks count them (`char_length`), so an emoji is one.
 */
export function noteBodyOf(raw: unknown, max: number, box = "body"): string {
  const body = typeof raw === "string" ? raw.replace(/\r\n?/g, "\n").trim() : "";
  if (body === "") throw new DomainError("NOTE_EMPTY", "a note needs words", [box]);
  if ([...body].length > max) throw new DomainError("NOTE_TOO_LONG", `a note holds at most ${max} characters`, [box]);
  return body;
}

/** One live note as a file reads it: when, by which role (null when nobody can be named), and the words. */
export type ExportNote<R extends string = string> = { createdAt: Date; authorRole: R | null; body: string };

/**
 * The most characters the notes cell holds (§785). Excel stops at 32 767 per cell and silently cuts what is past it; the file
 * stops a little before, at a note's end, and says so on its last line.
 */
export const EXPORT_NOTES_CELL_MAX = 32_000;

/** The words the cell is written in, from the reader's language. */
export type ExportNotesWords<R extends string = string> = {
  /** The author's role, written out. */
  roles: Record<R, string>;
  /** Where no author can be named («cont șters» on a registration, «autor necunoscut» on a volunteer). */
  authorGone: string;
  /** The closing line when the cap cut the list («… (mai multe note pe pagina înscrierii)»). */
  more: string;
};

/**
 * One row's notes as a file's cell (§785): one note a line, newest first as given, each «<date> · <rolul autorului>: <text>» —
 * the date on the given clock (`dd.mm.yyyy hh:mm`), the author's role and never their name — a note's own line breaks kept inside
 * the cell. Empty for no notes. Cut at a note's end below `EXPORT_NOTES_CELL_MAX` with `words.more` as the last line, so the cell
 * is never past what Excel keeps.
 */
export function exportNotesCell<R extends string>(notes: readonly ExportNote<R>[] | undefined, timeZone: string, words: ExportNotesWords<R>): string {
  if (!notes || notes.length === 0) return "";
  const lines: string[] = [];
  let length = 0;
  for (const [index, note] of notes.entries()) {
    const [day, time] = toWallTimeInput(note.createdAt, timeZone).split("T");
    const [year, month, date] = day.split("-");
    const role = note.authorRole ? words.roles[note.authorRole] : words.authorGone;
    const line = `${date}.${month}.${year} ${time} · ${role}: ${note.body.replace(/\r\n?/g, "\n")}`;
    // The room the closing line needs is kept back unless this is the last note and it fits whole.
    const room = EXPORT_NOTES_CELL_MAX - (index === notes.length - 1 ? 0 : words.more.length + 1);
    if (index > 0 && length + 1 + line.length > room) {
      lines.push(words.more);
      break;
    }
    lines.push(line);
    length += (index > 0 ? 1 : 0) + line.length;
  }
  return lines.join("\n");
}

/** How many notes a marker's tooltip shows, newest first, and how much of each. */
export const TIP_NOTES = 3;
export const TIP_NOTE_CHARS = 280;

/**
 * A row's notes as its marker's tooltip (§NNN; the owner, 2026-11-12, of «1 notă» on the registrations list: «Ar trebui să văd
 * nota și pe tooltip, fără să deschid înscrierea»): the newest `TIP_NOTES`, as given, each «<when>: <words>» with a blank line
 * between two — a note's own line breaks kept (the tooltip is `pre-line`), a long one cut at `TIP_NOTE_CHARS` with «…» — and
 * `more(left)` as the last line when there are older ones. Empty for no notes. The caller says the clock and the words; nothing
 * here knows whose notes they are, and no author is named: who wrote it is the card's to say.
 */
export function notesTip(notes: readonly { createdAt: Date; body: string }[] | undefined, when: (at: Date) => string, more: (left: number) => string): string {
  if (!notes || notes.length === 0) return "";
  const shown = notes.slice(0, TIP_NOTES).map((note) => {
    const words = [...note.body.replace(/\r\n?/g, "\n").trim()];
    return `${when(note.createdAt)}: ${words.length > TIP_NOTE_CHARS ? `${words.slice(0, TIP_NOTE_CHARS).join("").trimEnd()}…` : words.join("")}`;
  });
  const left = notes.length - shown.length;
  return [...shown, ...(left > 0 ? [more(left)] : [])].join("\n\n");
}
