import { cache } from "react";

/**
 * The public reads one request has already asked for, by key (§NNN) — so a read that several parts
 * of one page need is asked of the data cache once, and on a miss of the database once.
 *
 * ## Why
 *
 * A page is a tree of Server Components that do not know about each other, and several of them
 * read the same thing. Measured on a production build (`next start`, a statement log on the
 * database): the event page and `generateMetadata` both read the event, so a cold event page ran
 * the same query twice; the listing's upcoming and past sections both read the endings that key
 * them (§333's clock), twice; the header and the footer both read the club's shown address; the
 * contact page read the privacy notice's effective dates once per language. Each duplicate is one
 * more trip to the data cache on every visit — on Vercel that is a network round trip — and one
 * more query on every cold one.
 *
 * ## Why React's `cache`, and why only for one request
 *
 * React scopes `cache` to the request being rendered: the layout, the page and `generateMetadata`
 * share one map, and the next request starts with an empty one. So two readers of one key within
 * a request get the answer of the same moment — which they would have got anyway, a GET render
 * writes nothing — and nothing is ever shared between two requests, where a write committed in
 * between must be seen by the second (§333, §28). Outside a render — a route handler, a test, a
 * script — React calls the function every time, so each call gets a fresh map and nothing is
 * remembered: the read goes through exactly as before.
 */
export const thisRequestsReads = cache((): Map<string, Promise<unknown>> => new Map());
