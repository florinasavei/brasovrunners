"use server";

import { redirect } from "next/navigation";
import { getDb } from "@/db/client";
import { getPathname } from "@/i18n/navigation";
import type { Locale } from "@/i18n/routing";
import {
  type FinishClockAnswer,
  type FinishEntryOutcome,
  type FinishLineState,
  type FinishPressAnswer,
  type FinishUndoAnswer,
  isInstant,
  RECENT_FINISHERS,
} from "@/modules/results/domain/finish-line";
import { FinishError, type FinishGunReading, type FinishLineView, readFinishGun, readFinishLine, recordFinish, setRaceGun, undoFinish } from "@/modules/results/results";
import { canEnterResults, canRecordFinishes } from "@/modules/staff-identity/domain/roles";
import type { StaffAccount } from "@/modules/staff-identity/repository";
import { requireStaffCapability } from "@/modules/staff-identity/session";
import { DomainError, isDomainError } from "@/shared/errors/domain-error";
import { isUuid } from "@/shared/ids";
import { eventIdOf, field, localeOf } from "@/app/[locale]/admin/events/[id]/volunteer-return";

/*
  «Cronometrare»'s presses (§NNN): a finish recorded and one's own undone — each twice, once for the island, which calls it and reads
  the answer (`…PressAction`: the outcome, the page's state for the island to keep, the server's clock at the request's arrival and
  at its answer), and once for the plain form a page with scripts off posts (`…FormAction`: back to the page with the outcome in its
  address, numbers and codes only, never a name) — «Start» / «Anulează startul», a plain form the island only stamps, and the
  server's clock the island asks as it wakes (`readFinishClockAction`), with the gun. Each asks its capability here, at the door
  (`requireStaffCapability`: the finish, the undo and the clock `canRecordFinishes`, the gun `canEnterResults`), and the service
  asks again (BR-REQ-060-01). None of them emails anybody.
*/

/** The page's state for the island: what `readFinishLine` read, with the server's clock taken last. */
function stateOf(view: FinishLineView): FinishLineState {
  return {
    serverNowMs: Date.now(),
    gunAtMs: view.gun.at.getTime(),
    gunPressed: view.gun.pressed,
    gunByName: view.gun.byName,
    recent: view.recent,
    elites: view.elites,
    finished: view.finished,
    withNumber: view.withNumber,
  };
}

/**
 * The page's state after a press, or null when the viewer may not read it (another event's id, a group run's refusal still reads) —
 * or when the read failed: the press is answered all the same, and the next answer brings the state.
 */
async function stateAfter(actor: StaffAccount, eventId: string): Promise<FinishLineState | null> {
  try {
    return stateOf(await readFinishLine(getDb(), actor, eventId, new Date(), RECENT_FINISHERS));
  } catch (error) {
    if (!isDomainError(error)) console.error("[timing] the finish line could not be read after a press", error);
    return null;
  }
}

/**
 * What the island sends for one press: the event, the account that pressed it, the number, the press's moment on the server's clock
 * and the press's own id (`pressId`), by which the service knows its retry exactly.
 */
function pressOf(input: unknown): { eventId: string; staffId: string | null; bibNumber: number; claimedAtMs: number | null; pressId: string | null } {
  const raw = input && typeof input === "object" ? (input as Record<string, unknown>) : {};
  const eventId = typeof raw.eventId === "string" && isUuid(raw.eventId) ? raw.eventId : "";
  const staffId = typeof raw.staffId === "string" && isUuid(raw.staffId) ? raw.staffId : null;
  const bibNumber = typeof raw.bibNumber === "number" && Number.isInteger(raw.bibNumber) ? raw.bibNumber : Number.NaN;
  const pressId = typeof raw.pressId === "string" && isUuid(raw.pressId) ? raw.pressId : null;
  return { eventId, staffId, bibNumber, claimedAtMs: isInstant(raw.claimedAtMs) ? raw.claimedAtMs : null, pressId };
}

/** The staff session, or the island's «sign in again» (the entry waits on the phone), or a refusal for a role that may not. */
async function doorOf(capability: typeof canRecordFinishes): Promise<{ actor: StaffAccount } | { session: true } | { refused: string }> {
  try {
    return { actor: await requireStaffCapability(capability) };
  } catch (error) {
    if (isDomainError(error) && error.code === "UNAUTHENTICATED") return { session: true };
    if (isDomainError(error)) return { refused: error.code };
    throw error;
  }
}

/**
 * A press of the island: one number — typed, or an elite's button — at the moment pressed (`claimedAtMs`, which the service holds to
 * its bounds), with its own id (`pressId`). The answer is the outcome — recorded (or recorded already: the same press sent again, its
 * id in the trail), a number stored already with who stored it and its time or the decision «Clasament» wrote, or a refusal with its
 * code and the time — the page's state, so «Ultimii sosiți» and the elites' buttons follow every answer, and the server's clock at
 * the arrival and at the answer. A session that ended answers `session`, and so does one of another account than the press's
 * (`staffId`): the press is recorded only under who pressed it, so the entry stays on the phone until that volunteer signs in again.
 * A press the server could not record for a reason that is neither the network nor a rule answers `failed`: the island keeps it
 * waiting and tries it again, sending the presses after it meanwhile.
 */
export async function recordFinishPressAction(input: unknown): Promise<FinishPressAnswer> {
  const receivedAtMs = Date.now();
  const request = pressOf(input);
  const door = await doorOf(canRecordFinishes);
  if ("session" in door) return { kind: "session" };
  const answer = (outcome: FinishEntryOutcome, state: FinishLineState | null): FinishPressAnswer => ({ kind: "answer", outcome, state, clock: { receivedAtMs, answeredAtMs: Date.now() } });
  const bibOrNull = Number.isInteger(request.bibNumber) && request.bibNumber > 0 ? request.bibNumber : null;
  if ("refused" in door) return answer({ kind: "refused", code: door.refused, bibNumber: bibOrNull, gunTimeMs: null }, null);
  if (request.staffId !== null && request.staffId !== door.actor.id) return { kind: "session" };
  let outcome: FinishEntryOutcome;
  try {
    const recorded = await recordFinish(getDb(), door.actor, request, new Date());
    outcome =
      recorded.kind === "recorded"
        ? { kind: "recorded", bibNumber: recorded.bibNumber, name: recorded.name, label: recorded.label, gunTimeMs: recorded.gunTimeMs, positionOverall: recorded.positionOverall, outOfRanking: recorded.outOfRanking, again: recorded.again }
        : {
            kind: "duplicate",
            bibNumber: recorded.bibNumber,
            name: recorded.name,
            label: recorded.label,
            gunTimeMs: recorded.gunTimeMs,
            storedStatus: recorded.storedStatus,
            storedGunTimeMs: recorded.storedGunTimeMs,
            storedBy: recorded.storedBy,
          };
  } catch (error) {
    if (error instanceof FinishError) outcome = { kind: "refused", code: error.code, bibNumber: error.bibNumber, gunTimeMs: error.gunTimeMs };
    else if (isDomainError(error)) outcome = { kind: "refused", code: error.code, bibNumber: bibOrNull, gunTimeMs: null };
    else {
      console.error("[timing] a press could not be recorded; the phone tries it again", error);
      return { kind: "failed" };
    }
  }
  return answer(outcome, await stateAfter(door.actor, request.eventId));
}

/** «Anulează» of the island: one's own press of the last ten minutes, by its row's id; the answer carries the page's state and the server's clock. */
export async function undoFinishPressAction(input: unknown): Promise<FinishUndoAnswer> {
  const receivedAtMs = Date.now();
  const raw = input && typeof input === "object" ? (input as Record<string, unknown>) : {};
  const eventId = typeof raw.eventId === "string" && isUuid(raw.eventId) ? raw.eventId : "";
  const resultId = typeof raw.resultId === "string" && isUuid(raw.resultId) ? raw.resultId : "";
  const door = await doorOf(canRecordFinishes);
  if ("session" in door) return { kind: "session" };
  const clock = () => ({ receivedAtMs, answeredAtMs: Date.now() });
  if ("refused" in door) return { kind: "answer", outcome: { kind: "refused", code: door.refused }, state: null, clock: clock() };
  try {
    const undone = await undoFinish(getDb(), door.actor, { eventId, resultId }, new Date());
    const state = await stateAfter(door.actor, eventId);
    return { kind: "answer", outcome: { kind: "undone", bibNumber: undone.bibNumber }, state, clock: clock() };
  } catch (error) {
    if (!isDomainError(error)) throw error;
    const state = await stateAfter(door.actor, eventId);
    return { kind: "answer", outcome: { kind: "refused", code: error.code }, state, clock: clock() };
  }
}

/**
 * The server's clock, which the island asks as the page wakes, every time it is shown again and, while no finisher is stored, every
 * half minute — so a press is stamped on it (`domain/finish-line.ts#sampleOfRoundTrip`): when the request arrived and when it was
 * answered. **With the gun** (§NNN, `readFinishGun`: one query on the event's row, behind the same door): «Start» is pressed on the
 * organizer's phone, and a volunteer's page drawn before it counts from it — and says it, with who pressed it — at the next answer;
 * and whether a «Sosit» is stored (`gunFixed`), so the island stops asking on a timer from the first finisher anybody records.
 * Nothing written. A session that ended answers `session`, so the page says so before the first press; a gun that could not be read
 * is null — the page keeps its own.
 */
export async function readFinishClockAction(input?: unknown): Promise<FinishClockAnswer> {
  const receivedAtMs = Date.now();
  const raw = input && typeof input === "object" ? (input as Record<string, unknown>) : {};
  const eventId = typeof raw.eventId === "string" && isUuid(raw.eventId) ? raw.eventId : "";
  const door = await doorOf(canRecordFinishes);
  if ("session" in door) return { kind: "session" };
  if ("refused" in door) return { kind: "refused" };
  let gun: FinishGunReading | null = null;
  if (eventId) {
    try {
      gun = await readFinishGun(getDb(), door.actor, eventId);
    } catch (error) {
      // The clock is answered all the same: the page counts from the gun it has until the next question reads one.
      if (!isDomainError(error)) console.error("[timing] the gun could not be read for the clock", error);
    }
  }
  return {
    kind: "clock",
    clock: { receivedAtMs, answeredAtMs: Date.now() },
    gunAtMs: gun?.at.getTime() ?? null,
    gunPressed: gun?.pressed === true,
    gunByName: gun?.byName ?? null,
    gunFixed: gun?.fixed === true,
  };
}

/** Back to the page for its event, with the outcome in the address: numbers and codes only, never a name. */
function back(locale: Locale, eventId: string, outcome: Record<string, string>): never {
  const query = new URLSearchParams();
  if (eventId) query.set("eventId", eventId);
  for (const [name, value] of Object.entries(outcome)) query.set(name, value);
  redirect(`${getPathname({ locale, href: "/admin/checkin/cronometrare" })}?${query.toString()}`);
}

/**
 * The box's «Sosit» and an elite's button with scripts off: the same service with the server's own clock (no moment is claimed),
 * then back to the page saying what happened — `ok=<number>`, `dup=<number>&t=<this press's time>` (and `s=<state>` when the row
 * is a decision of «Clasament» that stays), or `refused=<code>` with the number and the time to write down when there is one.
 */
export async function recordFinishFormAction(form: FormData): Promise<void> {
  const locale = localeOf(form);
  const eventId = eventIdOf(form);
  const typed = field(form, "bib").trim();
  const bibNumber = /^\d{1,6}$/.test(typed) ? Number(typed) : Number.NaN;
  let outcome: Record<string, string>;
  try {
    const actor = await requireStaffCapability(canRecordFinishes);
    if (!Number.isInteger(bibNumber) || bibNumber <= 0) throw new DomainError("VALIDATION_ERROR", "the race number is not a whole number", ["bib"]);
    const recorded = await recordFinish(getDb(), actor, { eventId, bibNumber }, new Date());
    outcome =
      recorded.kind === "recorded"
        ? { ok: String(bibNumber) }
        : { dup: String(bibNumber), t: String(recorded.gunTimeMs), ...(recorded.storedStatus === "FINISHED" ? {} : { s: recorded.storedStatus }) };
  } catch (error) {
    if (error instanceof FinishError) outcome = { refused: error.code, bib: String(error.bibNumber), t: String(error.gunTimeMs) };
    else if (isDomainError(error)) outcome = { refused: error.code, ...(Number.isInteger(bibNumber) && bibNumber > 0 ? { bib: String(bibNumber) } : {}) };
    else throw error;
  }
  back(locale, eventId, outcome);
}

/** «Anulează» with scripts off: back to the page with `undone=<number>`, or the refusal's code. */
export async function undoFinishFormAction(form: FormData): Promise<void> {
  const locale = localeOf(form);
  const eventId = eventIdOf(form);
  let outcome: Record<string, string>;
  try {
    const actor = await requireStaffCapability(canRecordFinishes);
    const undone = await undoFinish(getDb(), actor, { eventId, resultId: field(form, "resultId") }, new Date());
    outcome = { undone: String(undone.bibNumber) };
  } catch (error) {
    if (!isDomainError(error)) throw error;
    outcome = { refused: error.code };
  }
  back(locale, eventId, outcome);
}

/**
 * The gun a «Start» form says its page saw (`seenGunAtMs`, §NNN): empty for none — the page said «Start» —, else the instant its
 * «Mută startul acum» was drawn under; anything else is taken for none, so a forged value moves no gun that stands. A form without
 * the field (none is drawn so) is not asked.
 */
function seenGunOf(form: FormData): number | null | undefined {
  if (!form.has("seenGunAtMs")) return undefined;
  const seen = Number(field(form, "seenGunAtMs"));
  return field(form, "seenGunAtMs") !== "" && isInstant(seen) ? seen : null;
}

/**
 * «Start», «Mută startul acum» and «Anulează startul» (`intent=start|clear`): whoever enters results, at the door and in the service.
 * The moment is the tap the island wrote into the form (`claimedAtMs`), which the service keeps when it hears it at most ten seconds
 * later (`raceGunMoment`); the gun the page saw (`seenGunAtMs`) is asked against the one stored, so a page drawn before another
 * organizer's «Start» moves nothing. Back to the page with `gun=set|cleared|unchanged`, `gun=repeat` for the organizer's own «Start»
 * heard again within ten seconds (the gun as it stands, nothing written), or the refusal's code (`RACE_GUN_CHANGED` — the page, drawn
 * again, says who gave the start and when —, `RACE_GUN_FIXED`, `RACE_GUN_WINDOW`, …).
 */
export async function setRaceGunAction(form: FormData): Promise<void> {
  const locale = localeOf(form);
  const eventId = eventIdOf(form);
  const clear = field(form, "intent") === "clear";
  const claimed = Number(field(form, "claimedAtMs"));
  let outcome: Record<string, string>;
  try {
    const actor = await requireStaffCapability(canEnterResults);
    const result = await setRaceGun(getDb(), actor, { eventId, clear, claimedAtMs: isInstant(claimed) ? claimed : null, seenGunAtMs: seenGunOf(form) }, new Date());
    outcome = { gun: result.repeated ? "repeat" : !result.changed ? "unchanged" : clear ? "cleared" : "set" };
  } catch (error) {
    if (!isDomainError(error)) throw error;
    outcome = { refused: error.code };
  }
  back(locale, eventId, outcome);
}
