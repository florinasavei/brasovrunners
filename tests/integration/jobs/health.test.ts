import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { jobRuns } from "@/db/schema/job-runs";
import { checkJobHealth } from "@/modules/jobs/health";
import { processOutboxBatch } from "@/modules/notifications/outbox";
import { runRegistrationMaintenance } from "@/modules/registrations/maintenance";
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

  /**
   * Every scheduled job records its own run, and the check is that health goes green after it.
   *
   * The outbox did not, for three baselines: the endpoint called `processOutboxBatch` and wrote
   * no `job_runs` row, so `/api/health` reported `never_run` for a job that had been running
   * every five minutes. A permanently yellow health check is one people stop reading — which is
   * exactly what happened. Asserted per job name, from the same entry point the route calls.
   */
  it.each([
    [
      "registration-maintenance",
      (database: TestDatabase) => runRegistrationMaintenance(database, NOW),
    ],
    [
      "email-outbox",
      (database: TestDatabase) =>
        processOutboxBatch(database, {
          sender: { send: async () => ({ outcome: "sent" as const, providerMessageId: "none" }) },
          render: async () => {
            throw new Error("no message is claimed, so nothing renders");
          },
          now: NOW,
        }),
    ],
  ])("records a run for %s, so health can report it", async (jobName, run) => {
    expect((await checkJobHealth(db, jobName, NOW)).status).toBe("never_run");

    await run(db);

    const health = await checkJobHealth(db, jobName, NOW);
    expect(health.status, `${jobName} must be ok after a run`).toBe("ok");
    expect(health.lastFinishedAt).not.toBeNull();
  });

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
