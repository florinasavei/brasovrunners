import { unstable_cache } from "next/cache";
import { workUnitAsyncStorage } from "next/dist/server/app-render/work-unit-async-storage.external";
import { cache } from "react";

/**
 * How long the CDN may keep a static public page (§NNN, amending §333 and §489).
 *
 * ## Why the pages are static now
 *
 * §333 cached the rows and left every public page rendering per request, because Vercel Hobby's
 * function time looked free and Neon's wakes did not. By 2026-09-28 the club was at 3 h 02 m of
 * Hobby's 4 h a month of Active CPU — and at 100 % Vercel pauses the projects. The CPU per render
 * is small (~68 ms); the number of renders is the cost: nearly every edge request started a
 * function. So a page that is the same for every anonymous visitor is rendered once, kept by
 * Vercel's CDN (ISR: `export const revalidate` on the segment), and rendered again only when a
 * write expires it or its clock says it reads differently.
 *
 * ## What expires a page
 *
 * 1. **A write.** Every public read is an `unstable_cache` entry tagged `public:<kind>`
 *    (`cache.ts`), and a read made while a page is prerendered files the *page* under the same
 *    tags. So `revalidatePublicContent(...)` — the one call every write already makes (§333) —
 *    expires the pages that showed what it changed, in the CDN too. No second list of call sites.
 * 2. **The clock.** A page is kept until the first instant at which it would read differently
 *    (`holdPageUntil`): the next event ending, a waiting-list offer lapsing, a legal version
 *    taking effect (the clock-keyed reads call it), a registration window opening or closing, the
 *    weather window, the next midnight (the page's own call, `events/domain/page-clock.ts`).
 * 3. **A ceiling of a day** (`PUBLIC_PAGE_CEILING_SECONDS`) — the rows' own ceiling (§333), for
 *    what nobody announced: a row changed in Neon's console, a seed.
 *
 * A page rendered from a last good copy, a saved copy, or with a part left out because the
 * database was away (§281, §447) is kept a minute (`holdPageFor(DEGRADED_PAGE_SECONDS)`), so the
 * CDN never keeps an outage's page for a day.
 *
 * ## How the lifetime is set
 *
 * Next 16 without Cache Components has no call that says "keep this render N seconds"; the
 * segment's `revalidate` is a literal. What it has is the rule the ISR guide states for fetches —
 * the lowest `revalidate` a prerender meets is the page's — and `unstable_cache` follows it: in a
 * prerender it lowers the page's revalidate to its own before it looks anything up (Next 16.3.4,
 * `server/web/spec-extension/unstable-cache.js`, the `prerender-legacy` case). So the lifetime is
 * one tiny cached entry read with that number. In a request-time render (a live twin, a form page,
 * a token page, the share picture) the same call would change nothing — those responses are
 * `no-store` or carry their own header — so it is not made there (`renderKind`): a Data Cache round
 * trip for nothing, per shorter hold, per view.
 *
 * Outside a production Next server — a test, a script, `next dev`, `next build` — nothing is done:
 * there is no page cache to shorten, and `next build` prerenders no public page (the locale layout
 * generates no params, so every page is made on its first request, never at build).
 */

/** The ceiling, in seconds. Every static public segment's `export const revalidate` equals it (a test holds them together). */
export const PUBLIC_PAGE_CEILING_SECONDS = 86_400;

/** How long a page made while the database was away, or from a copy, is kept (§281, §447). */
export const DEGRADED_PAGE_SECONDS = 60;

/**
 * Seconds from `now` to the first of `instants` still ahead, rounded up, between 1 and `ceiling` —
 * `ceiling` when none is ahead. Pure: what `holdPageUntil` asks Next for.
 */
export function secondsUntilFirst(instants: readonly (Date | null | undefined)[], now: Date, ceiling: number = PUBLIC_PAGE_CEILING_SECONDS): number {
  const at = now.getTime();
  let first: number | null = null;
  for (const instant of instants) {
    const time = instant?.getTime();
    if (time === undefined || Number.isNaN(time) || time <= at) continue;
    if (first === null || time < first) first = time;
  }
  if (first === null) return ceiling;
  return Math.min(ceiling, Math.max(1, Math.ceil((first - at) / 1000)));
}

/** Keep the page being rendered no longer than until the first of `instants` still ahead. */
export async function holdPageUntil(instants: readonly (Date | null | undefined)[], now: Date = new Date()): Promise<void> {
  const seconds = secondsUntilFirst(instants, now);
  if (seconds < PUBLIC_PAGE_CEILING_SECONDS) await holdPageFor(seconds);
}

/** Keep the page being rendered no longer than `seconds`. Never throws: a lifetime is not worth a page. */
export async function holdPageFor(seconds: number): Promise<void> {
  if (!pagesAreCachedHere() || renderKind() === "request") return;
  const revalidate = Math.max(1, Math.min(PUBLIC_PAGE_CEILING_SECONDS, Math.ceil(seconds)));
  // Once per render for the shortest hold asked so far: a listing asks once per card's door, and
  // only a shorter hold than one already set changes anything.
  const held = thisRendersHold();
  if (held.seconds <= revalidate) return;
  held.seconds = revalidate;
  try {
    await unstable_cache(lifetimeMark, ["page-lifetime"], { revalidate })();
  } catch (error) {
    console.error("[public-cache] could not shorten the page's lifetime", error);
  }
}

/** The shortest hold this render has set (React's per-request `cache`, as `request-memo.ts`); a fresh one outside a render. */
const thisRendersHold = cache((): { seconds: number } => ({ seconds: Number.POSITIVE_INFINITY }));

/**
 * The entry's one function (`unstable_cache` keys an entry on its callback's source text as well
 * as its key parts — `cache.ts#fillEntry` says why that matters): one module-level function, the
 * same text on every call.
 */
async function lifetimeMark(): Promise<number> {
  return 1;
}

/**
 * What Next is doing on this call's behalf (§NNN): making a response it will keep — a static page's
 * render (ISR, Next's `prerender-legacy` without Cache Components) or a `force-static` handler's —
 * or answering one request, or neither as far as can be told.
 *
 * Next has no public call for it, so this asks the store Next's own `headers()` and
 * `unstable_cache` ask (`next/dist/server/app-render/work-unit-async-storage.external`, Next 16.3.4;
 * `tests/unit/public-cache/page-lifetime.test.ts` pins the two type names it reads against the
 * installed Next). It fails towards today's behaviour: anything it does not recognise — no store, a
 * cached function's scope, a Next that renamed its types — is `"unknown"`, and every caller treats
 * `"unknown"` as a render that may be kept (holding it, never reading the request). Only a positive
 * `"request"` skips a hold or reads a header.
 */
export function renderKind(): "kept" | "request" | "unknown" {
  try {
    const type: string | undefined = workUnitAsyncStorage.getStore()?.type;
    if (type === "request") return "request";
    if (type === "prerender-legacy") return "kept";
  } catch {
    // Outside Next, or a Next whose store answers differently: the safe side.
  }
  return "unknown";
}

/** A production Next server, not `next build`: the only place a page is kept by ISR. */
export function pagesAreCachedHere(): boolean {
  return process.env.NEXT_RUNTIME === "nodejs" && process.env.NODE_ENV === "production" && process.env.NEXT_PHASE !== "phase-production-build";
}
