import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * BR-REQ-090-03 criterion 4, `DECISIONS.md` §98 and §281 — the health endpoint *reports* that the
 * database is unusable. It never fails to report it.
 *
 * §98 made every answer but `ok` a 503 precisely so that an external monitor notifying on a
 * non-2xx is the club's alarm — the platform cannot send that message through email, because
 * email is one of the things that may be down. That alarm is only as good as the endpoint's
 * promise to answer at all, and the promise was not kept: the two `checkJobHealth` calls ran
 * whatever the `select 1` probe had said, so a database that was actually away threw inside the
 * route and Next answered its own generic server error. A monitor reading the body saw nothing it
 * recognised, and `yarn smoke` reported "did not return JSON" rather than "the database is down".
 *
 * These assert the shape of the answer under failure, and that nothing is asked of a connection
 * already known to be gone — the second matters because each of those calls is a query that
 * would take its own ten seconds to time out, turning one dead endpoint into a slow one.
 */
const checkSchemaVersion = vi.fn();
const checkJobHealth = vi.fn();
const checkEmailHealth = vi.fn();
const execute = vi.fn();

vi.mock("@/db/client", () => ({ getDb: () => ({ execute }) }));
vi.mock("@/db/schema-version", () => ({ checkSchemaVersion: (...args: unknown[]) => checkSchemaVersion(...args) }));
vi.mock("@/modules/jobs/health", () => ({ checkJobHealth: (...args: unknown[]) => checkJobHealth(...args) }));
vi.mock("@/modules/notifications/health", () => ({ checkEmailHealth: (...args: unknown[]) => checkEmailHealth(...args) }));
vi.mock("@/shared/config/build-info", () => ({
  buildInfo: { baseline: "BR-V1.43-2026-09-21", commit: "7c6ca38", committedAt: "2026-09-22T10:00:00.000Z" },
}));

const { GET } = await import("@/app/api/health/route");

/** What the driver actually throws: the statement, and the host it could not reach. */
const PROVIDER_ERROR = new Error(
  'connect ECONNREFUSED 10.0.0.1:5432 while running "select 1" as user "neondb_owner" on ep-secret-123.eu-central-1.aws.neon.tech',
);

function healthy(): void {
  execute.mockResolvedValue(undefined);
  checkSchemaVersion.mockResolvedValue({ status: "ok", expected: "0057", applied: "0057" });
  checkJobHealth.mockImplementation(async (_db: unknown, jobName: string) => ({
    jobName,
    status: "ok",
    lastFinishedAt: "2026-09-22T09:50:00.000Z",
  }));
  checkEmailHealth.mockResolvedValue({ status: "ok" });
}

beforeEach(() => {
  vi.clearAllMocks();
  healthy();
});

describe("DECISIONS.md §98 /api/health answers even when the database does not", () => {
  it("returns a structured 503 when the connection probe fails", async () => {
    execute.mockRejectedValue(PROVIDER_ERROR);

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(body.status).toBe("down");
    expect(body.database).toBe("down");
    expect(body.schema).toBeNull();
    expect(body.jobs).toBeNull();
    expect(body.email).toBeNull();
    // The build and the time are what tell the owner *which* deployment is reporting this.
    expect(body.build.commit).toBe("7c6ca38");
    expect(typeof body.checkedAt).toBe("string");
  });

  it("asks the database nothing else once the probe has failed", async () => {
    execute.mockRejectedValue(PROVIDER_ERROR);

    await GET();

    // Not merely tidiness: each of these is a query that would spend its own statement timeout
    // failing, so a dead database would answer slowly as well as uselessly.
    expect(checkSchemaVersion).not.toHaveBeenCalled();
    expect(checkJobHealth).not.toHaveBeenCalled();
    expect(checkEmailHealth).not.toHaveBeenCalled();
  });

  it("contains a failure in a check that runs after the probe succeeded", async () => {
    // The probe answers — a connection from the pool that is still good — and the query behind it
    // does not. Before §281 this threw out of the route.
    checkJobHealth.mockRejectedValue(PROVIDER_ERROR);

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(body.status).toBe("down");
    expect(body.database).toBe("down");
    expect(body.jobs).toBeNull();
  });

  it("puts no provider message, statement or host in what it returns", async () => {
    execute.mockRejectedValue(PROVIDER_ERROR);
    vi.spyOn(console, "error").mockImplementation(() => {});

    const body = await (await GET()).text();

    for (const secret of ["ECONNREFUSED", "neondb_owner", "neon.tech", "select 1", "5432"]) {
      expect(body).not.toContain(secret);
    }
  });
});

describe("DECISIONS.md §98 what a working deployment reports is unchanged", () => {
  it("answers 200 and ok when everything answers", async () => {
    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.status).toBe("ok");
    expect(body.database).toBe("ok");
    expect(body.jobs).toHaveLength(2);
    expect(body.jobs.map((job: { jobName: string }) => job.jobName)).toEqual([
      "registration-maintenance",
      "email-outbox",
    ]);
  });

  it("still answers degraded and 503 for a stale job", async () => {
    checkJobHealth.mockImplementation(async (_db: unknown, jobName: string) => ({
      jobName,
      status: jobName === "email-outbox" ? "stale" : "ok",
      lastFinishedAt: null,
    }));

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(body.status).toBe("degraded");
    expect(body.database).toBe("ok");
  });

  it("still answers degraded for stalled email, and down for a schema behind the build", async () => {
    checkEmailHealth.mockResolvedValue({ status: "stalled", deferred: 3 });
    expect((await (await GET()).json()).status).toBe("degraded");

    checkEmailHealth.mockResolvedValue({ status: "ok" });
    checkSchemaVersion.mockResolvedValue({ status: "behind", expected: "0057", applied: "0054" });
    const behind = await GET();
    expect(behind.status).toBe(503);
    expect((await behind.json()).status).toBe("down");
  });
});
