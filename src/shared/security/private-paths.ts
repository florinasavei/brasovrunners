import { ALIAS_SEGMENTS } from "@/i18n/aliases";

/**
 * Which URLs are staff-only: never indexed, never publicly cached (AGENTS.md §14.5;
 * BR-REQ-051-02 criterion 2). Separate from the proxy so it can be tested without Next's runtime.
 */

/**
 * The first segment of every staff-only route, in both locales. Literal rather than derived
 * from `routing.pathnames`: it must hold for URLs the router never produced. A new staff route
 * adds its segment here.
 */
const PRIVATE_SEGMENTS: readonly string[] = [
  "admin",
  // The configuration report: no values, but a map of what a deployment is missing.
  "devs",
  "preview",
  "previzualizare",
  "sign-in",
  "autentificare",
  // The members' zone (§524).
  "zona-membri",
  "members-area",
  // Typed aliases, so the redirect carries its destination's headers (`src/i18n/aliases.ts`).
  ...ALIAS_SEGMENTS,
];

export function isPrivatePath(pathname: string): boolean {
  const segments = pathname.split("/").filter(Boolean);
  // Normally the second segment decides (after the locale); an unprefixed request on its way
  // to the redirect is judged on its first.
  return [segments[0], segments[1]].some(
    (segment) => segment !== undefined && PRIVATE_SEGMENTS.includes(segment),
  );
}
