import { isBackofficeRole, type StaffRole } from "./roles";

/**
 * Where a sign-in lands (§524) — a pure function, so the rule is tested without a browser.
 *
 * One sign-in page serves the team and the club's members. It is opened from two places: the
 * backoffice's own door (`/admin` sends an anonymous visitor there) and «Beneficiile membrilor»'s
 * button, which says `?to=members`. The provider's sign-in is asked where to return before it
 * knows who is signing in, so the target is the page the person came from — and the role decides
 * after: a member who arrives at `/admin` is sent on to the members' zone by the backoffice's
 * layout, and a colleague who signed in from the members' page lands in the zone they asked for.
 *
 * `to` is read from a query string anybody can type, so it is a closed set — never a path, which
 * would be an open redirect.
 */
export type SignInTarget = "admin" | "members";

export function signInTargetOf(value: unknown): SignInTarget {
  return value === "members" ? "members" : "admin";
}

/** The route a signed-in person is sent to from the sign-in page: a member always to the zone. */
export function landingFor(role: StaffRole, target: SignInTarget): "/admin" | "/members-area" {
  if (!isBackofficeRole(role)) return "/members-area";
  return target === "members" ? "/members-area" : "/admin";
}

/**
 * A closed way back from the sign-in to the volunteers' page of one event (§NNN; the owner's «Brașov Runners only» volunteers): the
 * page sends a stranger to the members' sign-in with `?back=volunteers&slug=<slug>`, and the person lands on that page, not in the zone.
 *
 * Like `to`, it is read from a query string anybody can type, so it is never a path: only the one page name this knows, and a slug
 * that fits the events' own pattern — the destination is rebuilt from it by `getPathname`, never taken from the address. Anything else
 * is no way back (`null`), and the sign-in lands where it always did.
 */
export type SignInBack = { page: "volunteers"; slug: string };

const BACK_SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function signInBackOf(back: unknown, slug: unknown): SignInBack | null {
  if (back !== "volunteers" || typeof slug !== "string" || slug.length > 120 || !BACK_SLUG.test(slug)) return null;
  return { page: "volunteers", slug };
}
