import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { type DepartureContext, type DepartureRow, departureOf } from "@/modules/notifications/domain/departure";
import { receiptValues, summarizeReceipt } from "@/modules/notifications/domain/press-receipt";
import { LEAVES_NOW_WITHIN_MS, pressTurnOf, SENT_AT_TURN_FLAG } from "@/modules/notifications/domain/send-at-once";
import { EMAIL_HEALTH_THRESHOLDS } from "@/modules/notifications/health";
import { TURN_WAIT_MAX_MS } from "@/modules/notifications/send-rows-now";
import { INVITATION_GAP_MS, INVITATION_HOLD_MS, lastTurnOf, STAFF_PRESS_MAX_DURATION_S } from "@/modules/staff-identity/service";

/**
 * §NNN (amending §1000, whose ask was «cumva trebuie un delay intre mailurile de logare»; 2026-11-20: the two still arrived together) —
 * the club's invitation leaves a minute and a half after Zitadel's, sent by the press itself after its response.
 *
 * The pure parts: which rows a press waits for and how long (`lastTurnOf` — a members' press waits once, for the last of
 * its turns), what the queue panel, «Emailuri azi» and the toast say for such a row (`pressTurnOf`, `departureOf`: its turn
 * while it is ahead, whatever «Când pleacă emailurile» says), and the bounds — the wait's, the hold's and the staff page's
 * function ceiling, which a Server Action posted from it runs under.
 */
describe("§NNN lastTurnOf — what a press's drain waits for", () => {
  const at = (seconds: number) => new Date(Date.UTC(2026, 10, 20, 9, 0, seconds));

  it("waits for nothing when no release was given a turn: none, a refusal's or `ready`'s (due at once), a release that found no row", () => {
    expect(lastTurnOf([])).toBeNull();
    expect(lastTurnOf([{ ids: ["a"], dueAt: null }])).toBeNull();
    expect(lastTurnOf([{ ids: [], dueAt: null }])).toBeNull();
    expect(lastTurnOf([{ ids: [], dueAt: at(30) }])).toBeNull();
  });

  it("waits once for a members' press: every row given a turn, until the last of the turns", () => {
    const turn = lastTurnOf([
      { ids: ["m1"], dueAt: at(10) },
      { ids: ["m2"], dueAt: null },
      { ids: ["m3"], dueAt: at(25) },
      { ids: ["m4"], dueAt: at(17) },
    ]);
    expect(turn).toEqual({ ids: ["m1", "m3", "m4"], dueAt: at(25) });
  });
});

describe("§NNN the bounds", () => {
  it("is a minute and a half, waited for inside the press's function, and the hold outlasts any turn a release could set", () => {
    expect(INVITATION_GAP_MS).toBe(90_000);
    expect(TURN_WAIT_MAX_MS).toBeGreaterThanOrEqual(INVITATION_GAP_MS);
    expect(TURN_WAIT_MAX_MS).toBeLessThan(STAFF_PRESS_MAX_DURATION_S * 1_000);
    expect(INVITATION_HOLD_MS).toBe(STAFF_PRESS_MAX_DURATION_S * 1_000 + INVITATION_GAP_MS);
  });

  it("is the staff page's own `maxDuration`: the three presses' Server Actions run in that page's function", () => {
    const page = readFileSync(path.join(process.cwd(), "src/app/[locale]/admin/staff/page.tsx"), "utf8");
    expect(page).toContain(`export const maxDuration = ${STAFF_PRESS_MAX_DURATION_S};`);
    // Vercel's ceiling for a function on either plan the club may be on (`docs/PLATFORM.md`).
    expect(STAFF_PRESS_MAX_DURATION_S).toBeLessThanOrEqual(300);
  });
});

describe("§NNN the departure of an invitation its press sends at its turn", () => {
  // 11:04 in Brașov; the outbox job's next real run at 11:15.
  const NOW = new Date("2026-11-20T09:04:00.000Z");
  const NEXT_TICK = new Date("2026-11-20T09:15:00.000Z");
  const seconds = (count: number) => new Date(NOW.getTime() + count * 1_000);
  const CTX: DepartureContext = {
    now: NOW,
    timing: "scheduled",
    nextTickAt: NEXT_TICK,
    runIntervalMinutes: 0,
    overdueCadenceMinutes: 0,
    overdueAfterMs: EMAIL_HEALTH_THRESHOLDS.OVERDUE_AFTER_MS,
    deferredBeyondMs: EMAIL_HEALTH_THRESHOLDS.DEFERRED_BEYOND_MS,
    hourPaceHolds: false,
    mailgunReopensAt: null,
    pingerMinutesAt: () => 15,
  };
  const TURN = seconds(80);
  const ROW: DepartureRow = {
    status: "PENDING",
    messageType: "STAFF_INVITATION",
    attemptCount: 0,
    nextAttemptAt: TURN,
    createdAt: seconds(-12),
    lastError: null,
    familyHeld: false,
    sentNow: false,
    sentAtTurn: true,
    onMailgunRoad: true,
  };

  it("is the payload's own word", () => {
    expect(SENT_AT_TURN_FLAG).toBe("sentAtTurn");
  });

  it("says its turn while it is ahead — under the scheduled pass and under «imediat» alike — never the job's next run", () => {
    expect(departureOf(ROW, CTX)).toEqual({ kind: "at", at: TURN, late: false, heldUntil: null });
    expect(departureOf(ROW, { ...CTX, timing: "immediate" })).toEqual({ kind: "at", at: TURN, late: false, heldUntil: null });
    // The same row without the mark is the job's: its first real run at or after the turn.
    expect(departureOf({ ...ROW, sentAtTurn: false }, CTX)).toMatchObject({ kind: "at", at: NEXT_TICK });
  });

  it("says now once the turn came, while the press's drain is still plausibly sending; past that, the job's next pass", () => {
    const came = { ...CTX, now: new Date(TURN.getTime() + 2_000) };
    expect(departureOf(ROW, came)).toEqual({ kind: "now" });
    const over = new Date(TURN.getTime() + LEAVES_NOW_WITHIN_MS + 60_000);
    expect(pressTurnOf(ROW, over)).toBeNull();
    expect(departureOf(ROW, { ...CTX, now: over, nextTickAt: new Date(over.getTime() + 5 * 60_000) })).toMatchObject({ kind: "at" });
  });

  it("is not the press's once tried, handed back with an error, or no longer waiting", () => {
    expect(pressTurnOf({ ...ROW, attemptCount: 1 }, NOW)).toBeNull();
    expect(pressTurnOf({ ...ROW, lastError: "rate: 429" }, NOW)).toBeNull();
    expect(pressTurnOf({ ...ROW, status: "SENT" }, NOW)).toBeNull();
    expect(pressTurnOf({ ...ROW, nextAttemptAt: null }, NOW)).toBeNull();
    expect(pressTurnOf(ROW, NOW)).toEqual(TURN);
  });

  it("waits for Mailgun's reopening when nothing carries it — the press's drain honours the stop like the job's", () => {
    const stopped = { ...CTX, mailgunReopensAt: seconds(3_600) };
    expect(departureOf(ROW, stopped)).toMatchObject({ kind: "reset" });
  });

  it("is what the toast after the press says: «Pleacă la …» at the turn, Zitadel's own email beside it", () => {
    const receipt = summarizeReceipt("club.staffInvite", [{ ...ROW, clubCopy: false, test: false }], CTX);
    expect(receipt.line?.when).toEqual({ kind: "at", at: TURN });
    const values = receiptValues(receipt, NOW, { zitadel: true });
    expect(values).toMatchObject({ mail: "at", mailAt: TURN.toISOString(), mailType: "STAFF_INVITATION", mailPeople: "1", mailZitadel: "1" });
  });
});
