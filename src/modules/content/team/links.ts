import { z } from "zod";

/**
 * The links on a card of «Echipa» (§474): `team_members.links`, an ordered list of
 * `{ kind, url, labelRo, labelEn }` shaped like an event's links (§332). The one reader of a
 * stored row; imports only Zod so the client editor can use it.
 */

/** Closed set, so the card shows the network's mark and name without typed words. */
export const TEAM_LINK_KINDS = ["STRAVA", "INSTAGRAM", "FACEBOOK", "WEBSITE", "OTHER"] as const;
export type TeamLinkKind = (typeof TEAM_LINK_KINDS)[number];

/**
 * §491. The CHECK `team_members_links_is_a_short_array_of_https_links` (migration 0094) holds the
 * same number; a test keeps them equal.
 */
export const MAX_TEAM_LINKS = 12;
/**
 * The highest posted `links[i]` index read, so a posted `links[99999999]` cannot grow a sparse
 * array of a hundred million holes (§483).
 */
export const MAX_TEAM_LINK_ROWS = MAX_TEAM_LINKS;

/**
 * The rows posted as `links[i].<box>`, by index, blanks included. `links.present` is always posted,
 * so removing every row saves "no links"; absent means the caller posted no list (§474, §483).
 */
export function teamLinkRowsOf(form: FormData): Array<Record<string, string>> | undefined {
  if (form.get("links.present") === null) return undefined;
  const rows: Array<Record<string, string>> = [];
  for (const [key, entry] of form.entries()) {
    const match = /^links\[(\d+)\]\.(kind|url|labelRo|labelEn)$/.exec(key);
    if (!match || typeof entry !== "string") continue;
    const index = Number(match[1]);
    if (index >= MAX_TEAM_LINK_ROWS) continue;
    rows[index] = { ...(rows[index] ?? {}), [match[2]]: entry };
  }
  // A hole (a row index nobody posted) is the spare line, not a row to refuse.
  return Array.from(rows, (row) => row ?? {});
}
/** The longest address accepted — the event links' own ceiling (§332). */
export const MAX_TEAM_LINK_URL = 2048;
/** A label is a few words on one line. */
export const MAX_TEAM_LINK_LABEL = 60;

/** What a new row starts as, and what an unknown stored kind reads as. */
export const DEFAULT_TEAM_LINK_KIND: TeamLinkKind = "OTHER";

export const isTeamLinkKind = (value: string): value is TeamLinkKind => (TEAM_LINK_KINDS as readonly string[]).includes(value);

/** Only `https://` with a dotted host: no `javascript:`, `http:` or bare word on the public card (§459). */
export function isTeamLinkUrl(value: string): boolean {
  if (value.length > MAX_TEAM_LINK_URL || /\s/.test(value)) return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname.includes(".");
  } catch {
    return false;
  }
}

/** The scheme in lower case, so a pasted "HTTPS://…" satisfies the database's own check. */
export const normalizeTeamLinkUrl = (value: string) => value.replace(/^https:\/\//i, "https://");

export type TeamLink = {
  kind: TeamLinkKind;
  url: string;
  /** The club's own words for it in each language, or null for the kind's word (or the host). */
  labelRo: string | null;
  labelEn: string | null;
};

/** The kind a bare address most likely is; reads the legacy `team_members.link`. */
export function guessTeamLinkKind(url: string): TeamLinkKind {
  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return DEFAULT_TEAM_LINK_KIND;
  }
  const on = (domain: string) => host === domain || host.endsWith(`.${domain}`);
  if (on("strava.com") || on("strava.app.link")) return "STRAVA";
  if (on("instagram.com")) return "INSTAGRAM";
  if (on("facebook.com") || on("fb.com")) return "FACEBOOK";
  return "WEBSITE";
}

const storedLabel = z
  .string()
  .trim()
  .max(MAX_TEAM_LINK_LABEL)
  .nullable()
  .optional()
  .transform((value) => (value ? value : null))
  .catch(null);

/** Read leniently (§332): unknown keys stripped, unknown kind → OTHER, bad label → null. Only the address is required. */
const storedLinkSchema = z.object({
  kind: z
    .string()
    .optional()
    .transform((value) => (value && isTeamLinkKind(value) ? value : DEFAULT_TEAM_LINK_KIND))
    .catch(DEFAULT_TEAM_LINK_KIND),
  url: z.string().refine(isTeamLinkUrl),
  labelRo: storedLabel,
  labelEn: storedLabel,
});

/**
 * The stored list, else the legacy single link as a guessed row, else none. Non-https entries are
 * dropped; a one-language label reads as none on both sides (§352).
 */
export function readTeamLinks(stored: unknown, legacyLink: string | null = null): TeamLink[] {
  if (Array.isArray(stored)) {
    const links: TeamLink[] = [];
    for (const entry of stored.slice(0, MAX_TEAM_LINKS)) {
      const parsed = storedLinkSchema.safeParse(entry);
      if (!parsed.success) continue;
      const both = parsed.data.labelRo !== null && parsed.data.labelEn !== null;
      links.push({
        kind: parsed.data.kind,
        url: parsed.data.url,
        labelRo: both ? parsed.data.labelRo : null,
        labelEn: both ? parsed.data.labelEn : null,
      });
    }
    return links;
  }
  if (legacyLink && isTeamLinkUrl(legacyLink)) {
    return [{ kind: guessTeamLinkKind(legacyLink), url: legacyLink, labelRo: null, labelEn: null }];
  }
  return [];
}

/** A link's address without `www.` — "strava.com" — or the address itself when it cannot be read. */
export function teamLinkHost(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

/** The club's label in this language, or null for the kind's own word. */
export function teamLinkLabel(link: TeamLink, locale: string): string | null {
  return locale === "en" ? link.labelEn : link.labelRo;
}
