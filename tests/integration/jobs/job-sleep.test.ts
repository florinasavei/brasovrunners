import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { events } from "@/db/schema/events";
import { jobRuns } from "@/db/schema/job-runs";
import { platformSettings } from "@/db/schema/platform-settings";
import { registrations } from "@/db/schema/registrations";
import { PLAN_GRACE_MINUTES } from "@/modules/jobs/schedule";
import { computeContentHash, type LegalDocumentTranslationInput } from "@/modules/legal-documents/domain/content-hash";
import { insertLegalDocumentVersion } from "@/modules/legal-documents/repository";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";

/**
 * BR-REQ-090-03 criteria 7, 9 and 10; BR-REQ-090-07 criterion 6 (§NNN) — a job ping with nothing
 * to do answers from Next's data cache and never opens a connection.
 *
 * The route handlers themselves, end to end, with the data cache kept in memory
 * (`helpers/next-cache.ts`) and a pool that refuses to open whenever a case says the database
 * must not be touched: the property is "no connection", and a pool that throws is the only
 * assertion of it that cannot be fooled by a query that happened to be cheap.
 */
const NOW = new Date("2026-10-01T10:00:00.000Z");
const MINUTE = 60_000;
const at = (minutes: number) => new Date(NOW.getTime() + minutes * MINUTE);
/** Where a cap or an interval of `minutes` ends: a little early, so the pinger's own next call runs. */
const ends = (minutes: number) => at(minutes - PLAN_GRACE_MINUTES);
/** Half a second before `minutes` — the pinger's call when this invocation started a touch sooner. */
const justBefore = (minutes: number) => minutes - 0.5 / 60;
const SECRET = "correct-job-secret-value";

let db: TestDatabase;
let close: () => Promise<void>;
const pool = vi.hoisted(() => ({ open: true }));

vi.mock("next/cache", async () => (await import("../../helpers/next-cache")).fakeNextCache.module);
vi.mock("@/shared/config/env", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/shared/config/env")>();
  return { env: { ...actual.env, JOB_SECRET: "correct-job-secret-value" } };
});
vi.mock("@/db/client", () => ({
  getDb: () => {
    if (!pool.open) throw new Error("a ping with nothing to do opened the database");
    return db;
  },
}));

const { fakeNextCache } = await import("../../helpers/next-cache");
const { POST: maintenance } = await import("@/app/api/internal/jobs/registration-maintenance/route");
const { POST: outbox } = await import("@/app/api/internal/jobs/email-outbox/route");
const { insideJobRun, wakeJobs } = await import("@/modules/jobs/schedule-cache");
const { confirmEmail, submitRegistration } = await import("@/modules/registrations/service");

function ping(authorization: string | null = `Bearer ${SECRET}`): Request {
  return new Request("https://example.test/api/internal/jobs/registration-maintenance", {
    method: "POST",
    headers: authorization ? { authorization } : {},
  });
}

async function realRuns(job = "registration-maintenance"): Promise<number> {
  return (await db.select().from(jobRuns).where(eq(jobRuns.jobName, job))).length;
}

/** A ping at `minutes` past NOW, with the pool closed unless `database` says otherwise. */
async function pingAt(minutes: number, options: { database?: boolean; route?: typeof maintenance } = {}) {
  vi.setSystemTime(at(minutes));
  pool.open = options.database ?? true;
  try {
    const response = await (options.route ?? maintenance)(ping());
    return { status: response.status, body: (await response.json()) as Record<string, unknown> };
  } finally {
    pool.open = true;
  }
}

beforeAll(async () => {
  ({ db, close } = await createTestDatabase());
  // `Date` alone: faking timers wholesale would stall PGlite (see `job-throttle.test.ts`).
  vi.useFakeTimers({ toFake: ["Date"] });
});
afterAll(async () => {
  vi.useRealTimers();
  await close();
});
beforeEach(async () => {
  pool.open = true;
  await resetTables(db);
  fakeNextCache.reset();
  vi.setSystemTime(NOW);
});

describe("BR-REQ-090-03 criterion 7 a ping with nothing due answers without the database", () => {
  it("checks the secret before it reads anything, the cache included", async () => {
    const response = await maintenance(ping(null));
    expect(response.status).toBe(401);
    expect(fakeNextCache.counts.reads).toBe(0);
  });

  it("runs for real when nothing is cached, and leaves its plan for the pings after it", async () => {
    const first = await pingAt(0);
    expect(first.status).toBe(200);
    expect(first.body).toMatchObject({ job: "registration-maintenance", ran: true, nextCheckAt: ends(60).toISOString() });
    expect(await realRuns()).toBe(1);
  });

  it("answers a ping before the cached instant from the cache, with the pool refusing to open", async () => {
    await pingAt(0);
    const skipped = await pingAt(15, { database: false });
    expect(skipped.status).toBe(200);
    expect(skipped.body).toMatchObject({
      job: "registration-maintenance",
      ran: false,
      reason: "nothing-due",
      nothingDueUntil: ends(60).toISOString(),
      lastRealRunAt: NOW.toISOString(),
    });
    // No `job_runs` row either: nothing ran.
    expect(await realRuns()).toBe(1);
  });

  it("looks for real once the hour-long cap is reached, whatever the cache said", async () => {
    await pingAt(0);
    expect((await pingAt(45, { database: false })).body.ran).toBe(false);
    expect((await pingAt(60)).body.ran).toBe(true);
    expect(await realRuns()).toBe(2);
  });

  it("runs the pinger's call an hour later even when it lands half a second before the hour", async () => {
    // The night pinger is hourly: had this call skipped, the next real run would have been two
    // hours after the last, not one.
    await pingAt(0);
    expect((await pingAt(justBefore(60))).body.ran).toBe(true);
    expect(await realRuns()).toBe(2);
  });

  it("does the same for the outbox", async () => {
    expect((await pingAt(0, { route: outbox })).body).toMatchObject({ job: "email-outbox", ran: true });
    expect((await pingAt(15, { route: outbox, database: false })).body).toMatchObject({ job: "email-outbox", ran: false });
    expect(await realRuns("email-outbox")).toBe(1);
  });
});

describe("BR-REQ-090-03 criterion 9 a write path that makes work sooner wakes the job", () => {
  async function approvePrivacyNotice() {
    const translations: LegalDocumentTranslationInput[] = [
      { locale: "ro", title: "Confidențialitate", body: { sections: [{ paragraphs: ["p"] }] } },
      { locale: "en", title: "Privacy", body: { sections: [{ paragraphs: ["p"] }] } },
    ];
    await insertLegalDocumentVersion(db, {
      key: "PRIVACY_NOTICE",
      version: 1,
      effectiveAt: new Date("2026-01-01T00:00:00.000Z"),
      isApproved: true,
      contentSha256: computeContentHash(translations),
      translations,
      now: NOW,
    });
  }

  it("forgets the cached quiet when a thirty-minute hold is created, and plans by the hold", async () => {
    await approvePrivacyNotice();
    const [row] = await db
      .insert(events)
      .values({ type: "RACE", startsAt: at(30 * 24 * 60), registrationMode: "INTERNAL", capacity: 5, confirmationOpensDaysBefore: 0 })
      .returning();
    const event = {
      id: row.id,
      eventStatus: row.eventStatus,
      registrationMode: "INTERNAL" as const,
      startsAt: row.startsAt,
      registrationOpensAt: null,
      registrationClosesAt: null,
      capacity: 5,
      raceId: null,
      publishedAt: at(-24 * 60),
    };

    await pingAt(0);
    expect((await pingAt(3, { database: false })).body.ran).toBe(false);

    // A submission's own deadline is two days away: nothing to forget.
    await submitRegistration(
      db,
      event,
      {
        firstName: "Ana",
        lastName: "Pop",
        birthDate: "1990-05-17",
        sex: "UNSPECIFIED",
        nationality: "RO",
        city: "Brașov",
        phone: "+40711111111",
        emergencyContactName: "Contact Urgență",
        emergencyContactPhone: "+40722222222",
        email: "hold@example.ro",
        locale: "ro",
        privacyAcknowledged: true,
        fitnessDeclared: true,
        rulesAcknowledged: true,
        resultsNameConsent: true,
        listOptOut: false,
        honeypot: "",
        renderedAt: at(4).toISOString(),
      },
      at(5),
    );
    expect(fakeNextCache.invalidated).toEqual([]);
    expect((await pingAt(6, { database: false })).body.ran).toBe(false);

    // The email confirmed: a hold that lapses in thirty minutes, sooner than the cached hour.
    const [pending] = await db.select().from(registrations).where(eq(registrations.eventId, event.id));
    const held = await confirmEmail(db, event, pending.id, at(7));
    expect(held.holdExpiresAt).toEqual(at(37));
    expect(fakeNextCache.invalidated).toContain("br-jobs:due:registration-maintenance");

    const woken = await pingAt(10);
    expect(woken.body).toMatchObject({ ran: true, nextCheckAt: at(37).toISOString() });
    expect((await pingAt(25, { database: false })).body).toMatchObject({ ran: false, nothingDueUntil: at(37).toISOString() });
    expect((await pingAt(40)).body.ran).toBe(true);
  });

  it("needs no invalidation for work further away than any quiet a run can promise", () => {
    wakeJobs("registration-maintenance", at(3 * 24 * 60), NOW);
    expect(fakeNextCache.invalidated).toEqual([]);
    wakeJobs("registration-maintenance", at(30), NOW);
    wakeJobs("email-outbox", undefined, NOW);
    expect(fakeNextCache.invalidated).toEqual(["br-jobs:due:registration-maintenance", "br-jobs:due:email-outbox"]);
  });

  it("does not let a run forget the plan it is about to write, and still wakes the other job", async () => {
    await insideJobRun("registration-maintenance", async () => {
      wakeJobs(["registration-maintenance", "email-outbox"]);
    });
    expect(fakeNextCache.invalidated).toEqual(["br-jobs:due:email-outbox"]);
  });
});

describe("BR-REQ-090-07 criterion 6 the Administrator's minimum interval", () => {
  it("holds a woken job back inside the interval, from the cache, with the pool refusing to open", async () => {
    await db.insert(platformSettings).values({ key: "jobCadence", value: { minutes: 30 }, updatedAt: NOW });
    expect((await pingAt(0)).body).toMatchObject({ ran: true, notBefore: ends(30).toISOString(), cadenceMinutes: 30 });

    // New work arrives: the cached quiet is forgotten, the interval is not.
    wakeJobs("registration-maintenance");
    const held = await pingAt(10, { database: false });
    expect(held.body).toMatchObject({ ran: false, reason: "cadence", notBefore: ends(30).toISOString(), cadenceMinutes: 30 });

    // The pinger's call thirty minutes later runs, even a touch early.
    expect((await pingAt(justBefore(30))).body.ran).toBe(true);
  });

  it("replaces the hour-long cap when it is longer", async () => {
    await db.insert(platformSettings).values({ key: "jobCadence", value: { minutes: 120 }, updatedAt: NOW });
    expect((await pingAt(0)).body).toMatchObject({ ran: true, nextCheckAt: ends(120).toISOString(), notBefore: ends(120).toISOString() });
    expect((await pingAt(75, { database: false })).body.ran).toBe(false);
    expect((await pingAt(justBefore(120))).body.ran).toBe(true);
  });
});
