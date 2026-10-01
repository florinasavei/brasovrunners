import { randomUUID } from "node:crypto";
import { revalidateTag, unstable_cache } from "next/cache";
import { after } from "next/server";
import { governorEffects } from "@/modules/diagnostics/domain/neon-budget";
import { peekNeonBudgetLevel } from "@/modules/diagnostics/budget-level";
import { ColdMissError, isColdMiss, throughBreaker } from "@/modules/resilience/breaker";
import { tagDates, untagDates } from "@/modules/resilience/domain/envelope";
import { copyOf, keepCopy, noteSavedCopyServed } from "@/modules/resilience/last-good";
import { allowRefreshNow, computeAwakeFromWrite, flushMissRefreshes, scheduleMissRefresh } from "./miss-refresh";
import { DEGRADED_PAGE_SECONDS, holdPageFor } from "./page-lifetime";
import { thisRequestsReads } from "./request-memo";
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
 * **The rows, and since §549 the pages too.** §333 cached only the rows and left every public page
 * rendering per request, because the pages read the address (`?type=`, `?month=`, `?lista=`,
 * `?interest=`), the clock and — on an event page — the session, for the "edit" button. Since
 * §549 (amending §333) the bare listing, calendar, event page and standing pages are static (ISR):
 * a read here, made while a page is prerendered, files the page under the same `public:<kind>`
 * tags, so the write that expires the rows expires the pages that showed them, in the CDN too;
 * the clock-keyed reads hold the page to their next instant (`page-lifetime.ts`); and a request
 * that asks something of the address or carries a session is the page's live twin, rendered per
 * request as before (`i18n/live-twin.ts`).
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
 *    ones while they refresh — a cancelled event must never read as scheduled, §28). The same
 *    kinds expire once more a few seconds after the write's response, so a render that was
 *    already running when the write committed cannot keep the old rows as a fresh copy (§583).
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
  /** The settings a public page reads: who receives the contact form, the bot check and the club's deadlines ("Termene", §377). */
  | "settings"
  /**
   * Whether the club's emails are late (§NNN, `cachedEmailDelay`): the outbox's queue as the pages
   * that wait for an email say it. Expired by the outbox itself, once per batch that sent, deferred
   * or gave up on a message (`processOutboxBatch`) — never per row.
   */
  | "email";

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
  /**
   * A shorter ceiling than the day's, in seconds, for an answer that changes with time and no write
   * announces it: the email queue's (§NNN), a minute. Stretched by the month's budget like the day's.
   */
  ceilingSeconds: number = PUBLIC_CACHE_CEILING_SECONDS,
): Promise<T> {
  if (!insideNextServer() || process.env.NODE_ENV !== "production" || prerenderingAtBuild()) return load();

  // A miss asks the database through the breaker (§447): while this instance knows the database
  // is away, a miss fails at once and `readWithLastGood` serves the copy, instead of every page
  // view waiting on a connection that will be refused. A hit never gets this far.
  //
  // The month's budget stretches the day's ceiling (§447, `GOVERNOR_EFFECTS.cacheCeilingFactor`):
  // twice at amber, four times at red. Read from this instance's memory without waiting — a
  // visitor never waits on Neon's API — and a write still expires what it changed at once.
  const effects = governorEffects(peekNeonBudgetLevel());
  const keyParts = [KEYSPACE, ...key.map(String)];
  const options = { tags: contents.map(publicTag), revalidate: ceilingSeconds * effects.cacheCeilingFactor };
  /*
    The copy a red month's miss is answered from (§447): every load keeps one, in memory and the
    object store (`resilience/last-good.ts`, at most once per ten minutes per key), under a key
    without the deployment's keyspace so a release does not start the month with nothing. Never
    for what registrations change — free places and the start list: a stale "3 locuri libere" is a
    form filled in for a place that is gone, and a stale list shows a name its owner withdrew
    (AGENTS.md §10.6, §281). Those miss honestly and their pages say they cannot tell just now.
    Nor for the email queue (§NNN): an old «emailurile întârzie» is as wrong as an old silence, and a
    page that cannot ask says nothing about it.
  */
  const copyKey = contents.includes("places") || contents.includes("email") ? null : `cache:${key.map(String).join(":")}`;
  const loadAndKeep = async () => {
    const value = await throughBreaker(load);
    if (copyKey) keepCopy(copyKey, value);
    return tagDates(value);
  };

  /*
    A write on this instance woke the compute a moment ago (§493, `miss-refresh.ts`): a red month's
    miss is read in the request for that moment, as below red — the compute is awake whatever this
    read does — so the organizer who saved sees the page as saved, never the copy from before the
    save. Whatever else was queued rides the same wake.
  */
  const readInRequest = effects.publicMissRefreshMinutes === 0 || computeAwakeFromWrite();
  if (effects.publicMissRefreshMinutes > 0 && readInRequest) flushMissRefreshes(effects.publicMissRefreshMinutes);

  if (readInRequest) {
    /*
      Asked once per request however many parts of the page need it (§489, `request-memo.ts`).
      The request keeps the stored form, and each caller is handed its own copy by `untagDates`,
      so no caller can change what another one reads. A failure is forgotten, so a later reader
      in the same request asks again, as it did before.
    */
    const reads = thisRequestsReads();
    const memoKey = keyParts.join("\u0000");
    let stored = reads.get(memoKey);
    if (!stored) {
      const asked = unstable_cache(fillEntry(loadAndKeep, false), keyParts, options)();
      stored = asked;
      reads.set(memoKey, asked);
      asked.catch(() => {
        if (reads.get(memoKey) === asked) reads.delete(memoKey);
      });
    }
    return untagDates(await stored) as T;
  }

  /*
    Red (§447): anonymous traffic is served from the cache only. A hit is answered as ever; a miss
    never asks the database in the request. It is answered from the read's last good copy when
    there is one, else it throws `ColdMissError` — which a page's `readWithLastGood` turns into its
    own copy or the short resting page, and an optional part of a page into nothing — and either way
    the read is queued for the background refresh at the next allowed moment (`miss-refresh.ts`).
  */
  try {
    return untagDates(
      await unstable_cache(
        fillEntry(loadAndKeep, true),
        keyParts,
        /*
          Looked up as never stale by age (§493): an entry past its ceiling is served as the hit it
          is, rather than served and "revalidated" in the background by this very function — which
          throws by design, so every such hit logged "revalidating cache with key …" with a
          ColdMissError and refreshed nothing. At red an entry lives until a write expires it, and
          the entry the background refresh files keeps the ×4 ceiling for when the month is green.
        */
        { ...options, revalidate: RED_LOOKUP_REVALIDATE_SECONDS },
      )(),
    ) as T;
  } catch (error) {
    if (!isColdMiss(error)) throw error;
    scheduleMissRefresh(keyParts.join("|"), () => unstable_cache(fillEntry(loadAndKeep, false), keyParts, options)(), effects.publicMissRefreshMinutes);
    const copy = copyKey ? await copyOf<T>(copyKey) : null;
    if (copy) {
      // The page says it shows a saved copy, and from when (§493): nothing failed, but the database was not asked.
      noteSavedCopyServed(copy.takenAt);
      // A static page made from a copy is kept a minute, never a day (§549).
      await holdPageFor(DEGRADED_PAGE_SECONDS);
      return copy.value;
    }
    throw error;
  }
}

/**
 * The one callback every `unstable_cache` call of `publicRead` is given — the request's read, the
 * red month's lookup and the background refresh alike (§447).
 *
 * Next files an entry under the callback's **source text** as well as the key parts
 * (`${cb.toString()}-${keyParts.join(",")}` in Next 16's `unstable-cache.js`), so a lookup made
 * with a different function than the one that filled the entry can never find it. The red lookup
 * used to pass its own `throw new ColdMissError()`: it never hit, and at red every public read was
 * a cold miss served from a saved copy, however warm the cache. One function literal, returned
 * from here, is the same text on every path; `coldOnly` is a value it closes over, not a word in it.
 */
function fillEntry(loadAndKeep: () => Promise<unknown>, coldOnly: boolean): () => Promise<unknown> {
  return async () => {
    if (coldOnly) throw new ColdMissError();
    return loadAndKeep();
  };
}

/**
 * Whether a public read that misses is being answered without the database right now (§447, §493):
 * a red month, inside a production Next server, and no write on this instance has just woken the
 * compute. For the reads that go around `publicRead` — an address that can name no row, a path too
 * long to cache — so that at red they, too, answer without waking the database for whoever typed it.
 */
export function answeringFromCacheOnly(): boolean {
  if (!insideNextServer() || process.env.NODE_ENV !== "production" || prerenderingAtBuild()) return false;
  return governorEffects(peekNeonBudgetLevel()).publicMissRefreshMinutes > 0 && !computeAwakeFromWrite();
}

/**
 * The age a red month's cache lookup treats as stale (§493): a year — Next's own "no revalidation"
 * value — so the lookup never starts a background revalidation of an entry it would only fail to
 * refresh. Only the lookup's: the entries the refresh writes keep the stretched day's ceiling.
 */
const RED_LOOKUP_REVALIDATE_SECONDS = 365 * 24 * 60 * 60;

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
 *
 * The same kinds are expired a second time, `SECOND_EXPIRY_DELAY_MS` after the response, in this
 * request's own `after()` (§583): see `expireAgainAfterTheInFlightRenders`.
 */
export function revalidatePublicContent(...contents: PublicContent[]): void {
  if (!insideNextServer()) return;
  // The write woke the compute already: a red month's next miss may refresh at once (§447).
  allowRefreshNow();
  const expired = expire([...new Set(contents)], FIRST_EXPIRY);
  expireAgainAfterTheInFlightRenders(expired);
}

/**
 * How long after the response the second expiry waits (§583): three seconds.
 *
 * Long enough for a render that was already running when the write committed to be stored — a
 * public page renders in well under a second of CPU (§549 measured about 68 ms), and its reads are
 * one or two queries on a compute the write has just woken — and short enough that the next
 * visitor after it sees the write. It costs no CPU, no query and no request: a timer inside the
 * write's own function, which `after()` keeps alive until it fires.
 */
export const SECOND_EXPIRY_DELAY_MS = 3_000;

/** The write's own expiry: at once, never "max" (above). */
const FIRST_EXPIRY = { expire: 0 } as const;

/**
 * The second expiry's profile: the same effect as the first — Next hands the cache handler only
 * `expire` (`revalidation-utils.js#revalidateTags`), so both mark the tag stale and expired *now* —
 * under a profile that is not written the same way.
 *
 * It has to be different. Next keeps a request's revalidated tags in one list and, after the
 * `after()` callbacks, executes only the tags that are *new* to it, compared by tag and profile
 * (`withExecuteRevalidates` → `diffRevalidationState`). A second `revalidateTag` of the same tag with
 * the same profile updates the entry already in the list, which the diff then drops: the second
 * expiry would silently do nothing. `second-expiry.test.ts` pins both halves against the installed
 * Next.
 */
export const SECOND_EXPIRY = { stale: 0, expire: 0 } as const;

/** Expire each kind's tag; returns the kinds Next accepted. */
function expire(kinds: readonly PublicContent[], profile: typeof FIRST_EXPIRY | typeof SECOND_EXPIRY): PublicContent[] {
  const accepted: PublicContent[] = [];
  for (const content of kinds) {
    try {
      revalidateTag(publicTag(content), profile);
      accepted.push(content);
    } catch (error) {
      console.error("[public-cache] could not expire", publicTag(content), error);
    }
  }
  return accepted;
}

/**
 * Expire the same tags again once the renders that were in flight at the write have landed (§583).
 *
 * **Why.** An expiry marks the tag with the moment it was made, and Next treats as fresh any entry
 * *stored* after that moment (`tags-manifest.external.js#areTagsExpired`: expired only when
 * `expiredAt > lastModified`, and `lastModified` is the moment of the `set`). Nothing records when
 * the entry's render *started*. So a visitor's render of the listing that read the rows just before
 * the publish committed, and was stored just after the publish expired `public:events`, is a fresh
 * copy without the new event — on `next start` until the next write to any event or the page's own
 * clock (at most a day), found by `partner-marker.spec.ts` on a shared listing. The rows' own entry
 * (`unstable_cache`) has the same window. Vercel documents no guard either: its ISR purges the old
 * payload and keeps the one stored next, whichever rows it was made from.
 *
 * **What.** One timer in the write's own request, after its response: nothing warms a page, nothing
 * polls, no request is made and nothing reads the database; the next visitor's request renders the
 * page, as after any write (§577). Only the kinds the first expiry was accepted for: a call Next
 * refused (a render, which may not expire) is not expired later behind its back. Outside a request
 * (a test, a script, a seed) there is no `after()` and nothing to expire twice.
 */
function expireAgainAfterTheInFlightRenders(kinds: readonly PublicContent[]): void {
  if (kinds.length === 0) return;
  try {
    after(async () => {
      await new Promise((resolve) => setTimeout(resolve, SECOND_EXPIRY_DELAY_MS));
      expire(kinds, SECOND_EXPIRY);
    });
  } catch {
    // No request scope: the first expiry is all there is to do.
  }
}
