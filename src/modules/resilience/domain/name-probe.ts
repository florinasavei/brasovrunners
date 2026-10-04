import { isIP } from "node:net";

/**
 * Whether the site's public name resolves (§NNN, the outage grace), as pure rules: which host is asked at all, and
 * what a resolver's error means. The lookup itself is `resilience/name-probe.ts`.
 *
 * Only an answer that the name does not exist is `unresolved` — `ENOTFOUND` (the zone has no such
 * name: a registrar's hold takes the domain out of its zone). Everything else a resolver can say — a
 * timeout, a refused or failed server, a busy resolver, and `ENODATA` (the name exists with no address
 * of the kind asked: a record being edited, not a door shut) — is `unknown`: it says nothing about the
 * door, so nothing opens or closes on it.
 */

/** What one probe of the name answered: `skipped` where nothing is asked (a laptop, a test, an address that is a number). */
export type NameProbeStatus = "resolves" | "unresolved" | "unknown" | "skipped";

/** The hosts never asked: a laptop, a test, an address that is a number, a name no public resolver knows. */
const PRIVATE_SUFFIXES = [".localhost", ".local", ".test", ".internal", ".invalid", ".example"];

export function probedHost(baseUrl: string, appEnv: string): string | null {
  if (appEnv === "local" || appEnv === "test") return null;
  let host: string;
  try {
    host = new URL(baseUrl).hostname.toLowerCase();
  } catch {
    return null;
  }
  const bare = host.replace(/^\[|\]$/g, "");
  if (bare === "" || bare === "localhost" || isIP(bare) !== 0) return null;
  if (PRIVATE_SUFFIXES.some((suffix) => bare.endsWith(suffix))) return null;
  return bare;
}

/** What a resolver's error says about the name. */
export function probeStatusOf(error: unknown): Exclude<NameProbeStatus, "resolves" | "skipped"> {
  const code = typeof error === "object" && error !== null ? (error as { code?: unknown }).code : undefined;
  return code === "ENOTFOUND" ? "unresolved" : "unknown";
}
