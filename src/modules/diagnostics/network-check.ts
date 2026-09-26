/**
 * The network check on `/admin/network` (§NNN): four things a staff member's browser has to reach,
 * each tried from that browser, each with the one line to hand the company's IT.
 *
 * - `saves` — a Server Action call, the request every backoffice save sends with JavaScript on: a
 *   POST to the page with a `Next-Action` header, answered as `text/x-component`.
 * - `post` — a plain `multipart/form-data` form post, the way a blocked save is sent again
 *   (`shared/forms/save-fallback.ts`).
 * - `pictures` — a stored picture from the host pictures are read at (the bucket's, on R2; §66).
 * - `botCheck` — Cloudflare Turnstile's script, which the registration and contact forms load (§97).
 */
export const NETWORK_PROBES = ["saves", "post", "pictures", "botCheck"] as const;
export type NetworkProbe = (typeof NETWORK_PROBES)[number];

/** `checking` while it runs; `skipped` when there is nothing to try here (no picture stored, no Turnstile keys). */
export type ProbeState = "checking" | "ok" | "blocked" | "skipped";

/** The id of the element the plain-form probe's answer carries, and the frame is searched for. */
export const NETWORK_PROBE_MARKER = "network-probe-ok";

/** Where the plain-form probe posts: a route handler, never localized. */
export const NETWORK_PROBE_PATH = "/api/admin/network-probe";

/** How long a probe may take before it counts as blocked: a proxy that swallows a request never answers. */
export const PROBE_TIMEOUT_MS = 15_000;

export type ReportLine = { title: string; status: string; allow: string | null };

/**
 * The report a staff member copies for the club or for IT: what was tried, what answered, what to
 * allow, the site's host and the browser's own description of itself. Nothing about the person —
 * no name, no address, no account (the owner's standing rule on what leaves a page); the words are
 * the page's, already in the reader's language.
 */
export function networkReport(input: {
  heading: string;
  when: string;
  siteLabel: string;
  site: string;
  browserLabel: string;
  browser: string;
  lines: readonly ReportLine[];
}): string {
  const rows = input.lines.map((line) => (line.allow ? `- ${line.title}: ${line.status} — ${line.allow}` : `- ${line.title}: ${line.status}`));
  return [input.heading, input.when, `${input.siteLabel}: ${input.site}`, ...rows, `${input.browserLabel}: ${input.browser}`].join("\n");
}
