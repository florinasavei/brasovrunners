import { type NextRequest, NextResponse } from "next/server";
import { routing } from "@/i18n/routing";
import { cachedLocaleSwitch } from "@/modules/public-cache/reads";

/**
 * The language switcher (BR-REQ-040-01 criterion 5).
 *
 * The header cannot resolve a switch on its own: on an event page the two locales have
 * different slugs, only the database knows the pair, and the header renders above the page that
 * loaded it. So the switch is a server round trip — one redirect, no JavaScript required.
 *
 * `/api/...` is unprefixed by AGENTS.md §9.2 and disallowed in `robots.txt`.
 */
export const dynamic = "force-dynamic";

/**
 * Only a path of ours, never an address.
 *
 * This handler redirects, and a redirector that forwards whatever it is given is an open
 * redirect: a phishing link that begins on the club's own domain. Two defences, and the second
 * is the one that holds — the input must be a bare path, and the output is never the input.
 * Every destination is built by the route helpers from a route that was recognised.
 */
function isSafePath(value: string | null): value is string {
  return value !== null && value.startsWith("/") && !value.startsWith("//");
}

export async function GET(request: NextRequest) {
  const requested = request.nextUrl.searchParams.get("to");
  const from = request.nextUrl.searchParams.get("from");

  const target = (routing.locales as readonly string[]).includes(requested ?? "")
    ? (requested as (typeof routing.locales)[number])
    : routing.defaultLocale;

  // The pair of slugs from the public cache (§333), which publishing expires — the switch is a
  // click every visitor may make, and it should not be the one that wakes the database.
  const destination = await cachedLocaleSwitch(isSafePath(from) ? from : "/", target);

  const response = NextResponse.redirect(new URL(destination, request.nextUrl.origin), 307);
  // The answer depends on the database and on which locales are published, so no HTTP cache may
  // hold it (AGENTS.md §14.5) — the public cache above is expired by publication; a browser's or
  // a CDN's copy would not be.
  response.headers.set("Cache-Control", "no-store");
  return response;
}
