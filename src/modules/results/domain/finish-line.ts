import { isUuid } from "@/shared/ids";

/**
 * «Cronometrare» (§986, amending §850; the owner, 2026-11-18, three days before the race: «trebuie să mai am un view rapid, în
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
 *   moment the runner crossed, a phone running ahead cannot stamp a runner who has not arrived — and within a day of the gun
 *   (`finishStamp`). A claim before the gun is refused as not started, never stamped with the arrival's time: a press queued
 *   before the gun and sent later would be a finisher made up at its arrival. Only a claim ahead of the server's clock, and no
 *   claim at all, take the server's own time. A press that arrives more than a day and three hours after the gun is refused
 *   whatever it claims: a queue that waited that long is «Clasament»'s to type.
 * - **A stored row of the number** (`pressMeets`). «Sosit» already: a press again — but for a press with no id of its own (the
 *   plain form), the same viewer at the same second is taken for a retry; a press with its id was already looked for in the
 *   trail (`savedPressOf`). «Descalificat», or a decision written on «Clasament» after the moment pressed: the decision stays;
 *   only an «Abandon» or a «Neprezentat» older than the press is a runner written off by mistake, turned «Sosit».
 * - **«Start».** The gun is the moment pressed when the server hears it at most ten seconds later and at most five seconds
 *   before its own clock, else the server's own (`raceGunMoment`); it may be pressed from three hours before the planned gun to
 *   six hours after (`raceGunWindowOpen`); a second «Start» of the same organizer heard within ten seconds of their last is the
 *   same press sent twice, and changes nothing (`raceGunRepeats`).
 * - **«⏱ Prinde timpul».** Each press keeps one instant, oldest first; the next number or elite pressed takes the oldest kept
 *   one instead of now (`takeOldestKept`). The kept instants are the staff account's that kept them (`keptOf`, `withKept`).
 * - **The queue.** Every entry is one staff account's press (`staffId`) with an id of its own, which the server keeps in the
 *   trail and recognises a retry by; kept, in the order pressed, until the server answered it. The oldest one of the viewer's
 *   own waiting is sent first (`nextToSend`) — another account's, left on the same phone, is shown and never sent from this one.
 *   A press the server could not record waits out a backoff (`holdAfterFailure`) while the ones after it go, and is tried again
 *   and again — never settled by a failure —, a later press of its number waiting behind it; only an answer settles it
 *   (`settleEntry`), and the settled lines past `ENTRIES_KEPT` are dropped, never a waiting one. What the phone keeps in its
 *   storage is read back tolerantly (`readStoredFinishLine`): a value that is not an entry is left out, never thrown.
 * - **«Anulează».** A row the viewer's own press at the line wrote (its `event_result.created` row of the trail says
 *   `finishLine` and names the row), that nobody changed since — its creation and its last change the same instant, by the
 *   viewer — and whose number nobody pressed again since, may be undone for ten minutes after it was written
 *   (`undoTrailOf`, `undoOpenUntil`); pressed again, the line says so (`undoClosedBy`) and the correction is «Clasament»'s. Undone,
 *   the phone's own line of the press says «anulat» (`markUndone`), never «salvat» for a runner with no result.
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
/** How long after an organizer's «Start» was heard a second one of theirs is the same press sent twice: a tap again on a slow signal. */
export const RACE_GUN_REPEAT_MS = 10_000;
/** How many of the latest finishers «Ultimii sosiți» lists. */
export const RECENT_FINISHERS = 20;
/** How many kept times «⏱ Prinde timpul» holds at most: a press past it keeps nothing more. */
export const KEPT_TIMES_MAX = 50;
/** How many answered lines the phone keeps under the box; the waiting ones are always kept. */
export const ENTRIES_KEPT = 30;
/** The first wait before a press is sent again — after no answer, or one that it could not be recorded —, doubling… */
export const FINISH_RETRY_FIRST_MS = 2_000;
/** …up to this, and then every this long, for as long as the press waits. */
export const FINISH_RETRY_MAX_MS = 30_000;
/** The phone's storage key prefix: one entry per event. */
export const FINISH_STORAGE_PREFIX = "finish-line:";
/** The phone's storage key of the server's clock: one for every event (an event's key ends in its id, never this word). */
export const CLOCK_STORAGE_KEY = `${FINISH_STORAGE_PREFIX}clock`;
/** How long a clock sample the phone kept is believed by the next page: half a day, a race day. */
export const CLOCK_SAMPLE_KEPT_MS = 12 * 3_600_000;
/**
 * How often the island asks the server's clock — and with it the gun — while no finisher is stored yet (§986): «Start» is pressed on
 * the organizer's phone, so a volunteer's page drawn before it learns of it this way, within half a minute. From the first finisher the
 * gun is fixed (`RACE_GUN_FIXED`) and nothing more is asked on a timer.
 */
export const FINISH_GUN_ASK_MS = 30_000;
/** How long a press may wait for its answer before the line says the signal is weak — it is still awaited, and nothing else changes. */
export const FINISH_PRESS_SLOW_MS = 10_000;
/**
 * How old a kept moment of «⏱ Prinde timpul» may be and still be given to the next number (§986): ten minutes. An older one is no bunch
 * any more — a moment forgotten on the phone, a page left open since the morning —, so it is dropped when the line is read or pressed,
 * and the line says its time, to be written on paper.
 */
export const KEPT_TIME_MAX_AGE_MS = 10 * 60_000;
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

/**
 * The gun as the clock's own question last heard it (§986): the instant, the server's time it was said at, whether «Start» was pressed
 * and by whom — the line says it (`lineGun`) — and whether a «Sosit» is stored, which fixes the gun and ends the half-minute question.
 */
export type HeardGun = { gunAtMs: number; serverMs: number; pressed: boolean; byName: string | null; fixed: boolean };

/**
 * The gun the line counts from (§986): the newer of what the server last said — the page's state, drawn or answered to a press (its
 * `serverNowMs`), and the clock's question (`HeardGun`, its answer's time). «Start» pressed on another phone reaches a page drawn
 * before it by the clock; a press answered after that clock brings the gun as it then stood.
 */
export function lineGunAt(state: { serverNowMs: number; gunAtMs: number }, heard: Pick<HeardGun, "gunAtMs" | "serverMs"> | null): number {
  return heard && heard.serverMs > state.serverNowMs ? heard.gunAtMs : state.gunAtMs;
}

/** The gun as the line says it: the instant counted from, whether «Start» was pressed and by whom, and whether a finisher fixed it. */
export type LineGun = { atMs: number; pressed: boolean; byName: string | null; fixed: boolean };

/**
 * The whole gun of the line (§986), from the newer answer as `lineGunAt` picks it — so the sentence above the clock is the gun the
 * clock counts from, never the one the page was drawn with («Startul planificat … Până la «Start»…» after «Start» was pressed on
 * another phone): the state's own («Start» as pressed and its presser, fixed once it counts a finisher), or the clock's question's.
 */
export function lineGun(state: Pick<FinishLineState, "serverNowMs" | "gunAtMs" | "gunPressed" | "gunByName" | "finished">, heard: HeardGun | null): LineGun {
  if (heard && heard.serverMs > state.serverNowMs) return { atMs: heard.gunAtMs, pressed: heard.pressed, byName: heard.byName, fixed: heard.fixed };
  return { atMs: state.gunAtMs, pressed: state.gunPressed, byName: state.gunByName, fixed: state.finished > 0 };
}

/** The clock's reading at `nowMs`: whole seconds since the gun, or null before it. */
export function clockReading(nowMs: number, gunAtMs: number): number | null {
  const elapsed = nowMs - gunAtMs;
  return elapsed < 0 ? null : Math.floor(elapsed / SECOND) * SECOND;
}

/** What the server makes of a press: the time it stamps (claimed or its own), or why it stamps none. */
export type FinishStamp = { kind: "stamped"; gunTimeMs: number; claimed: boolean } | { kind: "notStarted" } | { kind: "closed"; gunTimeMs: number };

/**
 * The time a press is stamped with (§986). A press arriving more than `FINISH_WINDOW_MS` and `FINISH_ARRIVAL_GRACE_MS` after the gun
 * is `closed` whatever it claims. Else the claimed instant's time since the gun, floored to the second, decides: under a second — a
 * press before the gun — is `notStarted`, never the arrival's time instead (a press queued before the gun and sent later would be a
 * finisher made up at its arrival, and would fix the gun); within the server's own time plus `FINISH_CLAIM_AHEAD_MS` it is the stamp,
 * `closed` past `FINISH_WINDOW_MS`. Only a claim ahead of that, or no claim, is the server's own time — refused before the gun
 * (`notStarted`) and past the window (`closed`).
 */
export function finishStamp(input: { claimedAtMs: number | null | undefined; gunAtMs: number; nowMs: number }): FinishStamp {
  const own = input.nowMs - input.gunAtMs;
  if (own > FINISH_WINDOW_MS + FINISH_ARRIVAL_GRACE_MS) return { kind: "closed", gunTimeMs: Math.floor(own / SECOND) * SECOND };
  if (isInstant(input.claimedAtMs)) {
    const claim = Math.floor((input.claimedAtMs - input.gunAtMs) / SECOND) * SECOND;
    if (claim < SECOND) return { kind: "notStarted" };
    if (claim <= own + FINISH_CLAIM_AHEAD_MS) return claim <= FINISH_WINDOW_MS ? { kind: "stamped", gunTimeMs: claim, claimed: true } : { kind: "closed", gunTimeMs: claim };
    // A claim ahead of the server's clock — a phone running fast, a runner who has not arrived: the server's own time.
  }
  if (own <= 0) return { kind: "notStarted" };
  if (own > FINISH_WINDOW_MS) return { kind: "closed", gunTimeMs: Math.floor(own / SECOND) * SECOND };
  return { kind: "stamped", gunTimeMs: stampedGunTime(input.nowMs, input.gunAtMs), claimed: false };
}

/** A stored row of a number, as much as a press reads of it. */
export type MetRow = { status: string; gunTimeMs: number | null; updatedAt: Date; updatedByStaffUserId: string | null };

/**
 * What a press does to the stored row of its number (§986; the owner: «se poate întâmpla și ca mai mulți voluntari să treacă
 * același număr»): `retry` — «Sosit» by the same viewer at the same second, taken for a press already saved, but only for a press
 * with no id of its own (`identified` false: the plain form, an older page) —; `pressedAgain` — «Sosit» by anybody else, by the
 * viewer another second, or by the viewer at all when the press carries its id: the trail, read first, said it is not this press's
 * retry (`savedPressOf`), so the first stays —; `decided` — «Descalificat», which the line never undoes, or an «Abandon» /
 * «Neprezentat» written after the moment pressed (`atMs`), a later decision a queued press must not overwrite —; and `turned` — an
 * «Abandon» or a «Neprezentat» written before the press: a runner written off by mistake, who crossed the line.
 */
export function pressMeets(row: MetRow, press: { actorId: string; gunTimeMs: number; atMs: number; identified: boolean }): "retry" | "pressedAgain" | "decided" | "turned" {
  if (row.status === "FINISHED") return !press.identified && row.updatedByStaffUserId === press.actorId && row.gunTimeMs === press.gunTimeMs ? "retry" : "pressedAgain";
  if (row.status === "DSQ" || press.atMs < row.updatedAt.getTime()) return "decided";
  return "turned";
}

/** The rows of the trail a press of the line writes, where its id is kept (`pressId`): a retry is looked for among them. */
export const PRESS_TRAIL_ACTIONS = ["event_result.created", "event_result.updated", "event_result.finish_duplicate"] as const;

/** A press the trail already holds, as it was answered: recorded, or a number found stored — the stored row's id, the times and the state. */
export type SavedPress =
  | { kind: "recorded"; resultId: string; gunTimeMs: number }
  | { kind: "duplicate"; storedResultId: string; gunTimeMs: number; storedGunTimeMs: number | null; storedStatus: string };

/**
 * A press found in the trail by its id (§986), read back as it was answered — so its retry, the answer lost on the way, is answered
 * the same and writes nothing: a «Sosit» it wrote (`event_result.created` / `.updated` with `finishLine`, its `resultId`), or a number
 * it found stored (`event_result.finish_duplicate`). Null for a row of another number — an id is one press's, of one number — or one
 * that cannot be read: the press is then taken as new.
 */
export function savedPressOf(row: { action: string; metadata: unknown }, bibNumber: number): SavedPress | null {
  const metadata = row.metadata && typeof row.metadata === "object" && !Array.isArray(row.metadata) ? (row.metadata as Record<string, unknown>) : {};
  if (metadata.finishLine !== true || metadata.bibNumber !== bibNumber || typeof metadata.gunTimeMs !== "number") return null;
  if (row.action === "event_result.created" || row.action === "event_result.updated") {
    return typeof metadata.resultId === "string" ? { kind: "recorded", resultId: metadata.resultId, gunTimeMs: metadata.gunTimeMs } : null;
  }
  if (row.action === "event_result.finish_duplicate" && typeof metadata.storedResultId === "string") {
    return {
      kind: "duplicate",
      storedResultId: metadata.storedResultId,
      gunTimeMs: metadata.gunTimeMs,
      storedGunTimeMs: typeof metadata.storedGunTimeMs === "number" ? metadata.storedGunTimeMs : null,
      storedStatus: typeof metadata.storedStatus === "string" ? metadata.storedStatus : "FINISHED",
    };
  }
  return null;
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

/** The gun's latest audit row, as much as a «Start» reads of it: `event.race_gun_set` or `event.race_gun_cleared`, who and when it was heard. */
export type RaceGunTrailRow = { action: string; actorStaffUserId: string | null; at: Date };

/**
 * Whether a «Start» heard at `nowMs` is the actor's own last one sent twice (§986): the gun's latest row is a «Start» of theirs — so the
 * gun stands as they set it — heard at most `RACE_GUN_REPEAT_MS` before. A tap again while the first was still on its way on a slow
 * signal: answered with the gun as it stands, nothing written. Another organizer's press, one after «Anulează startul», and one of
 * theirs later than that are a press of their own, which moves the gun.
 */
export function raceGunRepeats(last: RaceGunTrailRow | null | undefined, actorId: string, nowMs: number): boolean {
  return last?.action === "event.race_gun_set" && last.actorStaffUserId === actorId && nowMs - last.at.getTime() <= RACE_GUN_REPEAT_MS;
}

// ---- «Anulează» ------------------------------------------------------------------------------------------

/** The rows of the trail the undo reads (§986): a press's `event_result.created`, and a press of the same number after it. */
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

/**
 * The kept times still young enough to give a number (§986), and those older than `KEPT_TIME_MAX_AGE_MS` at `nowMs` — dropped, their
 * moments said on the line for paper. A moment ahead of `nowMs` (a clock measured again) is young.
 */
export function staleKept(kept: readonly number[], nowMs: number): { fresh: number[]; stale: number[] } {
  const fresh: number[] = [];
  const stale: number[] = [];
  for (const atMs of kept) (nowMs - atMs > KEPT_TIME_MAX_AGE_MS ? stale : fresh).push(atMs);
  return { fresh, stale };
}

/** A kept moment's age at `nowMs`, for its chip: whole seconds under a minute, else whole minutes; never below nought. */
export function keptAge(atMs: number, nowMs: number): { unit: "seconds" | "minutes"; value: number } {
  const elapsed = Math.max(0, nowMs - atMs);
  return elapsed < 60 * SECOND ? { unit: "seconds", value: Math.floor(elapsed / SECOND) } : { unit: "minutes", value: Math.floor(elapsed / (60 * SECOND)) };
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
  /**
   * The number a press records; null for a line or a registration with none — drawn disabled with what to do, or, for a line and
   * a viewer who writes the elite list, as «Dă-i un număr» (§NNN).
   */
  bibNumber: number | null;
  /** The line of the elite list a `line` button stands for, by its id — what «Dă-i un număr» posts (§NNN); null for a registration. */
  entryId: string | null;
  /** Already «Sosit»: the time, and the button cannot be pressed. */
  finishedGunTimeMs: number | null;
};

/** The page's state as every answer carries it, so the island stays the server's. */
export type FinishLineState = {
  serverNowMs: number;
  /** The gun the line counts from: «Start» as pressed, else the plan (`results.ts#gunOf`). */
  gunAtMs: number;
  /** Whether «Start» was pressed, and who pressed it — their display name, or null when that account is gone: the line says it (§986). */
  gunPressed: boolean;
  gunByName: string | null;
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
      /** The server had it already — the same press sent again, its answer lost on the way —: shown as saved. */
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
 * waits; sign in again); or that the server could not record it (`failed`: the entry waits and is tried again, the next ones sent).
 */
export type FinishPressAnswer =
  | { kind: "answer"; outcome: FinishEntryOutcome; state: FinishLineState | null; clock: ServerClockReading }
  | { kind: "session" }
  | { kind: "failed" };

/** An undo's answer. */
export type FinishUndoAnswer =
  | { kind: "answer"; outcome: { kind: "undone"; bibNumber: number } | { kind: "refused"; code: string }; state: FinishLineState | null; clock: ServerClockReading }
  | { kind: "session" };

/**
 * The server's clock as the page asks it when it wakes, is shown again or, before the first finisher, every half minute (§986) — with
 * the gun the line counts from (`gunAtMs`, «Start» as pressed, else the plan; null when the event could not be read), so a page drawn
 * before «Start» counts from it; whether «Start» was pressed and by whom, so the line says the gun it counts from; and whether a
 * «Sosit» is stored (`gunFixed`) — on any phone — so the island stops asking on a timer from the first finisher, its own or not.
 */
export type FinishClockAnswer =
  | { kind: "clock"; clock: ServerClockReading; gunAtMs: number | null; gunPressed: boolean; gunByName: string | null; gunFixed: boolean }
  | { kind: "session" }
  | { kind: "refused" };

// ---- The queue -------------------------------------------------------------------------------------------

/** One press on this phone: waiting, or answered. */
export type FinishEntry = {
  /** The press's own id, sent with it and kept in the trail (`pressId`): a retry of it is recognised by it, exactly. */
  id: string;
  /** The staff account that pressed it: sent only from a page of that account, so the trail names who really entered it. */
  staffId: string;
  bibNumber: number;
  /** An elite's label when the press was its button; null for a number typed. */
  label: string | null;
  /** The press, on the server's clock. */
  pressedAtMs: number;
  outcome: FinishEntryOutcome | null;
  /** A recorded press this phone's «Anulează» undid since (§986): its line says «anulat», no longer «salvat». The phone's own fact, never an answer's. */
  undone?: true;
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

/** The entries the server answered it could not record, each held until it is tried again: how many times it failed, and until when. */
export type HeldEntries = ReadonlyMap<string, { tries: number; untilMs: number }>;

/** The wait before a press is tried again after its `tries`-th failure: two seconds, doubling, every thirty at most — never a last one. */
export function finishRetryDelay(tries: number): number {
  return Math.min(FINISH_RETRY_MAX_MS, FINISH_RETRY_FIRST_MS * 2 ** Math.min(16, Math.max(0, tries - 1)));
}

/** An entry the server could not record once more: held for the next wait, its failures counted — still waiting, never settled. */
export function holdAfterFailure(held: HeldEntries, id: string, nowMs: number): { tries: number; untilMs: number } {
  const tries = (held.get(id)?.tries ?? 0) + 1;
  return { tries, untilMs: nowMs + finishRetryDelay(tries) };
}

/**
 * The entry to send next: the oldest of the viewer's own waiting whose turn has come, in the order pressed. One the server could not
 * record waits out its hold (`held`) while the ones after it go — but a later press of the same number waits behind it, so the phone's
 * first press of a number is still the first one the server hears.
 */
export function nextToSend(entries: readonly FinishEntry[], staffId: string, held: HeldEntries = new Map(), nowMs = 0): FinishEntry | undefined {
  const heldNumbers = new Set<number>();
  for (const entry of entries) {
    if (entry.outcome !== null || entry.staffId !== staffId) continue;
    const ready = (held.get(entry.id)?.untilMs ?? Number.NEGATIVE_INFINITY) <= nowMs;
    if (ready && !heldNumbers.has(entry.bibNumber)) return entry;
    heldNumbers.add(entry.bibNumber);
  }
  return undefined;
}

/** When the first of the viewer's own held entries may be tried again, or null when none of them is held. */
export function nextRetryAt(entries: readonly FinishEntry[], staffId: string, held: HeldEntries): number | null {
  let first: number | null = null;
  for (const entry of entries) {
    const hold = entry.outcome === null && entry.staffId === staffId ? held.get(entry.id) : undefined;
    if (hold && (first === null || hold.untilMs < first)) first = hold.untilMs;
  }
  return first;
}

/** How many of the viewer's own wait to be sent. */
export function waitingCount(entries: readonly FinishEntry[], staffId: string): number {
  return entries.filter((entry) => entry.outcome === null && entry.staffId === staffId).length;
}

/** The entry answered. An entry already answered is not answered twice. */
export function settleEntry(entries: readonly FinishEntry[], id: string, outcome: FinishEntryOutcome): FinishEntry[] {
  return trimEntries(entries.map((entry) => (entry.id === id && entry.outcome === null ? { ...entry, outcome } : entry)));
}

/**
 * The entries with the viewer's press of `bibNumber` that «Anulează» just undid marked so (§986): the latest recorded one of that number
 * by that account not marked yet — an undo takes away the row the newest such press wrote —, so the phone's own line stops saying
 * «salvat» for a runner whose result is gone. Nothing else changes; with no such entry (pressed in another tab, or with scripts off),
 * nothing at all.
 */
export function markUndone(entries: readonly FinishEntry[], staffId: string, bibNumber: number): FinishEntry[] {
  let at = -1;
  entries.forEach((entry, index) => {
    if (entry.staffId === staffId && entry.bibNumber === bibNumber && entry.outcome?.kind === "recorded" && !entry.undone) at = index;
  });
  return at < 0 ? [...entries] : entries.map((entry, index) => (index === at ? { ...entry, undone: true } : entry));
}

/** How a line under the box reads an entry: waiting, another account's left unsent, saved, undone since, already there, or refused. */
export function entryStateOf(entry: FinishEntry, staffId: string): "waiting" | "otherAccount" | "saved" | "undone" | "duplicate" | "refused" {
  if (entry.outcome === null) return entry.staffId === staffId ? "waiting" : "otherAccount";
  if (entry.outcome.kind === "recorded") return entry.undone ? "undone" : "saved";
  return entry.outcome.kind;
}

// ---- The phone's storage -----------------------------------------------------------------------------------

/** The storage key of one event's line on this phone. */
export function finishStorageKey(eventId: string): string {
  return `${FINISH_STORAGE_PREFIX}${eventId}`;
}

/** The event a storage key is the line of, or null for any other key — the clock's (`CLOCK_STORAGE_KEY`), another page's. */
export function eventIdOfStorageKey(key: string): string | null {
  if (!key.startsWith(FINISH_STORAGE_PREFIX)) return null;
  const eventId = key.slice(FINISH_STORAGE_PREFIX.length);
  return isUuid(eventId) ? eventId : null;
}

/**
 * What one event's line keeps on the phone: the presses, the kept times of each staff account, and the event's title as its page
 * named it — so another event's page can say where presses wait («N apăsări așteaptă la …»); null for a line written without one.
 */
export type StoredFinishLine = { entries: FinishEntry[]; kept: Record<string, number[]>; title: string | null };

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
  const empty: StoredFinishLine = { entries: [], kept: {}, title: null };
  if (!raw) return empty;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return empty;
  }
  if (!parsed || typeof parsed !== "object") return empty;
  const stored = parsed as { entries?: unknown; kept?: unknown; title?: unknown };
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
    // «anulat» is kept only on a recorded press: an undo takes away a row a press wrote.
    const undone = entry.undone === true && outcome?.kind === "recorded" ? { undone: true as const } : {};
    entries.push({ id: entry.id, staffId: entry.staffId, bibNumber: entry.bibNumber, label: isText(entry.label) ? entry.label : null, pressedAtMs: entry.pressedAtMs, outcome, ...undone });
  }
  const kept: Record<string, number[]> = {};
  if (stored.kept && typeof stored.kept === "object" && !Array.isArray(stored.kept)) {
    for (const [owner, times] of Object.entries(stored.kept as Record<string, unknown>)) {
      const valid = (Array.isArray(times) ? times : []).filter(isInstant).slice(0, KEPT_TIMES_MAX);
      if (owner !== "" && valid.length > 0) kept[owner] = valid;
    }
  }
  return { entries: trimEntries(entries), kept, title: isText(stored.title) && stored.title.trim() !== "" ? stored.title : null };
}

/** One event's line, ready for the phone's storage. */
export function storedFinishLine(line: StoredFinishLine): string {
  return JSON.stringify({ entries: line.entries, kept: line.kept, title: line.title });
}
