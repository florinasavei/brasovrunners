import { randomUUID } from "node:crypto";
import { revalidateTag, unstable_cache } from "next/cache";
import { tagDates, untagDates } from "@/modules/resilience/domain/envelope";
import { buildInfo } from "@/shared/config/build-info";

/**
 * The public site's reads, answered from Next's data cache so that a visitor does not wake the
 * database (`DECISIONS.md` §333).
 *
 * ## Why this exists
 *
 * Neon Launch bills every minute the compute is awake, and the compute stays awake for five
 * minutes after the last query — so every anonymous GET, every crawler hit, cost at least five
 * minutes of compute, because every public page read PostgreSQL on every request. The owner,
 * 2026-09-23, with the bill open: "I've spent 1 dollar in Neon in 2 days, I think I need to
 * throttle or set limits".
 *
 * ## What is cached, and what is not
 *
 * **The rows, not the pages.** The public pages still render per request (`force-dynamic`), and
 * that is deliberate: they read the address (`?type=`, `?month=`, `?lista=`, `?interest=`), the
 * clock (registration opens and closes, "in three days", past and upcoming), and — on an event
 * page — whether a staff member is signed in, for the "edit" button. Caching the HTML would have
 * meant moving all of that into the browser or freezing it; caching the rows keeps every page
 * exactly as it was and takes the database out of the request.
 *
 * Only what is **public and the same for everyone** goes through here: published events, free
 * places, the public start list, standing pages, albums, the legal texts in force, two settings.
 * Nothing personal, no token, nothing under `/admin`, and no decision — the allocator, the
 * registration form and every Server Action read the database themselves, as before.
 *
 * ## How it stays right
 *
 * 1. **Every write says what it changed** — `revalidatePublicContent("events")` after an event is
 *    saved, `("places")` after a registration moves — and the cached rows of that kind expire at
 *    once (`{ expire: 0 }`: the next reader waits for fresh rows rather than being served the old
 *    ones while they refresh — a cancelled event must never read as scheduled, §28).
 * 2. **The clock is in the key**, where a query compares against `now` (`clock.ts`): the upcoming
 *    events are cached per stretch of time in which that list cannot change, so an event passing
 *    into the past is a new key rather than a stale entry.
 * 3. **A ceiling of a day** for anything a write path forgot or a hand-written SQL statement
 *    changed. It is a safety net, not the mechanism.
 *
 * ## When it is off
 *
 * Outside a Next server (a test, a script, a seed) there is no data cache: the read goes
 * straight to the database and a revalidation is nothing to do. `next dev` reads live too, so an
 * edited query is never answered from yesterday's rows while somebody is working on it, and so
 * does `next build` (`prerenderingAtBuild` says why).
 */

export type PublicContent =
  /** Published events and their translations: the listing, the page, the calendar, the feeds. */
  | "events"
  /** What registrations change on a public page: the free places and the public start list. */
  | "places"
  /** Standing pages — their text and the navigation. */
  | "pages"
  /** Albums — the gallery and the "Galerie" entry in the navigation. */
  | "gallery"
  /** The terms and the privacy notice in force. */
  | "legal"
  /** The two settings a public page reads: who receives the contact form, and the bot check. */
  | "settings";

/** The cache tag one kind of content is filed under. */
export function publicTag(content: PublicContent): string {
  return `public:${content}`;
}

/**
 * How long a cached answer may stand when nothing expires it — a day.
 *
 * Every write that changes public content expires it at once, and every clock-dependent read is
 * keyed by the clock, so this bounds only what the code does not know about: a row changed by
 * hand in Neon's console, a seed, a write path somebody adds and forgets to announce. A day
 * because each expiry is a query that may wake the compute (five billed minutes), and a shorter
 * ceiling would buy back a share of exactly the cost this module exists to remove.
 */
export const PUBLIC_CACHE_CEILING_SECONDS = 24 * 60 * 60;

/**
 * Which keyspace this server writes into.
 *
 * **One deployment, one keyspace.** Vercel's data cache is shared by every instance of a
 * deployment — which is the point — and outlives it, so a new deployment must not read rows the
 * previous one cached in a shape it may no longer select. The deployment identity
 * (`next.config.ts`) is exactly that boundary.
 *
 * **Anywhere else, one process.** `next start` keeps the cache on disk under `.next/cache`, and a
 * local database is reset and reseeded between runs (`yarn db:reset:local`, the e2e suite) behind
 * the server's back; a key that survived the restart would serve the old seed's free places.
 */
const KEYSPACE =
  process.env.VERCEL === "1" && (buildInfo.id || process.env.VERCEL_DEPLOYMENT_ID)
    ? `deployment:${buildInfo.id || process.env.VERCEL_DEPLOYMENT_ID}`
    : `process:${randomUUID()}`;

/** Whether this code is running inside a Next server — the only place a data cache exists. */
function insideNextServer(): boolean {
  return process.env.NEXT_RUNTIME === "nodejs";
}

/**
 * Whether this is `next build` prerendering the few static routes — the locale roots, which
 * redirect, render the layout and so the header.
 *
 * The build reads straight through, and has to. A cached read during a prerender does more than
 * cache: Next files the page under the read's tags and its ceiling, which turned `/ro` and `/en`
 * — two static redirects — into pages regenerated on demand, and regenerating them to answer the
 * router's prefetch left the prefetch hanging (every backoffice spec that waited for the network
 * to go quiet timed out, found in review). The build also has no business writing the data cache:
 * CI builds with no database at all, and a Vercel build would fill it under a keyspace nobody
 * serves from yet.
 */
function prerenderingAtBuild(): boolean {
  return process.env.NEXT_PHASE === "phase-production-build";
}

/**
 * One public read, answered from the data cache when it can be.
 *
 * `key` names the answer and must be unique to it across the whole application — every read
 * goes through the same wrapper, so the key is the only thing that tells two of them apart
 * (`reads.ts` owns every key, which is how they stay unique). `contents` are the kinds of
 * content the answer is made of; a write to any of them expires it.
 *
 * Dates survive the round trip: the cache stores JSON, and a `Date` would come back a string on
 * every hit but the first. The resilience envelope already solved that (§281), and its tagging
 * is used here as it is.
 *
 * A failure is not cached. The load's error reaches the caller exactly as it would have without
 * the cache, which is what `readWithLastGood` needs in order to fall back to its copy.
 */
export async function publicRead<T>(
  key: readonly (string | number)[],
  contents: readonly PublicContent[],
  load: () => Promise<T>,
): Promise<T> {
  if (!insideNextServer() || process.env.NODE_ENV !== "production" || prerenderingAtBuild()) return load();

  const cached = unstable_cache(async () => tagDates(await load()), [KEYSPACE, ...key.map(String)], {
    tags: contents.map(publicTag),
    revalidate: PUBLIC_CACHE_CEILING_SECONDS,
  });
  return untagDates(await cached()) as T;
}

/**
 * Expire every cached answer made of these kinds of content — the one call a write makes.
 *
 * Call it after the write has committed. Next applies it when the Server Action or the route
 * handler returns, so a call inside a transaction still lands after the commit; a transaction
 * that rolls back costs a refetch, never a wrong page.
 *
 * `{ expire: 0 }`, not `"max"`: "max" would serve the old rows once more while it refreshes,
 * and the old rows of a cancelled event say it is on.
 *
 * It never throws. A write that committed must not be reported as failed because a cache could
 * not be told — the day's ceiling still bounds it — so a refusal is logged and swallowed. The one
 * refusal that is not a problem is silent: outside a Next server there is nothing to expire.
 */
export function revalidatePublicContent(...contents: PublicContent[]): void {
  if (!insideNextServer()) return;
  for (const content of new Set(contents)) {
    try {
      revalidateTag(publicTag(content), { expire: 0 });
    } catch (error) {
      console.error("[public-cache] could not expire", publicTag(content), error);
    }
  }
}
