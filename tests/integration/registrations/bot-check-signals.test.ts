import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { countBotCheckSignals, recordBotCheckSignal } from "@/modules/registrations/bot-check-signals";
import { botCheckSignalsFrom } from "@/modules/registrations/domain/turnstile-widget";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";

/**
 * BR-REQ-031-01 — the anti-bot check's failures, counted for `/api/health` (`DECISIONS.md` §518),
 * against real PostgreSQL: one word per signal, per hour, in the throttle's own table, summed over
 * the last 24 hours, and nothing older.
 */
const NOW = new Date("2026-09-27T12:30:00.000Z");
const HOUR = 60 * 60_000;

let db: TestDatabase;
let close: () => Promise<void>;

beforeAll(async () => {
  ({ db, close } = await createTestDatabase());
});
afterAll(async () => {
  await close();
});
beforeEach(async () => {
  await resetTables(db);
});

describe("§518 the bot-check signals", () => {
  it("reads its two words from the form, each once, and nothing else", () => {
    expect(botCheckSignalsFrom(["held-press-valve"])).toEqual(["held-press-valve"]);
    expect(botCheckSignalsFrom(["widget-failed", "held-press-valve", "widget-failed"])).toEqual(["held-press-valve", "widget-failed"]);
    expect(botCheckSignalsFrom(["ana@example.org", "", "widget-failed "])).toEqual([]);
    expect(botCheckSignalsFrom([])).toEqual([]);
  });

  it("is zero when nothing happened", async () => {
    expect(await countBotCheckSignals(db, NOW)).toEqual({ heldPressValve: 0, widgetFailed: 0 });
  });

  it("sums each signal over the last day, across hours, and leaves out what is older", async () => {
    await recordBotCheckSignal(db, "held-press-valve", NOW);
    await recordBotCheckSignal(db, "held-press-valve", NOW);
    await recordBotCheckSignal(db, "held-press-valve", new Date(NOW.getTime() - 5 * HOUR));
    await recordBotCheckSignal(db, "widget-failed", new Date(NOW.getTime() - 23 * HOUR));
    // Older than a day: out of the figure (the retention sweep deletes it soon after).
    await recordBotCheckSignal(db, "widget-failed", new Date(NOW.getTime() - 26 * HOUR));

    expect(await countBotCheckSignals(db, NOW)).toEqual({ heldPressValve: 3, widgetFailed: 1 });
  });
});
