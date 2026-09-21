import { buildInfo } from "@/shared/config/build-info";

/**
 * `/api/build-id` — which deployment is serving this hostname, and nothing else at all.
 *
 * The route is `build-id` and not `build` because line 20 of `.gitignore` is `build/`, which
 * silently swallows `src/app/api/build/`: the file is written, the build compiles it, and the
 * working tree never mentions it again. The name earns its keep anyway — what this serves is
 * an identity, not a report, and the report is `/api/health`.
 *
 * ## Why this is not `/api/health`
 *
 * `/api/health` already reports the build, and reusing it would have been one route fewer. It
 * would also have been a mistake. That endpoint opens a database connection, asks the schema
 * version, reads two job rows and the email allowance, and answers 503 when any of it is
 * wrong: it is the club's **alarm**, wired to a cron-job.org monitor with failure
 * notifications (`DECISIONS.md` §98). Pointing every open tab at it would put the site's
 * visitors on the same path as the alarm — Neon's free plan is a hundred CU-hours a month per
 * project (§68), and a phone left open on the event page would be waking the database every
 * minute. Worse, a degraded email allowance would answer 503 to a question that has nothing
 * to do with email, and the tab would learn nothing.
 *
 * So this route exists, and its only virtue is what it does not do. The import list is the
 * proof: `build-info.ts`, which imports nothing at all and reads three inlined strings. No
 * `db/client`, no session, no `env` — nothing transitively reachable from here can open a
 * connection or read a cookie.
 *
 * ## The caching, and why it is the way round it is
 *
 * `force-static`. The body is a build-time constant — `buildInfo.id` is inlined by
 * `next.config.ts` — so Next prerenders this at build and the platform serves it as an asset
 * of *this deployment*. That is the whole trick, and it is why the answer is both free and
 * never stale:
 *
 * - **Free**, because a poll is a CDN hit rather than a function invocation. Vercel is Hobby;
 *   an uncacheable route answering one request per tab per minute is an invocation bill for a
 *   twelve-character string that cannot change.
 * - **Never stale**, because the staleness that matters is not time, it is *deployment*. A
 *   ten-minute cache would be exactly the bug this feature exists to fix: it could not report
 *   a deploy from two minutes ago, which is the only deploy anybody asks about. Here the
 *   hostname's alias points at one deployment, this asset belongs to that deployment, and the
 *   moment the alias moves the asset moves with it. There is no window in which the answer is
 *   old and the deployment is new.
 *
 * `Cache-Control: no-cache` on top of that is for everything between the platform and the
 * tab — a browser's own cache, a corporate proxy, an ISP's. `no-cache` is not `no-store`: the
 * response may be kept, it may not be *reused without asking*. Combined with the island's
 * `cache: no-store` fetch, a poll always reaches the edge, and the edge always answers for the
 * deployment the visitor is actually on.
 *
 * `noindex`: `robots.txt` already disallows `/api/`, and the header is the belt for a crawler
 * that ignores it. There is nothing here worth a search result.
 */
export const dynamic = "force-static";

export function GET(): Response {
  /**
   * A single field, deliberately. Every extra fact here is a fact served to every visitor on
   * every poll and a fact the client has to be taught to ignore; the commit, the baseline and
   * the migration head are all on `/api/health`, where an operator is asking rather than a
   * browser. And it is an object rather than a bare string so a field can ever be added
   * without the parser in `shared/ui/new-build.ts` having to guess which format it is reading.
   */
  return new Response(JSON.stringify({ build: buildInfo.id }), {
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-cache",
      "x-robots-tag": "noindex, nofollow",
    },
  });
}
