import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { emailOutbox } from "@/db/schema/email-outbox";
import { jobRuns } from "@/db/schema/job-runs";
import { platformSettings } from "@/db/schema/platform-settings";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";

/**
 * BR-REQ-090-03 criterion 10 (§NNN) — the health check does not cry wolf once a ping with
 * nothing to do writes no `job_runs` row.
 *
 * `/api/health` answers 503 for anything but `ok`, and cron-job.org emails the owner on a 503
 * (§98). So the scheduler's liveness is measured against the last *ping*, skipped or real, read
 * from the cache the skip uses; and a real run is still required, within the hour-long cap — or
 * the Administrator's longer interval — plus the threshold it always had. Noon in Brașov
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

describe("BR-REQ-090-03 criterion 10 liveness is measured against the pings", () => {
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

  it("is stale when the pings arrive but no real run has happened within the cap and the threshold", async () => {
    await realRun(100);
    await recordPing("registration-maintenance", ago(5), false);
    // 100 minutes: past the hour-long cap plus the 35-minute threshold.
    expect((await checkJobHealth(db, "registration-maintenance", NOON)).status).toBe("stale");
  });

  it("reads a real run every two hours as ok when the Administrator chose two hours", async () => {
    await realRun(115);
    await recordPing("registration-maintenance", ago(5), false);
    expect((await checkJobHealth(db, "registration-maintenance", NOON)).status).toBe("stale");

    await db.insert(platformSettings).values({ key: "jobCadence", value: { minutes: 120 }, updatedAt: ago(200) });
    expect((await checkJobHealth(db, "registration-maintenance", NOON)).status).toBe("ok");
  });

  it("keeps each job's pings to itself", async () => {
    await realRun(50, "email-outbox");
    await recordPing("registration-maintenance", ago(5), false);
    expect((await checkJobHealth(db, "email-outbox", NOON)).status).toBe("stale");
  });
});

describe("BR-REQ-090-03 criterion 10 email health allows for the Administrator's interval", () => {
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
});
