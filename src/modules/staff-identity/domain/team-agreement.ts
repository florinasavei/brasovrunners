import { TEAM_AGREEMENT_NAME_MAX } from "@/db/schema/staff-team-agreement-acceptances";
import { REQUEST_PATH_HEADER } from "@/modules/resilience/domain/resting-page";

/**
 * The team's undertaking at sign-in (§1006; the owner, 2026-11-19: «Voluntarii trebuie să semneze acordul GDPR când intră în
 * platformă»), the parts that are rules rather than reads: which request is a page being drawn, where a refused page wanted to
 * go, the undertaking's own address, and the name typed under it. Pure: headers arrive as an object with `get`, so a unit test
 * needs no request.
 */

/** The undertaking's page, without its locale: the same spelling in both, like every backoffice path. */
export const TEAM_AGREEMENT_PATH = "/admin/acord";

export { TEAM_AGREEMENT_NAME_MAX };

/** The longest address kept as a way back — the resting page's own bound (`safeBackPath`). */
const MAX_RETURN_LENGTH = 512;

/** Next's own query parameter on a router request (`?_rsc=…`): never part of where a person was going. */
const ROUTER_PARAMETER = "_rsc";

type HeaderReader = { get(name: string): string | null };

/**
 * What kind of request met the gate (§1006), which decides how it is refused.
 *
 * - **A page being drawn** — a GET the proxy saw (`proxy.ts` writes the visited path into `x-br-path` on every request it
 *   passes, always overwriting what a caller sent), with no `next-action` header: the reader is sent to the undertaking, the
 *   page they asked for kept as the way back. A form sent without JavaScript is a POST of the same kind and is sent the same
 *   way: nothing it carried is done.
 * - **Anything else is refused with FORBIDDEN**: a Server Action (Next's `next-action` header) and a route handler — the proxy
 *   does not run on `/api`, so no path header reaches one. A press on a page left open from before the text took effect is
 *   refused there, and its redirect back to the page lands on the undertaking.
 */
export type GateRequest = { kind: "page"; path: string } | { kind: "refuse" };

export function gateRequestOf(headers: HeaderReader): GateRequest {
  if (headers.get("next-action") !== null) return { kind: "refuse" };
  const path = headers.get(REQUEST_PATH_HEADER);
  return path ? { kind: "page", path } : { kind: "refuse" };
}

/** A path's pathname alone: its query and fragment cut off. */
function pathnameOf(path: string): string {
  return path.split(/[?#]/, 1)[0];
}

/**
 * Whether `path` — with its locale (`/ro/admin/acord`) or without it, with a query or not — is the undertaking's own page.
 * The one page of the backoffice the gate never sends anybody away from.
 */
export function isTeamAgreementPath(path: string | null | undefined): boolean {
  if (!path) return false;
  const pathname = pathnameOf(path).replace(/\/+$/, "");
  return pathname === TEAM_AGREEMENT_PATH || /^\/[a-z]{2}\/admin\/acord$/.test(pathname);
}

/**
 * Where a refused page wanted to go — a scanned `/ro/admin/checkin/<code>`, the desk, the guide — as a path on this site, or
 * null. Only ever a path: it starts with one `/`, is not `//host` or `/\host` (both read as another origin by a browser),
 * carries no control character and no backslash, is of a sane length, and is not the undertaking itself (a way back to the
 * page you are on is no way back). The router's own `_rsc` parameter is dropped. Anything else is no way back, never an open
 * redirect: the undertaking then sends the reader to the backoffice's first page.
 */
export function teamAgreementReturnTo(value: string | null | undefined): string | null {
  if (typeof value !== "string" || value.length === 0 || value.length > MAX_RETURN_LENGTH) return null;
  if (!value.startsWith("/") || value.startsWith("//") || value.includes("\\")) return null;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code < 0x20 || code === 0x7f) return null;
  }
  const [pathname, ...rest] = value.split("?");
  const query = new URLSearchParams(rest.join("?").split("#", 1)[0]);
  query.delete(ROUTER_PARAMETER);
  const search = query.toString();
  const path = pathnameOf(pathname);
  if (isTeamAgreementPath(path)) return null;
  return search ? `${path}?${search}` : path;
}

/** The two-letter locale a site path starts with (`/en/admin` → `en`), or null. */
export function localeOfPath(path: string | null | undefined): string | null {
  const match = /^\/([a-z]{2})(?:\/|$|\?)/.exec(path ?? "");
  return match ? match[1] : null;
}

/**
 * The full name as kept (§1006): trimmed, inner whitespace collapsed to one space; null when nothing is left or it is longer
 * than the 200 characters the column holds (`TEAM_AGREEMENT_NAME_MAX`).
 */
export function teamAgreementName(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const name = value.replace(/\s+/g, " ").trim();
  return name.length >= 1 && name.length <= TEAM_AGREEMENT_NAME_MAX ? name : null;
}

/** The sentence a refusal carries for the logs (§1006): what to do, never who. */
export const TEAM_AGREEMENT_REFUSAL = "the team's undertaking in force has not been accepted by this account: accept it on /admin/acord first";
