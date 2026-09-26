import { unstable_rethrow } from "next/navigation";
import { after } from "next/server";
import { getStorage, isStorageConfigured } from "@/modules/media/storage";
import { env } from "@/shared/config/env";
import { readNeonBudget } from "@/modules/diagnostics/neon-budget";
import { DatabaseRestingError } from "./breaker";
import { defaultRestingUntil, isDatabaseAwayError, isQuotaRefusalError } from "./domain/database-away";
import {
  type Envelope,
  isSnapshotTooOld,
  readEnvelope,
  SNAPSHOT_MAX_AGE_HOURS,
  SNAPSHOT_MAX_AGE_WHILE_RESTING_HOURS,
  writeEnvelope,
} from "./domain/envelope";

/**
 * Read the database, and keep the answer in case the database is not there next time
 * (`DECISIONS.md` §281).
 *
 * ## What a page gets
 *
 * `live` while the database answers — which is almost always, and nothing is stale then, because
 * the snapshot is consulted only when the live read throws. `stale` when the read failed and a
 * recent enough copy exists, and the page renders that copy with a banner saying so. When there
 * is no copy, the error is rethrown and `error.tsx` does what it does today: the site says it is
 * having trouble rather than inventing content.
 *
 * ## Where the copy is kept, and why in two places
 *
 * In memory first, which costs nothing and covers the ordinary case: an instance that served a
 * page a minute ago still holds it. In the object store second, because a serverless instance is
 * not a server — the first request after a quiet hour lands on a cold one with an empty memory,
 * and an outage that begins in the night would meet exactly that. R2 is the right second place
 * precisely because it is not Neon: the two do not fail together.
 *
 * The store is written **after the response** (`after()`, as the outbox drain does) and at most
 * once every `WRITE_EVERY_MS` per key, so a page that is read a thousand times an hour writes
 * its snapshot a handful of times and no reader waits for it.
 *
 * ## What must never be wrapped in this
 *
 * Anything a decision is made on: free places, whether a registration exists, a token's validity,
 * anything under `/admin`. A stale "3 locuri libere" is a person filling in a form for a place
 * that is gone (`AGENTS.md` §10.6 — the allocator is the only truth about capacity). The pages
 * keep the count live and let that one piece fail on its own (§281).
 */

type Freshness = "live" | "stale";
export type Resilient<T> = {
  value: T;
  freshness: Freshness;
  takenAt: Date;
  /**
   * When the copy is served because Neon has suspended the project for the rest of its billing
   * period (§NNN): the period's end, when the database is back. Null otherwise — live, or away for
   * any other reason, when nobody knows for how long.
   */
  restingUntil: Date | null;
};

/** Long enough that a busy page writes rarely, short enough that a copy is never much behind. */
const WRITE_EVERY_MS = 10 * 60_000;

const memory = new Map<string, Envelope<unknown>>();
const lastWrittenAt = new Map<string, number>();

function objectKeyFor(key: string): string {
  /*
    `:` separates the parts of a key — `event:ro:crosul-de-toamna` — and Windows refuses it in a
    filename, so `local` mode (a developer's laptop) logged a failed write for every page it
    served and never kept a copy. R2 would have taken it; the store must behave the same in all
    three modes, or the mechanism is only ever exercised in production.
  */
  const safe = key.replace(/[^A-Za-z0-9._-]/g, "-");
  return `${env.APP_ENV}/snapshots/${safe}.json`;
}

/** Put the answer where the next request can find it, without making this one wait. */
function remember<T>(key: string, envelope: Envelope<T>): void {
  memory.set(key, envelope);
  if (!isStorageConfigured()) return;

  const written = lastWrittenAt.get(key) ?? 0;
  if (envelope.takenAt.getTime() - written < WRITE_EVERY_MS) return;
  lastWrittenAt.set(key, envelope.takenAt.getTime());

  const body = writeEnvelope(envelope);
  if (body === null) return;

  const store = () =>
    getStorage()
      .put(objectKeyFor(key), Buffer.from(body, "utf8"), "application/json")
      .catch((error: unknown) => {
        // A snapshot that cannot be stored is not a failure of the page that was served.
        console.error("[resilience] could not store the snapshot", key, error);
      });

  try {
    after(store);
  } catch {
    // Outside a request — a job, a test — there is no `after()`; store it inline and let the
    // caller's own error handling deal with a rejection.
    void store();
  }
}

/** The last good copy: this instance's memory, then the object store. */
async function recall<T>(key: string): Promise<Envelope<T> | null> {
  const remembered = memory.get(key);
  if (remembered) return remembered as Envelope<T>;
  if (!isStorageConfigured()) return null;

  try {
    const bytes = await getStorage().get(objectKeyFor(key));
    const envelope = readEnvelope<T>(bytes?.toString("utf8") ?? null);
    if (envelope) memory.set(key, envelope);
    return envelope;
  } catch {
    return null;
  }
}

/**
 * One public read, with its last good answer behind it.
 *
 * `key` names the answer, not the query: `events:ro`, `event:ro:crosul-de-toamna`. It becomes an
 * object key, so it may hold only what a key may hold — the caller builds it from a locale and a
 * slug, both of which are already URL-safe.
 */
export async function readWithLastGood<T>(
  key: string,
  load: () => Promise<T>,
  now: Date = new Date(),
): Promise<Resilient<T>> {
  // `next build` prerendering the few static routes (the locale roots render the header): no
  // copy is kept or looked for — the build has no business writing to the store, and no outage
  // to survive (the public cache's `prerenderingAtBuild` says the same of the data cache).
  if (process.env.NEXT_PHASE === "phase-production-build") return { value: await load(), freshness: "live", takenAt: now, restingUntil: null };
  try {
    const value = await load();
    const envelope = { takenAt: now, value };
    remember(key, envelope);
    return { value, freshness: "live", takenAt: now, restingUntil: null };
  } catch (error) {
    /*
      `notFound()` and `redirect()` work by throwing, and so does Next's own signal that a
      dynamic API was used. Catching one of those and answering with last week's copy of the
      page would turn a 404 into a wrong 200 — so the framework's own throws are put straight
      back before anything here decides the database is the problem.
    */
    unstable_rethrow(error);

    const [envelope, restingUntil] = await Promise.all([recall<T>(key), restingSince(error, now)]);
    const maxAgeHours = restingUntil ? SNAPSHOT_MAX_AGE_WHILE_RESTING_HOURS : SNAPSHOT_MAX_AGE_HOURS;
    if (!envelope || isSnapshotTooOld(envelope, now, maxAgeHours)) {
      // Nothing to show, or nothing recent enough to be honest about: the error page says the
      // site is having trouble, which is true, instead of showing last week's events as this
      // week's.
      throw error;
    }
    // Once per outage and instance is enough for the log: the breaker makes every read after the
    // first one fail the same way, and a line per page view would bury the first.
    if (!(error instanceof DatabaseRestingError)) console.error("[resilience] serving the last good copy of", key, error);
    return { value: envelope.value, freshness: "stale", takenAt: envelope.takenAt, restingUntil };
  }
}

/**
 * Whether the database is away because Neon suspended the project for the month (§NNN) — asked
 * only on this failure path, only for an error that says the database is away, and of Neon's API
 * through the governor's shared reading, never of the database. The period's end when it is, so
 * the page can say when the site is whole again; null for every other outage, whose length nobody
 * knows.
 *
 * While the project is suspended nothing can change the rows behind a copy — no write reaches a
 * database that is not running — so a copy taken before the suspension is still the newest truth
 * there is, and the twelve-hour limit (`SNAPSHOT_MAX_AGE_HOURS`), which exists because a newer
 * truth may have been written since, gives way to the billing period
 * (`SNAPSHOT_MAX_AGE_WHILE_RESTING_HOURS`).
 */
async function restingSince(error: unknown, now: Date): Promise<Date | null> {
  if (!isDatabaseAwayError(error)) return null;
  const quotaRefused = isQuotaRefusalError(error);
  try {
    const budget = await readNeonBudget(now);
    /*
      Neon's own refusal ("exceeded the compute time quota") is resting on its own, whatever the
      level reads: with a project-scoped key the level comes from the operations log, which counts
      only the floor and stops growing once the project is suspended, so the platform may still
      read under 100% while Neon has already cut it off. The meter's period end when there is a
      meter, the bounded default otherwise.
    */
    if (quotaRefused) return budget.meter ? budget.meter.periodEnd : defaultRestingUntil(now);
    return budget.budget?.spent && budget.meter ? budget.meter.periodEnd : null;
  } catch {
    return quotaRefused ? defaultRestingUntil(now) : null;
  }
}

/** For the tests, which must not see one case's snapshot in the next. */
export function forgetLastGood(): void {
  memory.clear();
  lastWrittenAt.clear();
}
