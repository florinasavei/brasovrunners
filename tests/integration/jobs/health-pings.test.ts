import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { emailOutbox } from "@/db/schema/email-outbox";
import { jobRuns } from "@/db/schema/job-runs";
import { platformSettings } from "@/db/schema/platform-settings";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";

/**
 * BR-REQ-090-03 criterion 12 (§334) — the health check does not cry wolf once a ping with
 * nothing to do writes no `job_runs` row.
 *
 * `/api/health` answers 503 for anything but `ok`, and cron-job.org emails the owner on a 503
 * (§98). So the scheduler's liveness is measured against the last *ping*, skipped or real, read
 * from the cache the skip uses; and a real run is still required, within the daily window's
 * longest quiet (§577; an hour before it) plus the threshold it always had. Noon in Brașov
 * throughout, so the day cadence (fifteen minutes, threshold 35) applies.
 */
const NOON = new Date("2026-10-01T09:00:00.000Z"); // 12:00 in Brașov, summer time
const MINUTE = 60_000;
const ago = (minutes: number) => new Date(NOON.getTime() - minutes * MINUTE);

vi.mock("next/cache", async () => (await import("../../helpers/next-cache")).fakeNextCache.module);

const { fakeNextCache } = await import("../../helpers/next-cache");
const { checkJobHealth } = await import("@/modules/jobs/health");
const { recordPing } = await import("@/modules/jobs/schedule-cache");
const { checkEmailHealth } = await import("@/modules/notifications/health");

let db: TestDatabase;
let close: () => Promise<void>;

beforeAll(async () => {
  ({ db, close } = await createTestDatabase());
});
afterAll(async () => close());
beforeEach(async () => {
  await resetTables(db);
  fakeNextCache.reset();
});

async function realRun(minutesAgo: number, jobName = "registration-maintenance") {
  await db.insert(jobRuns).values({ jobName, startedAt: ago(minutesAgo), finishedAt: ago(minutesAgo) });
}

describe("BR-REQ-090-03 criterion 12 liveness is measured against the pings", () => {
  it("stays ok while pings every fifteen minutes all skip", async () => {
    await realRun(55);
    for (const minutesAgo of [40, 25, 10]) await recordPing("registration-maintenance", ago(minutesAgo), false);

    const health = await checkJobHealth(db, "registration-maintenance", NOON);
    expect(health.status).toBe("ok");
    expect(health.lastPingAt).toBe(ago(10).toISOString());
    expect(health.lastFinishedAt).toBe(ago(55).toISOString());
  });

  it("is stale, as it always was, when no ping at all came for twice the cadence plus five minutes", async () => {
    await realRun(40);
    expect((await checkJobHealth(db, "registration-maintenance", NOON)).status).toBe("stale");
  });

  it("reads one real run a day, at the window, as ok while the pings arrive (§577)", async () => {
    // 04:00 this morning, eight hours ago: an idle platform's only real run of the day.
    await realRun(8 * 60);
    await recordPing("registration-maintenance", ago(5), false);
    expect((await checkJobHealth(db, "registration-maintenance", NOON)).status).toBe("ok");
    // Twenty-five hours: inside the longest quiet the window allows, plus the threshold.
    await resetTables(db);
    await realRun(25 * 60);
    expect((await checkJobHealth(db, "registration-maintenance", NOON)).status).toBe("ok");
  });

  it("is stale when the pings arrive but no real run has happened within the window's longest quiet and the threshold", async () => {
    // Twenty-six hours and forty minutes: past the 26-hour quiet plus the 35-minute threshold.
    await realRun(26 * 60 + 40);
    await recordPing("registration-maintenance", ago(5), false);
    expect((await checkJobHealth(db, "registration-maintenance", NOON)).status).toBe("stale");
  });

  it("keeps each job's pings to itself", async () => {
    await realRun(50, "email-outbox");
    await recordPing("registration-maintenance", ago(5), false);
    expect((await checkJobHealth(db, "email-outbox", NOON)).status).toBe("stale");
  });
});

describe("BR-REQ-090-03 criterion 12 email health allows for the Administrator's interval", () => {
  it("does not call a retry stalled while the chosen interval may still reach it", async () => {
    await db.insert(emailOutbox).values({
      messageType: "VERIFY_REGISTRATION_EMAIL",
      locale: "ro",
      recipientEmail: "someone@example.ro",
      payloadJson: {},
      idempotencyKey: "retry-waiting",
      status: "PENDING",
      attemptCount: 2,
      nextAttemptAt: ago(100),
      createdAt: ago(110),
    });
    expect((await checkEmailHealth(db, NOON)).status).toBe("stalled");

    await db.insert(platformSettings).values({ key: "jobCadence", value: { minutes: 120 }, updatedAt: ago(200) });
    expect((await checkEmailHealth(db, NOON)).status).toBe("ok");
  });

  /*
    The case the "past the hour" widening missed: sixty minutes at night. A retry due just after
    an off-hour run at T waits out the interval, the hourly call at T+60 still falls inside it, and
    the claim is at T+120 — some 110 minutes overdue against the ninety that already spend their
    hour on the night pinger. The interval is added in full, so it reads ok.
  */
  it("does not call a retry 110 minutes overdue at night stalled under a sixty-minute interval", async () => {
    const night = new Date("2026-10-01T00:30:00.000Z"); // 03:30 in Brașov, summer time
    await db.insert(emailOutbox).values({
      messageType: "VERIFY_REGISTRATION_EMAIL",
      locale: "ro",
      recipientEmail: "someone@example.ro",
      payloadJson: {},
      idempotencyKey: "retry-at-night",
      status: "PENDING",
      attemptCount: 1,
      nextAttemptAt: new Date(night.getTime() - 110 * MINUTE),
      createdAt: new Date(night.getTime() - 115 * MINUTE),
    });
    expect((await checkEmailHealth(db, night)).status).toBe("stalled");

    await db.insert(platformSettings).values({ key: "jobCadence", value: { minutes: 60 }, updatedAt: ago(600) });
    expect((await checkEmailHealth(db, night)).status).toBe("ok");
  });
});
