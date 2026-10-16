import type { RegistrationStatus } from "@/db/schema/registrations";
import { SHEET_TINT } from "@/theme/brand";
import { YES_CELL } from "./domain/club-runner";

/**
 * The colours of the registrations spreadsheet (§787, amended; the owner, 2026-10-16: «în excel export aș vrea
 * color codes în funcție de status și dacă sunt membri BVR»).
 *
 * **Conditional formatting, never a baked fill.** The file is the club's to edit offline: change a status and the
 * row must change colour, untick a member and its cells must lose the blue. So nothing here paints a cell; it writes
 * rules — «this fill, when `$M2` says CONFIRMED» — that Excel and LibreOffice evaluate on the cell's own value.
 * The one place a fill is baked is the legend under the statistics, which is a key, static by nature.
 *
 * **Three markings besides the status** (§NNN, amending §790; the owner, 2026-10-16: «în funcție de bifă să colorez» and
 * «also I wanna mark special guests differently»): the club's blue on the member cells follows the person's own tick
 * («Member tick (declared)» = "Yes"); a club runner without the tick — a member account, or the club typed in the form —
 * gets a pale lavender on the same cells, so the knowledge is not lost; and a special guest's identity cells (the race
 * number, the names, the «Special guest» cell) take a pale peach and an italic font, which reads even printed in grey.
 *
 * **One tint per kind of state**, not per state: the desk's chip says `success` for a confirmed registration and
 * `warning` for every other live one (`ui/DeskRow.tsx`), and gives a cancelled or expired one the error colour; the
 * sheet softens that — a whole red row shouts, so the ended states are grey — and gives the waiting list the sky
 * blue the chip has no colour for. The status column still says the state in words, so colour is never the only
 * way to read it. The palette is `SHEET_TINT` in `theme/brand.ts`, the one file a hex may live in.
 *
 * Pure, no workbook: `workbook.ts` hands the rules to the writer and `statistics.ts` draws the legend from the
 * same map, so a state that gains a tint here gains its rule and its legend line together.
 */

/** The row tints, in the legend's order: the first four colour a whole row by its status. */
export const ROW_TINTS = ["success", "warning", "info", "neutral"] as const;

export type RowTint = (typeof ROW_TINTS)[number];

/** Every status the registrations list knows, and the tint its row takes; a status absent here gets no rule. */
export const STATUS_TINT: Partial<Record<RegistrationStatus, RowTint>> = {
  CONFIRMED: "success",
  PENDING_EMAIL_CONFIRMATION: "warning",
  PENDING_DECLARATION: "warning",
  WAITLIST_OFFERED: "warning",
  WAITLISTED: "info",
  CANCELLED: "neutral",
  EXPIRED: "neutral",
};

/** The statuses a tint stands for, as the sheet's «Status» cell writes them — the legend lists these words. */
export function statusesOfTint(tint: RowTint): RegistrationStatus[] {
  return (Object.keys(STATUS_TINT) as RegistrationStatus[]).filter((status) => STATUS_TINT[status] === tint);
}

/** The fill of a tint, in the writer's own words (`#rrggbb`). */
export const TINT_FILL: Record<RowTint | "member" | "clubRunner" | "guest", string> = SHEET_TINT;

type Cell = { row: number; column: number };

/** One conditional-formatting rule in the writer's shape (`write-excel-file`'s `conditionalFormatting`). */
export type ColourRule = {
  cellRange: { from: Cell; to: Cell };
  condition: { formula: string };
  style: { backgroundColor: string; fontStyle?: "italic" };
};

/**
 * Where the columns are, 0-based, and how many data rows there are: everything the rules need to say which cells
 * they colour and which cell they read.
 */
export type ColourLayout = {
  statusColumn: number;
  /** «Member tick (declared)»: the blue follows it. */
  memberTickColumn: number;
  /** «Club runner»: a "Yes" here without the tick is the lavender. */
  clubRunnerColumn: number;
  /** The first and last of the member cells (`Club member`, `Member tick (declared)`, `Club runner`, `Member bib`), which sit side by side. */
  memberColumns: readonly [number, number];
  /** «Special guest», the Boolean column a guest's rule reads. */
  specialGuestColumn: number;
  /**
   * The special guest's identity cells as runs of side-by-side columns, first to last, each run its own rule (a rule
   * colours one rectangle): the race number, the names, and the «Special guest» cell itself.
   */
  guestCells: ReadonlyArray<readonly [number, number]>;
  lastColumn: number;
  rowCount: number;
};

/** A column's letters: 0 → A, 25 → Z, 26 → AA. */
export function columnLetters(index: number): string {
  return index < 26 ? String.fromCharCode(65 + index) : `${columnLetters(Math.floor(index / 26) - 1)}${String.fromCharCode(65 + (index % 26))}`;
}

const quoted = (word: string) => `"${word}"`;

/**
 * The rules, highest priority first (the writer numbers them in the order given, and where two rules colour one
 * cell the lower number wins): first the special guest's identity cells in peach and italic (one rule per run of
 * columns, since a rule colours one rectangle), then the club's blue on the member cells when the person ticked, then
 * the lavender on the same cells for a club runner without the tick — the guests' cells and the member cells do not
 * overlap, so only the order of the three groups against the status tints matters — and last one rule per row tint
 * over the whole row. A formula is `$M2="CONFIRMED"` written for the top-left cell of its range — the column fixed,
 * the row relative — with no leading `=`, which is how the file stores it. None for a file without rows.
 */
export function colourRules(layout: ColourLayout): ColourRule[] {
  if (layout.rowCount < 1) return [];
  const firstRow = 2;
  const lastRow = layout.rowCount + 1;
  const [firstMember, lastMember] = layout.memberColumns;
  const cell = (column: number) => `$${columnLetters(column)}${firstRow}`;
  const memberCells = { from: { row: firstRow, column: firstMember + 1 }, to: { row: lastRow, column: lastMember + 1 } };
  // A Boolean column: the criterion is the logical TRUE, not the text "TRUE" (as the footer's guest lines, §794).
  const guestRules = layout.guestCells.map(
    ([first, last]): ColourRule => ({
      cellRange: { from: { row: firstRow, column: first + 1 }, to: { row: lastRow, column: last + 1 } },
      condition: { formula: `${cell(layout.specialGuestColumn)}=TRUE` },
      style: { backgroundColor: TINT_FILL.guest, fontStyle: "italic" },
    }),
  );
  const rules: ColourRule[] = [
    ...guestRules,
    {
      cellRange: memberCells,
      condition: { formula: `${cell(layout.memberTickColumn)}=${quoted(YES_CELL)}` },
      style: { backgroundColor: TINT_FILL.member },
    },
    {
      cellRange: memberCells,
      condition: { formula: `AND(${cell(layout.clubRunnerColumn)}=${quoted(YES_CELL)},${cell(layout.memberTickColumn)}<>${quoted(YES_CELL)})` },
      style: { backgroundColor: TINT_FILL.clubRunner },
    },
  ];
  const status = `$${columnLetters(layout.statusColumn)}${firstRow}`;
  for (const tint of ROW_TINTS) {
    const statuses = statusesOfTint(tint);
    if (statuses.length === 0) continue;
    const tests = statuses.map((word) => `${status}=${quoted(word)}`);
    rules.push({
      cellRange: { from: { row: firstRow, column: 1 }, to: { row: lastRow, column: layout.lastColumn + 1 } },
      condition: { formula: tests.length === 1 ? tests[0] : `OR(${tests.join(",")})` },
      style: { backgroundColor: TINT_FILL[tint] },
    });
  }
  return rules;
}
