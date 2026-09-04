import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { jobRuns } from "@/db/schema/job-runs";
import { checkJobHealth } from "@/modules/jobs/health";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";

/** AGENTS.md §12.12, §16.2 — job liveness reporting. */
const NOW = new Date("2026-09-04T10:00:00.000Z");

describe("job health reporting", () => {
  let db: TestDatabase;
  let close: () => Promise<void>;

  beforeAll(async () => {
    ({ db, close } = await createTestDatabase());
  });
  afterAll(async () => close());
  beforeEach(async () => resetTables(db));

  it("reports never_run when no row exists for the job", async () => {
    const health = await checkJobHealth(db, "registration-maintenance", NOW);
    expect(health.status).toBe("never_run");
    expect(health.lastFinishedAt).toBeNull();
  });

  it("reports ok for a job that finished recently", async () => {
    await db.insert(jobRuns).values({
      jobName: "registration-maintenance",
      startedAt: new Date(NOW.getTime() - 60_000),
      finishedAt: new Date(NOW.getTime() - 55_000),
    });

    const health = await checkJobHealth(db, "registration-maintenance", NOW);
    expect(health.status).toBe("ok");
  });

  it("reports stale once the threshold has passed", async () => {
    await db.insert(jobRuns).values({
      jobName: "registration-maintenance",
      startedAt: new Date(NOW.getTime() - 20 * 60_000),
      finishedAt: new Date(NOW.getTime() - 20 * 60_000),
    });

    const health = await checkJobHealth(db, "registration-maintenance", NOW);
    expect(health.status).toBe("stale");
  });

  it("uses only the most recent run when several exist", async () => {
    await db.insert(jobRuns).values([
      {
        jobName: "email-outbox",
        startedAt: new Date(NOW.getTime() - 20 * 60_000),
        finishedAt: new Date(NOW.getTime() - 20 * 60_000),
      },
      {
        jobName: "email-outbox",
        startedAt: new Date(NOW.getTime() - 60_000),
        finishedAt: new Date(NOW.getTime() - 55_000),
      },
    ]);

    const health = await checkJobHealth(db, "email-outbox", NOW);
    expect(health.status).toBe("ok");
  });

  it("does not confuse a still-running (unfinished) run with a completed one", async () => {
    await db.insert(jobRuns).values({
      jobName: "registration-maintenance",
      startedAt: new Date(NOW.getTime() - 60_000),
      finishedAt: null,
    });

    const health = await checkJobHealth(db, "registration-maintenance", NOW);
    expect(health.status).toBe("never_run");
  });
});
