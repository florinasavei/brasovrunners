import type { RegistrationStatus } from "@/db/schema/registrations";
import { SHEET_TINT } from "@/theme/brand";
import { CLUB_RUNNER_YES } from "./domain/club-runner";

/**
 * The colours of the registrations spreadsheet (§787, amended; the owner, 2026-10-16: «în excel export aș vrea
 * color codes în funcție de status și dacă sunt membri BVR»).
 *
 * **Conditional formatting, never a baked fill.** The file is the club's to edit offline: change a status and the
 * row must change colour, untick a member and its cells must lose the blue. So nothing here paints a cell; it writes
 * rules — «this fill, when `$M2` says CONFIRMED» — that Excel and LibreOffice evaluate on the cell's own value.
 * The one place a fill is baked is the legend under the statistics, which is a key, static by nature.
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
export const TINT_FILL: Record<RowTint | "member", string> = SHEET_TINT;

type Cell = { row: number; column: number };

/** One conditional-formatting rule in the writer's shape (`write-excel-file`'s `conditionalFormatting`). */
export type ColourRule = {
  cellRange: { from: Cell; to: Cell };
  condition: { formula: string };
  style: { backgroundColor: string };
};

/**
 * Where the columns are, 0-based, and how many data rows there are: everything the rules need to say which cells
 * they colour and which cell they read.
 */
export type ColourLayout = {
  statusColumn: number;
  clubRunnerColumn: number;
  /** The first and last of the club-runner cells (`Club member`, `Club runner`, `Member bib`), which sit side by side. */
  memberColumns: readonly [number, number];
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
 * cell the lower number wins): the club's blue on a runner's membership cells beats the status tint under it,
 * then one rule per row tint over the whole row. A formula is `$M2="CONFIRMED"` written for the top-left cell of
 * its range — the column fixed, the row relative — with no leading `=`, which is how the file stores it. None for
 * a file without rows.
 */
export function colourRules(layout: ColourLayout): ColourRule[] {
  if (layout.rowCount < 1) return [];
  const firstRow = 2;
  const lastRow = layout.rowCount + 1;
  const [firstMember, lastMember] = layout.memberColumns;
  const rules: ColourRule[] = [
    {
      cellRange: { from: { row: firstRow, column: firstMember + 1 }, to: { row: lastRow, column: lastMember + 1 } },
      condition: { formula: `$${columnLetters(layout.clubRunnerColumn)}${firstRow}=${quoted(CLUB_RUNNER_YES)}` },
      style: { backgroundColor: TINT_FILL.member },
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
