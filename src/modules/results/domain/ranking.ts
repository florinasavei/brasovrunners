import { categoryKeyOf } from "@/modules/registrations/statistics";
import type { SexChoice } from "@/modules/registrations/domain/sex";

/**
 * Race results, part 1 (§808): what a result is and how a list of them is ranked.
 *
 * Pure — no database, no React, no catalogue. The service (`../results.ts`) reads the rows and the
 * runners' answers, asks this module for the positions and writes them; a test asks the same function.
 */

/** The four ways a runner's race ends, in the order the select offers them. `event_result_status` at the database. */
export const RESULT_STATUSES = ["FINISHED", "DNF", "DNS", "DSQ"] as const;
export type ResultStatus = (typeof RESULT_STATUSES)[number];

export function isResultStatus(value: unknown): value is ResultStatus {
  return typeof value === "string" && (RESULT_STATUSES as readonly string[]).includes(value);
}

/** The longest note and the longest typed name; checked at the database too. */
export const RESULT_NOTE_MAX = 200;
export const RESULT_NAME_MAX = 120;
/** More rows than a race has runners: a save of more is a mistake, refused before the first is read. */
export const RESULTS_MAX = 5000;

/** What the ranking reads of one result: who, how it ended, how long it took, and the two answers a category is made of. */
export type Rankable = {
  bibNumber: number;
  status: ResultStatus;
  gunTimeMs: number | null;
  sex: SexChoice | null;
  /** The age on the event's day (`ageOnRaceDay`), or null without a birth date. */
  ageOnRaceDay: number | null;
};

/** What the ranking says of one result: three positions among the finishers and the category they were counted in. */
export type Ranked = {
  positionOverall: number | null;
  positionSex: number | null;
  positionCategory: number | null;
  /** The sex and band, `FEMALE:from30`; null without both answers (`categoryKeyOf`). */
  categoryKey: string | null;
};

/**
 * Positions for a group already sorted by time, fastest first: **ties share the position and the next one skips**
 * (1, 2, 2, 4 — the way a race is scored), never an arbitrary order between two equal times.
 */
function positionsOf(sorted: readonly Rankable[]): Map<number, number> {
  const positions = new Map<number, number>();
  let previous: number | null = null;
  let position = 0;
  sorted.forEach((row, index) => {
    if (row.gunTimeMs !== previous) {
      position = index + 1;
      previous = row.gunTimeMs;
    }
    positions.set(row.bibNumber, position);
  });
  return positions;
}

/** The finishers of a group, fastest first, the bib breaking an exact tie only so the order is stable. */
function byTime(rows: readonly Rankable[]): Rankable[] {
  return rows.filter((row) => row.status === "FINISHED" && row.gunTimeMs !== null).sort((a, b) => (a.gunTimeMs ?? 0) - (b.gunTimeMs ?? 0) || a.bibNumber - b.bibNumber);
}

/**
 * The positions of every result of one race, by bib: overall among the finishers by gun time, by sex among the
 * finishers of the same sex, by category among the finishers of the same sex and band. A runner who did not finish
 * (`DNF`, `DNS`, `DSQ`) has no position at all; a finisher without a sex has no position by sex and none by
 * category, one without a birth date has an overall and a sex position and no category — the Excel's footer says
 * «Fără categorie» for the same rows (§787), and nothing is guessed.
 */
export function rankResults(rows: readonly Rankable[]): Map<number, Ranked> {
  const finishers = byTime(rows);
  const overall = positionsOf(finishers);

  const groupsBy = (keyOf: (row: Rankable) => string | null): Map<number, number> => {
    const groups = new Map<string, Rankable[]>();
    for (const row of finishers) {
      const key = keyOf(row);
      if (key === null) continue;
      const group = groups.get(key) ?? [];
      group.push(row);
      groups.set(key, group);
    }
    const positions = new Map<number, number>();
    for (const group of groups.values()) for (const [bib, position] of positionsOf(group)) positions.set(bib, position);
    return positions;
  };
  const bySex = groupsBy((row) => row.sex);
  const byCategory = groupsBy((row) => categoryKeyOf(row.sex, row.ageOnRaceDay));

  const ranked = new Map<number, Ranked>();
  for (const row of rows) {
    const finished = row.status === "FINISHED" && row.gunTimeMs !== null;
    ranked.set(row.bibNumber, {
      positionOverall: finished ? (overall.get(row.bibNumber) ?? null) : null,
      positionSex: finished ? (bySex.get(row.bibNumber) ?? null) : null,
      positionCategory: finished ? (byCategory.get(row.bibNumber) ?? null) : null,
      // The category is what the runner is, finished or not: a DNF still belongs to «F, 30-39» in the club's own tally.
      categoryKey: categoryKeyOf(row.sex, row.ageOnRaceDay),
    });
  }
  return ranked;
}

/** The two halves of a stored category key, or null for a key that is not one (a row stored by another version). */
export function splitCategoryKey(key: string | null | undefined): { sex: SexChoice; band: string } | null {
  if (!key) return null;
  const [sex, band] = key.split(":");
  return (sex === "FEMALE" || sex === "MALE") && band ? { sex, band } : null;
}
