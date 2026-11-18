/**
 * «Cronometrare» (§NNN, amending §850; the owner, 2026-11-18, three days before the race: «trebuie să mai am un view rapid, în
 * care să introduc și să se salveze instant, gen că a ajuns NR X, Y, Z» — «ca s-ar putea să ajungă mulți deodată»): the pure
 * parts of the finish line, shared by the service (`../results.ts`), the actions and the island (`../ui/FinishLine.tsx`).
 *
 * Pure — no database, no React, no catalogue, no clock of its own: every instant is handed in. So the island's arithmetic and
 * the server's checks are one set of functions a unit test walks (`tests/unit/results/finish-line.test.ts`):
 *
 * - **The clock.** The island counts on the server's clock, never the phone's: an anchor — the server's reading and the phone's
 *   monotonic clock (`performance.now()`) at the same moment — taken when the page loads, and again from every answer, at the
 *   middle of the request's round trip (`anchorFromAnswer`). A phone whose clock is minutes wrong stamps the right times.
 * - **The stamp.** A press is an instant on that clock (`pressedAtMs`). The time since the gun is floored to the second and is
 *   at least one second, as «Sosire» always stamped it. The server accepts the instant the island claims when its time is at
 *   least a second and at most the server's own time since the gun plus five seconds — a queued entry sent late keeps the
 *   moment the runner crossed, a phone running ahead cannot stamp a runner who has not arrived — and within a day of the gun;
 *   otherwise it stamps its own (`finishStamp`).
 * - **«Start».** The gun is the moment pressed when the server hears it within thirty seconds of its own clock, else the
 *   server's own (`raceGunMoment`); it may be pressed from three hours before the planned gun to six hours after
 *   (`raceGunWindowOpen`).
 * - **«⏱ Prinde timpul».** Each press keeps one instant, oldest first; the next number or elite pressed takes the oldest kept
 *   one instead of now (`takeOldestKept`).
 * - **The queue.** Every entry is kept, in the order pressed, until the server answered it; the oldest one waiting is sent
 *   first (`nextToSend`); an answer settles it (`settleEntry`), and the settled lines past `ENTRIES_KEPT` are dropped, never a
 *   waiting one. What the phone keeps in its storage is read back tolerantly (`readStoredFinishLine`): a value that is not
 *   an entry is left out, never thrown.
 * - **«Anulează».** A row the viewer wrote and nobody changed since — its creation and its last change the same instant, by
 *   the viewer — may be undone for ten minutes after it was written (`undoOpenUntil`).
 */

/** How long after the gun the line still stamps a time: a day (§850). Later, the times are typed on «Clasament». */
export const FINISH_WINDOW_MS = 24 * 3_600_000;
/** How far past the server's own time since the gun a claimed time may reach: a phone's clock a few seconds ahead. */
export const FINISH_CLAIM_AHEAD_MS = 5_000;
/** How long after it was written the viewer may undo their own press on the page: ten minutes. */
export const FINISH_UNDO_WINDOW_MS = 10 * 60_000;
/** «Start» may be pressed from this long before the planned gun… */
export const RACE_GUN_OPENS_BEFORE_MS = 3 * 3_600_000;
/** …to this long after it. */
export const RACE_GUN_CLOSES_AFTER_MS = 6 * 3_600_000;
/** How far from the server's clock the tap «Start» claims may be and still be the gun. */
export const RACE_GUN_CLAIM_TOLERANCE_MS = 30_000;
/** How many of the latest finishers «Ultimii sosiți» lists. */
export const RECENT_FINISHERS = 20;
/** How many kept times «⏱ Prinde timpul» holds at most: a press past it keeps nothing more. */
export const KEPT_TIMES_MAX = 50;
/** How many answered lines the phone keeps under the box; the waiting ones are always kept. */
export const ENTRIES_KEPT = 30;
/** The phone's storage key prefix: one entry per event. */
export const FINISH_STORAGE_PREFIX = "finish-line:";

const SECOND = 1000;

/** A finite whole number of milliseconds since the epoch, as a claim must be. */
export function isInstant(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && Number.isInteger(value) && value > 0;
}

// ---- The clock ---------------------------------------------------------------------------------------

/** The server's clock as the island reads it: the server's reading and the phone's monotonic clock at one moment. */
export type ServerAnchor = { serverMs: number; localMs: number };

/** The anchor the page brings: the server's `now` as it drew the page, against the phone's clock when the island woke. */
export function anchorAtLoad(serverNowMs: number, localNowMs: number): ServerAnchor {
  return { serverMs: serverNowMs, localMs: localNowMs };
}

/** The anchor an answer brings: the server read its clock somewhere in the round trip — its middle is the best guess. */
export function anchorFromAnswer(serverNowMs: number, sentAtLocalMs: number, receivedAtLocalMs: number): ServerAnchor {
  return { serverMs: serverNowMs, localMs: (sentAtLocalMs + Math.max(sentAtLocalMs, receivedAtLocalMs)) / 2 };
}

/** The server's clock now, read through an anchor, to the millisecond. */
export function serverNowOf(anchor: ServerAnchor, localNowMs: number): number {
  return Math.round(anchor.serverMs + (localNowMs - anchor.localMs));
}

// ---- The time since the gun ---------------------------------------------------------------------------

/** The time since the gun at `atMs`, as the line stamps it: floored to the second, at least one second. */
export function stampedGunTime(atMs: number, gunAtMs: number): number {
  return Math.max(SECOND, Math.floor((atMs - gunAtMs) / SECOND) * SECOND);
}

/** The clock's reading at `nowMs`: whole seconds since the gun, or null before it. */
export function clockReading(nowMs: number, gunAtMs: number): number | null {
  const elapsed = nowMs - gunAtMs;
  return elapsed < 0 ? null : Math.floor(elapsed / SECOND) * SECOND;
}

/** What the server makes of a press: the time it stamps (claimed or its own), or why it stamps none. */
export type FinishStamp = { kind: "stamped"; gunTimeMs: number; claimed: boolean } | { kind: "notStarted" } | { kind: "closed"; gunTimeMs: number };

/**
 * The time a press is stamped with (§NNN). The claimed instant counts when its time since the gun — floored to the second —
 * is at least a second, at most the server's own time plus `FINISH_CLAIM_AHEAD_MS`, and within `FINISH_WINDOW_MS`; anything
 * else, or no claim, is the server's own time, refused before the gun (`notStarted`) and past the window (`closed`).
 */
export function finishStamp(input: { claimedAtMs: number | null | undefined; gunAtMs: number; nowMs: number }): FinishStamp {
  const own = input.nowMs - input.gunAtMs;
  if (isInstant(input.claimedAtMs)) {
    const claim = Math.floor((input.claimedAtMs - input.gunAtMs) / SECOND) * SECOND;
    if (claim >= SECOND && claim <= own + FINISH_CLAIM_AHEAD_MS && claim <= FINISH_WINDOW_MS) return { kind: "stamped", gunTimeMs: claim, claimed: true };
  }
  if (own <= 0) return { kind: "notStarted" };
  if (own > FINISH_WINDOW_MS) return { kind: "closed", gunTimeMs: Math.floor(own / SECOND) * SECOND };
  return { kind: "stamped", gunTimeMs: stampedGunTime(input.nowMs, input.gunAtMs), claimed: false };
}

// ---- «Start» --------------------------------------------------------------------------------------------

/** Whether «Start» may be pressed at `nowMs`: from three hours before the planned gun to six hours after. */
export function raceGunWindowOpen(plannedGunMs: number, nowMs: number): boolean {
  return nowMs >= plannedGunMs - RACE_GUN_OPENS_BEFORE_MS && nowMs <= plannedGunMs + RACE_GUN_CLOSES_AFTER_MS;
}

/** The gun a press stands for: the tap the island claims when it is within thirty seconds of the server's clock, else the server's own. */
export function raceGunMoment(claimedAtMs: number | null | undefined, nowMs: number): number {
  return isInstant(claimedAtMs) && Math.abs(claimedAtMs - nowMs) <= RACE_GUN_CLAIM_TOLERANCE_MS ? claimedAtMs : nowMs;
}

// ---- «Anulează» ------------------------------------------------------------------------------------------

/** A stored row, as much as the undo reads of it. */
export type UndoableRow = { status: string; createdAt: Date; updatedAt: Date; updatedByStaffUserId: string | null };

/**
 * Until when the viewer may undo a row on the page (epoch ms), or null when it is not theirs to undo: a «Sosit» row the viewer
 * wrote and nobody changed since — written once (`created_at` = `updated_at`), by the viewer — for ten minutes after it was
 * written. A row corrected on «Clasament», or a runner written off and turned «Sosit» at the line, was changed: not undone here.
 */
export function undoOpenUntil(row: UndoableRow, actorId: string): number | null {
  if (row.status !== "FINISHED" || row.updatedByStaffUserId !== actorId) return null;
  if (row.createdAt.getTime() !== row.updatedAt.getTime()) return null;
  return row.createdAt.getTime() + FINISH_UNDO_WINDOW_MS;
}

/** Whether the viewer may undo the row at `nowMs`. */
export function mayUndo(row: UndoableRow, actorId: string, nowMs: number): boolean {
  const until = undoOpenUntil(row, actorId);
  return until !== null && nowMs <= until;
}

// ---- «⏱ Prinde timpul» -------------------------------------------------------------------------------------

/** One more kept time, oldest first; past `KEPT_TIMES_MAX` nothing more is kept. */
export function keepTime(kept: readonly number[], atMs: number): number[] {
  return kept.length >= KEPT_TIMES_MAX ? [...kept] : [...kept, atMs];
}

/** The oldest kept time, taken for the press, and what stays kept; none kept, the press takes now. */
export function takeOldestKept(kept: readonly number[]): { atMs: number | null; rest: number[] } {
  return kept.length === 0 ? { atMs: null, rest: [] } : { atMs: kept[0], rest: kept.slice(1) };
}

/** A kept time dismissed with its ✕. */
export function dropKept(kept: readonly number[], index: number): number[] {
  return kept.filter((_, at) => at !== index);
}

// ---- What the server answers ----------------------------------------------------------------------------

/** One of «Ultimii sosiți»: a stored «Sosit», the latest written first. */
export type RecentFinisherView = {
  resultId: string;
  bibNumber: number;
  /** An elite's label («Eticheta pe BIB»), said instead of the number; null for everybody else. */
  label: string | null;
  /** The runner's name as the backoffice reads it; null for a row with none. */
  name: string | null;
  gunTimeMs: number;
  positionOverall: number | null;
  /** An elite the Administrator left out of the ranking (§910): «în afara clasamentului» in place of a place. */
  outOfRanking: boolean;
  /** Who last wrote the row — their display name — or null when that account is gone. */
  by: string | null;
  /** Whether the row was changed after it was written: «modificat de», not «introdus de». */
  changed: boolean;
  /** Until when the viewer may undo it (epoch ms), or null when it is not theirs to undo. */
  undoUntilMs: number | null;
};

/** One elite's button: a registration marked «Elită» with a race number, or a line of the race's elite list. */
export type EliteButtonView = {
  /** `r:<registration id>` or `l:<line id>`: a key for the list, never shown. */
  key: string;
  kind: "registration" | "line";
  /** What the bib prints where the number goes (`bib-elite.ts`). */
  label: string;
  /** The full name, small under the label, so two «Andrei» are told apart. */
  name: string;
  /** The number a press records; null — drawn disabled — for a line or a registration with none. */
  bibNumber: number | null;
  /** Already «Sosit»: the time, and the button cannot be pressed. */
  finishedGunTimeMs: number | null;
};

/** The page's state as every answer carries it, so the island stays the server's. */
export type FinishLineState = {
  serverNowMs: number;
  gunAtMs: number;
  /** «Start» was pressed: the gun is the moment pressed, not the editor's plan. */
  gunPressed: boolean;
  recent: RecentFinisherView[];
  elites: EliteButtonView[];
  finished: number;
  withNumber: number;
};

/** What became of one press. */
export type FinishEntryOutcome =
  | {
      kind: "recorded";
      bibNumber: number;
      name: string | null;
      label: string | null;
      gunTimeMs: number;
      positionOverall: number | null;
      outOfRanking: boolean;
      /** The server had it already, from this viewer at this second: a retry, shown as saved. */
      again: boolean;
    }
  | {
      kind: "duplicate";
      bibNumber: number;
      name: string | null;
      label: string | null;
      /** This press's own time, written to the trail. */
      gunTimeMs: number;
      /** The time stored first, which stays. */
      storedGunTimeMs: number;
      /** Who stored it — their display name — or null when that account is gone. */
      storedBy: string | null;
    }
  | { kind: "refused"; code: string; bibNumber: number | null; gunTimeMs: number | null };

/** A press's answer, or that the staff session ended (the entry waits; sign in again). */
export type FinishPressAnswer = { kind: "answer"; outcome: FinishEntryOutcome; state: FinishLineState | null } | { kind: "session" };

/** An undo's answer. */
export type FinishUndoAnswer =
  | { kind: "answer"; outcome: { kind: "undone"; bibNumber: number } | { kind: "refused"; code: string }; state: FinishLineState | null }
  | { kind: "session" };

// ---- The queue -------------------------------------------------------------------------------------------

/** One press on this phone: waiting, or answered. */
export type FinishEntry = {
  id: string;
  bibNumber: number;
  /** An elite's label when the press was its button; null for a number typed. */
  label: string | null;
  /** The press, on the server's clock. */
  pressedAtMs: number;
  outcome: FinishEntryOutcome | null;
};

/** The press appended, waiting; the answered lines past `ENTRIES_KEPT` dropped, oldest first — never a waiting one. */
export function pressEntry(entries: readonly FinishEntry[], entry: Omit<FinishEntry, "outcome">): FinishEntry[] {
  return trimEntries([...entries, { ...entry, outcome: null }]);
}

function trimEntries(entries: FinishEntry[]): FinishEntry[] {
  const answered = entries.filter((entry) => entry.outcome !== null).length;
  let drop = Math.max(0, answered - ENTRIES_KEPT);
  return entries.filter((entry) => {
    if (drop > 0 && entry.outcome !== null) {
      drop -= 1;
      return false;
    }
    return true;
  });
}

/** The entry to send next: the oldest one waiting, in the order pressed. */
export function nextToSend(entries: readonly FinishEntry[]): FinishEntry | undefined {
  return entries.find((entry) => entry.outcome === null);
}

/** How many wait to be sent. */
export function waitingCount(entries: readonly FinishEntry[]): number {
  return entries.filter((entry) => entry.outcome === null).length;
}

/** The entry answered. An entry already answered is not answered twice. */
export function settleEntry(entries: readonly FinishEntry[], id: string, outcome: FinishEntryOutcome): FinishEntry[] {
  return trimEntries(entries.map((entry) => (entry.id === id && entry.outcome === null ? { ...entry, outcome } : entry)));
}

/** How a line under the box reads an entry: waiting, saved, already there, or refused. */
export function entryStateOf(entry: FinishEntry): "waiting" | "saved" | "duplicate" | "refused" {
  if (entry.outcome === null) return "waiting";
  if (entry.outcome.kind === "recorded") return "saved";
  return entry.outcome.kind;
}

// ---- The phone's storage -----------------------------------------------------------------------------------

/** The storage key of one event's line on this phone. */
export function finishStorageKey(eventId: string): string {
  return `${FINISH_STORAGE_PREFIX}${eventId}`;
}

/** What one event's line keeps on the phone: the presses and the kept times. */
export type StoredFinishLine = { entries: FinishEntry[]; kept: number[] };

const isText = (value: unknown): value is string => typeof value === "string";
const isNumberOrNull = (value: unknown): value is number | null => value === null || (typeof value === "number" && Number.isFinite(value));

function readOutcome(value: unknown): FinishEntryOutcome | null | undefined {
  if (value === null) return null;
  if (!value || typeof value !== "object") return undefined;
  const outcome = value as Record<string, unknown>;
  if (outcome.kind === "recorded" && typeof outcome.bibNumber === "number" && typeof outcome.gunTimeMs === "number") {
    return {
      kind: "recorded",
      bibNumber: outcome.bibNumber,
      name: isText(outcome.name) ? outcome.name : null,
      label: isText(outcome.label) ? outcome.label : null,
      gunTimeMs: outcome.gunTimeMs,
      positionOverall: typeof outcome.positionOverall === "number" ? outcome.positionOverall : null,
      outOfRanking: outcome.outOfRanking === true,
      again: outcome.again === true,
    };
  }
  if (outcome.kind === "duplicate" && typeof outcome.bibNumber === "number" && typeof outcome.gunTimeMs === "number" && typeof outcome.storedGunTimeMs === "number") {
    return {
      kind: "duplicate",
      bibNumber: outcome.bibNumber,
      name: isText(outcome.name) ? outcome.name : null,
      label: isText(outcome.label) ? outcome.label : null,
      gunTimeMs: outcome.gunTimeMs,
      storedGunTimeMs: outcome.storedGunTimeMs,
      storedBy: isText(outcome.storedBy) ? outcome.storedBy : null,
    };
  }
  if (outcome.kind === "refused" && isText(outcome.code) && isNumberOrNull(outcome.bibNumber ?? null) && isNumberOrNull(outcome.gunTimeMs ?? null)) {
    return { kind: "refused", code: outcome.code, bibNumber: (outcome.bibNumber as number | null) ?? null, gunTimeMs: (outcome.gunTimeMs as number | null) ?? null };
  }
  return undefined;
}

/**
 * One event's line as the phone kept it, read back tolerantly: nothing stored, a value that is not JSON or not the shape,
 * and every entry or kept time that is not one, are left out — the page works without them, as without the storage.
 */
export function readStoredFinishLine(raw: string | null | undefined): StoredFinishLine {
  const empty: StoredFinishLine = { entries: [], kept: [] };
  if (!raw) return empty;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return empty;
  }
  if (!parsed || typeof parsed !== "object") return empty;
  const stored = parsed as { entries?: unknown; kept?: unknown };
  const entries: FinishEntry[] = [];
  const seen = new Set<string>();
  for (const item of Array.isArray(stored.entries) ? stored.entries : []) {
    if (!item || typeof item !== "object") continue;
    const entry = item as Record<string, unknown>;
    if (!isText(entry.id) || seen.has(entry.id)) continue;
    if (typeof entry.bibNumber !== "number" || !Number.isInteger(entry.bibNumber) || entry.bibNumber <= 0) continue;
    if (!isInstant(entry.pressedAtMs)) continue;
    const outcome = readOutcome(entry.outcome ?? null);
    if (outcome === undefined) continue;
    seen.add(entry.id);
    entries.push({ id: entry.id, bibNumber: entry.bibNumber, label: isText(entry.label) ? entry.label : null, pressedAtMs: entry.pressedAtMs, outcome });
  }
  const kept = (Array.isArray(stored.kept) ? stored.kept : []).filter(isInstant).slice(0, KEPT_TIMES_MAX);
  return { entries: trimEntries(entries), kept };
}

/** One event's line, ready for the phone's storage. */
export function storedFinishLine(line: StoredFinishLine): string {
  return JSON.stringify({ entries: line.entries, kept: line.kept });
}
