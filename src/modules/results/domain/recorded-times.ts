/**
 * «Timpi la sosire» (§NNN, amending §986 and §808; the owner, 2026-11-20: «For regular runners, if we submit a big [bib] multiple times we
 * track history and in the end we can choose what time to display»): the times «Cronometrare» recorded for each race number, read
 * back from the audit trail — never from a table of its own — for «Clasament» to draw under a line's «Timp» and for «Folosește» to
 * check the time it is asked to make the line's.
 *
 * Pure: the race's trail rows in (`../recorded-times.ts#loadRecordedTimesTrail` reads them in one query on `audit_logs_entity_idx`),
 * the times out. **Tolerant by design**, as «Istoricul sosirilor» (`finish-history.ts`): the rows are chosen by their plain action
 * strings and their metadata read field by field, so a row nobody could read is left out, never guessed.
 *
 * - **What counts.** A press at the line — its `finishLine: true` on `event_result.created` (the first «Sosit»),
 *   `event_result.updated` (a runner written off by mistake turned «Sosit») and `event_result.finish_duplicate` (every later press
 *   of a number stored already: the first time stays on the row, this one in the trail). A «Clasament» save, an import and
 *   «Folosește» itself write no `finishLine`: what a person typed or chose is no time recorded at the line.
 * - **What does not.** A press undone at the line (`event_result.deleted` with `undo: true`): it takes back the latest press of its
 *   number still standing, of its time — by the undo's own rule (`finish-line.ts#mayUndo`) nobody pressed the number after it.
 *   And everything before the race's last «Resetează clasamentul» (`event.results_reset`, §997): the trial it wiped.
 * - **Each time once**, in the order first pressed: two presses of the same time are one time, with who pressed it first and when.
 * - **Never over «Descalificat»** (`mayChooseRecordedTime`): a disqualification is changed by hand in «Stare», so a «Descalificat»
 *   line draws no block and the service refuses it; «Abandon» and «Neprezentat» keep it.
 */

/** The trail's actions the times are read from: the presses, the undo (a `deleted`), and the reset that wipes what came before. */
export const RECORDED_TIME_ACTIONS = ["event_result.created", "event_result.updated", "event_result.finish_duplicate", "event_result.deleted", "event.results_reset"] as const;

/** One audit row as the reader hands it over (the shape «Istoricul sosirilor» reads, `finish-history.ts#FinishHistoryRow`). */
export type RecordedTimeRow = { id: string; action: string; at: Date; actorName: string | null; metadata: unknown };

/** One time recorded at the line for a number: the time since the gun, who pressed it first — null for an account gone — and when. */
export type RecordedTime = { gunTimeMs: number; by: string | null; at: Date };

const record = (value: unknown): Record<string, unknown> => (value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {});
const whole = (value: unknown): number | null => (typeof value === "number" && Number.isInteger(value) && value > 0 ? value : null);

/** The rows in the order they were written: by the time, then by the row's id, as «Istoricul sosirilor» orders them. */
function chronological(rows: readonly RecordedTimeRow[]): RecordedTimeRow[] {
  return [...rows].sort((a, b) => a.at.getTime() - b.at.getTime() || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/**
 * Every number's recorded times, from the race's trail: the presses since the last reset, an undone one left out, each time once, in
 * the order first pressed. A number nobody pressed has no entry.
 */
export function recordedFinishTimes(rows: readonly RecordedTimeRow[]): Map<number, RecordedTime[]> {
  const ordered = chronological(rows);
  // «Resetează clasamentul» (§997) wiped every result and every press before it: only what came after it counts.
  let resetAtMs: number | null = null;
  for (const row of ordered) if (row.action === "event.results_reset") resetAtMs = Math.max(resetAtMs ?? row.at.getTime(), row.at.getTime());

  const presses: Array<{ bibNumber: number; gunTimeMs: number; by: string | null; at: Date; undone: boolean }> = [];
  for (const row of ordered) {
    if (resetAtMs !== null && row.at.getTime() <= resetAtMs) continue;
    const metadata = record(row.metadata);
    // Only the line's own rows: a «Clasament» save's, an import's and «Folosește»'s carry no `finishLine`.
    if (metadata.finishLine !== true) continue;
    const bibNumber = whole(metadata.bibNumber);
    if (bibNumber === null) continue;
    const gunTimeMs = whole(metadata.gunTimeMs);
    switch (row.action) {
      case "event_result.created":
      case "event_result.updated":
      case "event_result.finish_duplicate":
        if (gunTimeMs !== null) presses.push({ bibNumber, gunTimeMs, by: row.actorName, at: row.at, undone: false });
        break;
      case "event_result.deleted": {
        if (metadata.undo !== true) break;
        // The undo takes back the latest press of its number still standing — of its time, when the row says one.
        for (let index = presses.length - 1; index >= 0; index -= 1) {
          const press = presses[index];
          if (press.undone || press.bibNumber !== bibNumber || (gunTimeMs !== null && press.gunTimeMs !== gunTimeMs)) continue;
          press.undone = true;
          break;
        }
        break;
      }
    }
  }

  const times = new Map<number, RecordedTime[]>();
  for (const press of presses) {
    if (press.undone) continue;
    const ofNumber = times.get(press.bibNumber) ?? [];
    if (!ofNumber.some((time) => time.gunTimeMs === press.gunTimeMs)) ofNumber.push({ gunTimeMs: press.gunTimeMs, by: press.by, at: press.at });
    times.set(press.bibNumber, ofNumber);
  }
  return times;
}

/** One number's recorded times (`recordedFinishTimes`), none for a number nobody pressed. */
export function recordedTimesOf(rows: readonly RecordedTimeRow[], bibNumber: number): RecordedTime[] {
  return recordedFinishTimes(rows).get(bibNumber) ?? [];
}

/** Whether `gunTimeMs` is one of the times recorded: «Folosește» makes no other time a line's. */
export function isRecordedTime(times: readonly RecordedTime[], gunTimeMs: number): boolean {
  return times.some((time) => time.gunTimeMs === gunTimeMs);
}

/** A line's stored result as these rules read it — its state and its time since the gun —; null for a line with none. */
export type StoredLineResult = { status: string; gunTimeMs: number | null } | null;

/** The time a line shows «în clasament»: its stored «Sosit» time; null for a line with no result, or with another state, which has no time. */
export function shownFinishTime(stored: StoredLineResult): number | null {
  return stored?.status === "FINISHED" ? stored.gunTimeMs : null;
}

/**
 * Whether «Folosește» may make a recorded time a line's (§NNN): never over «Descalificat» — a decision of «Clasament», which the line
 * itself never undoes either (`finish-line.ts#pressMeets`), changed only by hand in «Stare» —; a line «Abandon» or «Neprezentat», or
 * one with no result, may: a runner written off by mistake who was pressed at the line. The page asks it before drawing the block,
 * the service before writing (`RESULT_DISQUALIFIED`).
 */
export function mayChooseRecordedTime(stored: StoredLineResult): boolean {
  return stored?.status !== "DSQ";
}

/**
 * Whether a line of «Clasament» draws its «Timpi la sosire» block: a line «Folosește» may change (`mayChooseRecordedTime`: never a
 * «Descalificat» one) with a choice — more than one time recorded for its number, or the one recorded time is not the line's «Timp»
 * (`shownFinishTime`). One recorded time equal to the line's, or none at all, draws nothing.
 */
export function recordedTimesOffered(times: readonly RecordedTime[], stored: StoredLineResult): boolean {
  if (!mayChooseRecordedTime(stored)) return false;
  const current = shownFinishTime(stored);
  return times.length > 1 || (times.length === 1 && times[0].gunTimeMs !== current);
}
