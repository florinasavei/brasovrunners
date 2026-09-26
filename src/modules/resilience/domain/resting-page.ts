/**
 * The short resting page (§NNN): where a public page sends its reader when the month's budget is
 * red, its read missed the data cache, and no last good copy stood behind it — «Pagina se
 * reîncarcă în câteva minute». Pure: the path, the header, the wait and the one check on the
 * address to come back to.
 */

/** The route that answers it: a route handler, so it can say 200 and `Retry-After` and read nothing. */
export const RESTING_PAGE_PATH = "/api/resting";

/**
 * The request header `proxy.ts` puts the visited path and query in, so a page that found nothing
 * to show can send the reader back to the same address. Always overwritten by the proxy, never
 * trusted as more than a path on this site (`safeBackPath`).
 */
export const REQUEST_PATH_HEADER = "x-br-path";

/**
 * How long the resting page asks the reader (and a crawler, through `Retry-After`) to wait before
 * trying again: two minutes. The refresh the miss scheduled runs right after the response when the
 * wave is allowed, so the second visit usually finds the rows in the cache.
 */
export const RESTING_RETRY_SECONDS = 120;

const MAX_BACK_LENGTH = 512;

/**
 * The address to come back to, only when it is a path on this site: it starts with one `/`, is
 * not `//host` or `/\host` (both read as another origin by a browser), carries no control
 * character, and is of a sane length. Anything else is the site's root, never an open redirect.
 */
export function safeBackPath(value: string | null | undefined): string {
  if (typeof value !== "string" || value.length === 0 || value.length > MAX_BACK_LENGTH) return "/";
  if (!value.startsWith("/") || value.startsWith("//") || value.startsWith("/\\")) return "/";
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code < 0x20 || code === 0x7f) return "/";
  }
  return value;
}

/** The resting page's address for a reader who was on `back`. */
export function restingPageHref(back: string | null | undefined): string {
  return `${RESTING_PAGE_PATH}?back=${encodeURIComponent(safeBackPath(back))}`;
}
