/**
 * Which URLs are staff-only, and therefore never indexed and never publicly cached.
 *
 * A pure function over a path, in a file of its own so it can be tested directly: importing
 * the proxy pulls in the Next.js middleware runtime, and a rule about which URLs are private
 * is exactly the kind of thing that is quietly wrong for a year.
 *
 * AGENTS.md §14.5 forbids a shared public cache on the backoffice; BR-REQ-051-02 criterion 2
 * requires a preview to be noindex and uncached.
 */

/**
 * The first segment of every staff-only route, in both locales.
 *
 * Written as literal segments rather than derived from `routing.pathnames`, because this list
 * has to be right for URLs the router never produced — a bookmarked draft preview, a link
 * pasted into a chat, a crawler guessing. Adding a staff route means adding its segment here.
 */
const PRIVATE_SEGMENTS: readonly string[] = [
  "admin",
  "preview",
  "previzualizare",
  "sign-in",
  "autentificare",
];

export function isPrivatePath(pathname: string): boolean {
  const segments = pathname.split("/").filter(Boolean);
  // The locale prefix is always present (`localePrefix: "always"`), so the segment that
  // decides is the second one — but an unprefixed request reaches the proxy too, on its way to
  // being redirected, and that one must be judged on its first.
  return [segments[0], segments[1]].some(
    (segment) => segment !== undefined && PRIVATE_SEGMENTS.includes(segment),
  );
}
