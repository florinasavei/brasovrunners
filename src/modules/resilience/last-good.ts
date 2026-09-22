import { unstable_rethrow } from "next/navigation";
import { after } from "next/server";
import { getStorage, isStorageConfigured } from "@/modules/media/storage";
import { env } from "@/shared/config/env";
import {
  type Envelope,
  isSnapshotTooOld,
  readEnvelope,
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
export type Resilient<T> = { value: T; freshness: Freshness; takenAt: Date };

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
  try {
    const value = await load();
    const envelope = { takenAt: now, value };
    remember(key, envelope);
    return { value, freshness: "live", takenAt: now };
  } catch (error) {
    /*
      `notFound()` and `redirect()` work by throwing, and so does Next's own signal that a
      dynamic API was used. Catching one of those and answering with last week's copy of the
      page would turn a 404 into a wrong 200 — so the framework's own throws are put straight
      back before anything here decides the database is the problem.
    */
    unstable_rethrow(error);

    const envelope = await recall<T>(key);
    if (!envelope || isSnapshotTooOld(envelope, now)) {
      // Nothing to show, or nothing recent enough to be honest about: the error page says the
      // site is having trouble, which is true, instead of showing last week's events as this
      // week's.
      throw error;
    }
    console.error("[resilience] serving the last good copy of", key, error);
    return { value: envelope.value, freshness: "stale", takenAt: envelope.takenAt };
  }
}

/** For the tests, which must not see one case's snapshot in the next. */
export function forgetLastGood(): void {
  memory.clear();
  lastWrittenAt.clear();
}
