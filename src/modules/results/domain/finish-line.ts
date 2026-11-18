/**
 * «Cronometrare» (§NNN, amending §850; the owner, 2026-11-18, three days before the race: «trebuie să mai am un view rapid, în
 * care să introduc și să se salveze instant, gen că a ajuns NR X, Y, Z» — «ca s-ar putea să ajungă mulți deodată»): the pure
 * parts of the finish line, shared by the service (`../results.ts`), the actions and the islands (`../ui/FinishLine.tsx`,
 * `../ui/RaceGunPress.tsx`, `../ui/server-clock.ts`).
 *
 * Pure — no database, no React, no catalogue, no clock of its own: every instant is handed in. So the islands' arithmetic and
 * the server's checks are one set of functions a unit test walks (`tests/unit/results/finish-line.test.ts`):
 *
 * - **The clock.** The islands count on the server's clock, never the phone's: the phone's **wall clock** (`Date.now()`) plus
 *   an offset. Not `performance.now()`: on most phones that clock stops while the screen is locked, so a press after a sleep
 *   between two finishers would be stamped early by the sleep; the wall clock keeps time asleep. The offset is measured over a
 *   round trip, as NTP measures it (`sampleOfRoundTrip`): the page asks the server's clock as it wakes, and every answer carries
 *   it — the server's instants at the arrival and at the answer against the phone's at the send and at the receipt. The best
 *   sample is kept (`betterSample`): a measured one over the page's own reading (late by the page's delivery, and old after a
 *   back navigation); of two that agree, the one of the shorter round trip; of two that disagree — a clock moved —, the newer.
 *   It is kept on the phone too (`readStoredClockSample`, half a day), so the next page starts measured. A phone whose clock is
 *   minutes wrong stamps the right times.
 * - **The stamp.** A press is an instant on that clock (`pressedAtMs`). The time since the gun is floored to the second and is
 *   at least one second, as «Sosire» always stamped it. The server accepts the instant the island claims when its time is at
 *   least a second and at most the server's own time since the gun plus five seconds — a queued entry sent late keeps the
 *   moment the runner crossed, a phone running ahead cannot stamp a runner who has not arrived — and within a day of the gun;
 *   otherwise it stamps its own (`finishStamp`). A press that arrives more than a day and three hours after the gun is refused
 *   whatever it claims: a queue that waited that long is «Clasament»'s to type.
 * - **A stored row of the number** (`pressMeets`). «Sosit» already: the same viewer at the same second is a retry, anybody else
 *   a press again; «Descalificat», or a decision written on «Clasament» after the moment pressed: the decision stays; only an
 *   «Abandon» or a «Neprezentat» older than the press is a runner written off by mistake, turned «Sosit».
 * - **«Start».** The gun is the moment pressed when the server hears it at most ten seconds later and at most five seconds
 *   before its own clock, else the server's own (`raceGunMoment`); it may be pressed from three hours before the planned gun to
 *   six hours after (`raceGunWindowOpen`).
 * - **«⏱ Prinde timpul».** Each press keeps one instant, oldest first; the next number or elite pressed takes the oldest kept
 *   one instead of now (`takeOldestKept`). The kept instants are the staff account's that kept them (`keptOf`, `withKept`).
 * - **The queue.** Every entry is one staff account's press (`staffId`), kept, in the order pressed, until the server answered
 *   it; the oldest one of the viewer's own waiting is sent first (`nextToSend`) — another account's, left on the same phone,
 *   is shown and never sent from this one; an answer settles it (`settleEntry`), a press the server could not record is
 *   settled refused after `FINISH_FAILED_TRIES` answers, so the queue moves on, and the settled lines past `ENTRIES_KEPT` are
 *   dropped, never a waiting one. What the phone keeps in its storage is read back tolerantly (`readStoredFinishLine`): a value
 *   that is not an entry is left out, never thrown.
 * - **«Anulează».** A row the viewer's own press at the line wrote (its `event_result.created` row of the trail says
 *   `finishLine` and names the row), that nobody changed since — its creation and its last change the same instant, by the
 *   viewer — and whose number nobody pressed again since, may be undone for ten minutes after it was written
 *   (`undoTrailOf`, `undoOpenUntil`); pressed again, the line says so (`undoClosedBy`) and the correction is «Clasament»'s.
 */

/** How long after the gun the line still stamps a time: a day (§850). Later, the times are typed on «Clasament». */
export const FINISH_WINDOW_MS = 24 * 3_600_000;
/** How long past that day a press may still arrive, its moment within the day: a phone that found its signal again. Later, refused. */
export const FINISH_ARRIVAL_GRACE_MS = 3 * 3_600_000;
/** How far past the server's own time since the gun a claimed time may reach: a phone's clock a few seconds ahead. */
export const FINISH_CLAIM_AHEAD_MS = 5_000;
/** How long after it was written the viewer may undo their own press on the page: ten minutes. */
export const FINISH_UNDO_WINDOW_MS = 10 * 60_000;
/** «Start» may be pressed from this long before the planned gun… */
export const RACE_GUN_OPENS_BEFORE_MS = 3 * 3_600_000;
/** …to this long after it. */
export const RACE_GUN_CLOSES_AFTER_MS = 6 * 3_600_000;
/** How long before the server hears it the tap «Start» claims may be and still be the gun: a slow upload at a crowded start line. */
export const RACE_GUN_CLAIM_TOLERANCE_MS = 10_000;
/** How many of the latest finishers «Ultimii sosiți» lists. */
export const RECENT_FINISHERS = 20;
/** How many kept times «⏱ Prinde timpul» holds at most: a press past it keeps nothing more. */
export const KEPT_TIMES_MAX = 50;
/** How many answered lines the phone keeps under the box; the waiting ones are always kept. */
export const ENTRIES_KEPT = 30;
/** How many times the server may answer that it could not record one press before the phone settles it refused, its time to write down. */
export const FINISH_FAILED_TRIES = 3;
/** The phone's storage key prefix: one entry per event. */
export const FINISH_STORAGE_PREFIX = "finish-line:";
/** The phone's storage key of the server's clock: one for every event (an event's key ends in its id, never this word). */
export const CLOCK_STORAGE_KEY = `${FINISH_STORAGE_PREFIX}clock`;
/** How long a clock sample the phone kept is believed by the next page: half a day, a race day. */
export const CLOCK_SAMPLE_KEPT_MS = 12 * 3_600_000;
/** How seldom a page shown again asks the server's clock once more: a clock moved under the page is rare, an answer re-measures anyway. */
export const CLOCK_RESYNC_MS = 5 * 60_000;
/** What two samples may disagree by beyond their round trips and still agree: the milliseconds rounded on both sides, a clock's drift. */
const CLOCK_SLACK_MS = 50;

const SECOND = 1000;

/** A finite whole number of milliseconds since the epoch, as a claim must be. */
export function isInstant(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && Number.isInteger(value) && value > 0;
}

// ---- The clock ---------------------------------------------------------------------------------------

/** The server's clock as the islands read it: how far it is from the phone's wall clock, and how well that is known. */
export type ClockSample = {
  /** The server's clock minus the phone's (`Date.now()`), in milliseconds. */
  offsetMs: number;
  /** The round trip it was measured over, the server's own time taken out — twice its error at most; null for the page's reading, never measured. */
  rttMs: number | null;
  /** When it was taken, on the server's clock. */
  atServerMs: number;
};

/** The server's two instants of one request, as every answer carries them: when it arrived, and when it was answered. */
export type ServerClockReading = { receivedAtMs: number; answeredAtMs: number };

/** A round trip: the phone's wall clock at the send and at the receipt, around the server's reading. */
export type RoundTrip = ServerClockReading & { sentAtMs: number; backAtMs: number };

/**
 * The page's own reading: the server's `now` as it drew the page, against the phone's clock as the island woke. Late by the page's
 * delivery — and old after a back navigation, which draws the page again from the browser's memory — so any measured one replaces it.
 */
export function sampleOfPage(serverNowMs: number, wallNowMs: number): ClockSample {
  return { offsetMs: serverNowMs - wallNowMs, rttMs: null, atServerMs: serverNowMs };
}

/**
 * A sample measured over a round trip, as NTP reads one: the offset is the middle of the two legs, the round trip the phone's
 * wait less the server's own work. Null for a trip that cannot be — the phone's clock moved back under it (a receipt before the
 * send, a wait shorter than the server's work) — so it is never kept.
 */
export function sampleOfRoundTrip(trip: RoundTrip): ClockSample | null {
  const { sentAtMs, receivedAtMs, answeredAtMs, backAtMs } = trip;
  if (![sentAtMs, receivedAtMs, answeredAtMs, backAtMs].every((value) => typeof value === "number" && Number.isFinite(value))) return null;
  const onPhone = backAtMs - sentAtMs;
  const onServer = answeredAtMs - receivedAtMs;
  if (onPhone < 0 || onServer < 0 || onPhone + CLOCK_SLACK_MS < onServer) return null;
  return { offsetMs: Math.round((receivedAtMs - sentAtMs + (answeredAtMs - backAtMs)) / 2), rttMs: Math.max(0, onPhone - onServer), atServerMs: answeredAtMs };
}

/**
 * The sample to go on with, of the one kept and a new one: a measured one over the page's reading (of two page readings, the
 * newer); of two measured ones that agree — their offsets no further apart than half of both round trips — the one of the
 * shorter round trip, the better known; of two that disagree — the phone's clock was moved —, the newer.
 */
export function betterSample(current: ClockSample | null, candidate: ClockSample): ClockSample {
  if (!current) return candidate;
  if (candidate.rttMs === null) return current.rttMs === null && candidate.atServerMs >= current.atServerMs ? candidate : current;
  if (current.rttMs === null) return candidate;
  const agree = Math.abs(candidate.offsetMs - current.offsetMs) <= (candidate.rttMs + current.rttMs) / 2 + CLOCK_SLACK_MS;
  if (!agree) return candidate.atServerMs >= current.atServerMs ? candidate : current;
  return candidate.rttMs <= current.rttMs ? candidate : current;
}

/** The server's clock now, read through a sample — the phone's own clock while none is known — to the millisecond. */
export function serverNowAt(sample: ClockSample | null, wallNowMs: number): number {
  return Math.round(wallNowMs + (sample?.offsetMs ?? 0));
}

/** A sample the phone kept, read back tolerantly: a measured one of the last half day, else none — never thrown. */
export function readStoredClockSample(raw: string | null | undefined, wallNowMs: number): ClockSample | null {
  if (!raw) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  const { offsetMs, rttMs, atServerMs } = parsed as Record<string, unknown>;
  if (typeof offsetMs !== "number" || !Number.isFinite(offsetMs) || typeof rttMs !== "number" || !Number.isFinite(rttMs) || rttMs < 0 || !isInstant(atServerMs)) return null;
  const sample: ClockSample = { offsetMs, rttMs, atServerMs };
  return Math.abs(serverNowAt(sample, wallNowMs) - atServerMs) <= CLOCK_SAMPLE_KEPT_MS ? sample : null;
}

/** A measured sample, ready for the phone's storage. */
export function storedClockSample(sample: ClockSample): string {
  return JSON.stringify({ offsetMs: sample.offsetMs, rttMs: sample.rttMs, atServerMs: sample.atServerMs });
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
 * The time a press is stamped with (§NNN). A press arriving more than `FINISH_WINDOW_MS` and `FINISH_ARRIVAL_GRACE_MS` after the gun
 * is `closed` whatever it claims. Else the claimed instant counts when its time since the gun — floored to the second — is at least a
 * second, at most the server's own time plus `FINISH_CLAIM_AHEAD_MS`, and within `FINISH_WINDOW_MS`; anything else, or no claim, is the
 * server's own time, refused before the gun (`notStarted`) and past the window (`closed`).
 */
export function finishStamp(input: { claimedAtMs: number | null | undefined; gunAtMs: number; nowMs: number }): FinishStamp {
  const own = input.nowMs - input.gunAtMs;
  if (own > FINISH_WINDOW_MS + FINISH_ARRIVAL_GRACE_MS) return { kind: "closed", gunTimeMs: Math.floor(own / SECOND) * SECOND };
  if (isInstant(input.claimedAtMs)) {
    const claim = Math.floor((input.claimedAtMs - input.gunAtMs) / SECOND) * SECOND;
    if (claim >= SECOND && claim <= own + FINISH_CLAIM_AHEAD_MS && claim <= FINISH_WINDOW_MS) return { kind: "stamped", gunTimeMs: claim, claimed: true };
  }
  if (own <= 0) return { kind: "notStarted" };
  if (own > FINISH_WINDOW_MS) return { kind: "closed", gunTimeMs: Math.floor(own / SECOND) * SECOND };
  return { kind: "stamped", gunTimeMs: stampedGunTime(input.nowMs, input.gunAtMs), claimed: false };
}

/** A stored row of a number, as much as a press reads of it. */
export type MetRow = { status: string; gunTimeMs: number | null; updatedAt: Date; updatedByStaffUserId: string | null };

/**
 * What a press does to the stored row of its number (§NNN; the owner: «se poate întâmpla și ca mai mulți voluntari să treacă
 * același număr»): `retry` — «Sosit» by the same viewer at the same second, a press already saved —; `pressedAgain` — «Sosit» by
 * anybody else, or by the viewer another second: the first stays —; `decided` — «Descalificat», which the line never undoes, or an
 * «Abandon» / «Neprezentat» written after the moment pressed (`atMs`), a later decision a queued press must not overwrite —; and
 * `turned` — an «Abandon» or a «Neprezentat» written before the press: a runner written off by mistake, who crossed the line.
 */
export function pressMeets(row: MetRow, press: { actorId: string; gunTimeMs: number; atMs: number }): "retry" | "pressedAgain" | "decided" | "turned" {
  if (row.status === "FINISHED") return row.updatedByStaffUserId === press.actorId && row.gunTimeMs === press.gunTimeMs ? "retry" : "pressedAgain";
  if (row.status === "DSQ" || press.atMs < row.updatedAt.getTime()) return "decided";
  return "turned";
}

// ---- «Start» --------------------------------------------------------------------------------------------

/** Whether «Start» may be pressed at `nowMs`: from three hours before the planned gun to six hours after. */
export function raceGunWindowOpen(plannedGunMs: number, nowMs: number): boolean {
  return nowMs >= plannedGunMs - RACE_GUN_OPENS_BEFORE_MS && nowMs <= plannedGunMs + RACE_GUN_CLOSES_AFTER_MS;
}

/**
 * The gun a press stands for: the tap the island claims when the server hears it at most `RACE_GUN_CLAIM_TOLERANCE_MS` later and it is
 * at most `FINISH_CLAIM_AHEAD_MS` ahead of the server's clock, else the server's own.
 */
export function raceGunMoment(claimedAtMs: number | null | undefined, nowMs: number): number {
  if (!isInstant(claimedAtMs)) return nowMs;
  return claimedAtMs - nowMs <= FINISH_CLAIM_AHEAD_MS && nowMs - claimedAtMs <= RACE_GUN_CLAIM_TOLERANCE_MS ? claimedAtMs : nowMs;
}

// ---- «Anulează» ------------------------------------------------------------------------------------------

/** The rows of the trail the undo reads (§NNN): a press's `event_result.created`, and a press of the same number after it. */
export const LINE_TRAIL_ACTIONS = ["event_result.created", "event_result.finish_duplicate"] as const;

/** One of those audit rows, as the reader hands it over. */
export type LineTrailRow = { action: string; actorStaffUserId: string | null; metadata: unknown };

/** What the trail says of one stored row: whether a press at the line wrote it, and whether its number was pressed again since — by another account, or by its writer. */
export type UndoTrail = { pressedAtLine: boolean; pressedAgain: "other" | "self" | null };

const metadataOf = (row: LineTrailRow): Record<string, unknown> => (row.metadata && typeof row.metadata === "object" && !Array.isArray(row.metadata) ? (row.metadata as Record<string, unknown>) : {});

/**
 * The trail of one stored row, by its id: the line's `event_result.created` names the row it wrote (`resultId`, with `finishLine`) —
 * a «Clasament» save or an import writes no such row —, and a press of a number already stored names the row it found
 * (`event_result.finish_duplicate`, `storedResultId`).
 */
export function undoTrailOf(row: { id: string; updatedByStaffUserId: string | null }, trail: readonly LineTrailRow[]): UndoTrail {
  const pressedAtLine = trail.some((entry) => entry.action === "event_result.created" && metadataOf(entry).finishLine === true && metadataOf(entry).resultId === row.id);
  const again = trail.filter((entry) => entry.action === "event_result.finish_duplicate" && metadataOf(entry).storedResultId === row.id);
  return { pressedAtLine, pressedAgain: again.length === 0 ? null : again.some((entry) => entry.actorStaffUserId !== row.updatedByStaffUserId) ? "other" : "self" };
}

/** A stored row, as much as the undo reads of it. */
export type UndoableRow = { id: string; status: string; createdAt: Date; updatedAt: Date; updatedByStaffUserId: string | null };

/** The viewer's own press at the line as it was written: «Sosit», written once (`created_at` = `updated_at`) by the viewer, by a press at the line. */
function ownPressAsWritten(row: UndoableRow, actorId: string, trail: UndoTrail): boolean {
  return row.status === "FINISHED" && row.updatedByStaffUserId === actorId && row.createdAt.getTime() === row.updatedAt.getTime() && trail.pressedAtLine;
}

/**
 * Until when the viewer may undo a row on the page (epoch ms), or null when it is not theirs to undo: their own press at the line as
 * it was written, its number not pressed again since, for ten minutes after it was written. A row typed or imported on «Clasament»,
 * corrected there, a runner written off and turned «Sosit» at the line, and a number another press found since are «Clasament»'s.
 */
export function undoOpenUntil(row: UndoableRow, actorId: string, trail: UndoTrail): number | null {
  if (!ownPressAsWritten(row, actorId, trail) || trail.pressedAgain !== null) return null;
  return row.createdAt.getTime() + FINISH_UNDO_WINDOW_MS;
}

/** Whether the viewer may undo the row at `nowMs`. */
export function mayUndo(row: UndoableRow, actorId: string, trail: UndoTrail, nowMs: number): boolean {
  const until = undoOpenUntil(row, actorId, trail);
  return until !== null && nowMs <= until;
}

/** Why the viewer's own press of the last ten minutes has no «Anulează»: its number pressed again since — by another account, or by the viewer — else null. */
export function undoClosedBy(row: UndoableRow, actorId: string, trail: UndoTrail, nowMs: number): "other" | "self" | null {
  if (!ownPressAsWritten(row, actorId, trail) || nowMs > row.createdAt.getTime() + FINISH_UNDO_WINDOW_MS) return null;
  return trail.pressedAgain;
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
  /** The viewer's own press of the last ten minutes whose number was pressed again since — by another account or by the viewer: no «Anulează», «Clasament» corrects it. */
  pressedAgain: "other" | "self" | null;
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
      /** The number's row stays as stored: «Sosit» already, or a decision of «Clasament» (`storedStatus`). */
      kind: "duplicate";
      bibNumber: number;
      name: string | null;
      label: string | null;
      /** This press's own time, written to the trail. */
      gunTimeMs: number;
      /** The row's state, which stays: `FINISHED` for a number entered first, else the decision («Abandon», «Neprezentat», «Descalificat»). */
      storedStatus: string;
      /** The time stored, which stays; null for a decision with none. */
      storedGunTimeMs: number | null;
      /** Who stored it — their display name — or null when that account is gone. */
      storedBy: string | null;
    }
  | { kind: "refused"; code: string; bibNumber: number | null; gunTimeMs: number | null };

/**
 * A press's answer, with the server's clock; or that the staff session ended — or is another account's than the press's — (the entry
 * waits; sign in again); or that the server could not record it (`failed`: tried again, then settled refused).
 */
export type FinishPressAnswer =
  | { kind: "answer"; outcome: FinishEntryOutcome; state: FinishLineState | null; clock: ServerClockReading }
  | { kind: "session" }
  | { kind: "failed" };

/** An undo's answer. */
export type FinishUndoAnswer =
  | { kind: "answer"; outcome: { kind: "undone"; bibNumber: number } | { kind: "refused"; code: string }; state: FinishLineState | null; clock: ServerClockReading }
  | { kind: "session" };

/** The server's clock as the page asks it when it wakes (§NNN). */
export type FinishClockAnswer = { kind: "clock"; clock: ServerClockReading } | { kind: "session" } | { kind: "refused" };

// ---- The queue -------------------------------------------------------------------------------------------

/** One press on this phone: waiting, or answered. */
export type FinishEntry = {
  id: string;
  /** The staff account that pressed it: sent only from a page of that account, so the trail names who really entered it. */
  staffId: string;
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

/** The entry to send next: the oldest of the viewer's own waiting, in the order pressed. */
export function nextToSend(entries: readonly FinishEntry[], staffId: string): FinishEntry | undefined {
  return entries.find((entry) => entry.outcome === null && entry.staffId === staffId);
}

/** How many of the viewer's own wait to be sent. */
export function waitingCount(entries: readonly FinishEntry[], staffId: string): number {
  return entries.filter((entry) => entry.outcome === null && entry.staffId === staffId).length;
}

/** The entry answered. An entry already answered is not answered twice. */
export function settleEntry(entries: readonly FinishEntry[], id: string, outcome: FinishEntryOutcome): FinishEntry[] {
  return trimEntries(entries.map((entry) => (entry.id === id && entry.outcome === null ? { ...entry, outcome } : entry)));
}

/** How a line under the box reads an entry: waiting, another account's left unsent, saved, already there, or refused. */
export function entryStateOf(entry: FinishEntry, staffId: string): "waiting" | "otherAccount" | "saved" | "duplicate" | "refused" {
  if (entry.outcome === null) return entry.staffId === staffId ? "waiting" : "otherAccount";
  if (entry.outcome.kind === "recorded") return "saved";
  return entry.outcome.kind;
}

// ---- The phone's storage -----------------------------------------------------------------------------------

/** The storage key of one event's line on this phone. */
export function finishStorageKey(eventId: string): string {
  return `${FINISH_STORAGE_PREFIX}${eventId}`;
}

/** What one event's line keeps on the phone: the presses, and the kept times of each staff account. */
export type StoredFinishLine = { entries: FinishEntry[]; kept: Record<string, number[]> };

/** The viewer's kept times. */
export function keptOf(line: StoredFinishLine, staffId: string): number[] {
  return line.kept[staffId] ?? [];
}

/** The line with the viewer's kept times replaced — none left, none kept. */
export function withKept(line: StoredFinishLine, staffId: string, kept: readonly number[]): StoredFinishLine {
  const others = Object.fromEntries(Object.entries(line.kept).filter(([owner]) => owner !== staffId));
  return { ...line, kept: kept.length === 0 ? others : { ...others, [staffId]: [...kept] } };
}

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
  if (outcome.kind === "duplicate" && typeof outcome.bibNumber === "number" && typeof outcome.gunTimeMs === "number" && isNumberOrNull(outcome.storedGunTimeMs ?? null)) {
    return {
      kind: "duplicate",
      bibNumber: outcome.bibNumber,
      name: isText(outcome.name) ? outcome.name : null,
      label: isText(outcome.label) ? outcome.label : null,
      gunTimeMs: outcome.gunTimeMs,
      storedStatus: isText(outcome.storedStatus) ? outcome.storedStatus : "FINISHED",
      storedGunTimeMs: (outcome.storedGunTimeMs as number | null | undefined) ?? null,
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
 * and every entry or kept time that is not one — an entry with no staff account among them —, are left out: the page works
 * without them, as without the storage.
 */
export function readStoredFinishLine(raw: string | null | undefined): StoredFinishLine {
  const empty: StoredFinishLine = { entries: [], kept: {} };
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
    if (!isText(entry.staffId) || entry.staffId === "") continue;
    if (typeof entry.bibNumber !== "number" || !Number.isInteger(entry.bibNumber) || entry.bibNumber <= 0) continue;
    if (!isInstant(entry.pressedAtMs)) continue;
    const outcome = readOutcome(entry.outcome ?? null);
    if (outcome === undefined) continue;
    seen.add(entry.id);
    entries.push({ id: entry.id, staffId: entry.staffId, bibNumber: entry.bibNumber, label: isText(entry.label) ? entry.label : null, pressedAtMs: entry.pressedAtMs, outcome });
  }
  const kept: Record<string, number[]> = {};
  if (stored.kept && typeof stored.kept === "object" && !Array.isArray(stored.kept)) {
    for (const [owner, times] of Object.entries(stored.kept as Record<string, unknown>)) {
      const valid = (Array.isArray(times) ? times : []).filter(isInstant).slice(0, KEPT_TIMES_MAX);
      if (owner !== "" && valid.length > 0) kept[owner] = valid;
    }
  }
  return { entries: trimEntries(entries), kept };
}

/** One event's line, ready for the phone's storage. */
export function storedFinishLine(line: StoredFinishLine): string {
  return JSON.stringify({ entries: line.entries, kept: line.kept });
}
