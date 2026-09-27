import { z } from "zod";

/**
 * The links on a card of «Echipa» (§474, growing §459's one link; the owner, 2026-09-26: "trebuie
 * să pot pune mai multe link-uri").
 *
 * An ordered list in `team_members.links`, `[{ kind, url, labelRo, labelEn }]`, at most six: a
 * person's Strava, their Instagram, their Facebook, a site of their own, anything else. The shape
 * of an event's "Linkuri și fișiere" (§332) — a kind from a closed set, an https address, a label
 * in both languages or neither (§352) — with the kinds a person has rather than the kinds a race
 * has.
 *
 * This file is the one place that decides what a stored row means, so the page, the backoffice
 * and the save cannot disagree about it. It imports nothing but Zod, so the editor's client
 * island can read the kinds without pulling a database or a catalogue in with them.
 */

/**
 * What a link is, so the card can wear the network's own mark and say its name without the club
 * typing a word. A seventh kind is a code change with a decision behind it, not free text.
 */
export const TEAM_LINK_KINDS = ["STRAVA", "INSTAGRAM", "FACEBOOK", "WEBSITE", "OTHER"] as const;
export type TeamLinkKind = (typeof TEAM_LINK_KINDS)[number];

/** Six: a person's networks and a site of their own, few enough to read on a card two to a row. */
export const MAX_TEAM_LINKS = 6;
/**
 * How many rows a save reads from `links[i].<box>` — indexes 0 to 11 (§483; the V2.06 review): the
 * editor never draws more than `MAX_TEAM_LINKS` rows and a spare line, so a posted
 * `links[99999999]` is not a row of it — and gathered by index it would have become an array of a
 * hundred million holes. Twelve, an event's own ceiling (§332), leaves room for the cap to grow
 * without a second change here. The cap itself stays six for now: raising it also moves the CHECK
 * `team_members_links_is_a_short_array_of_https_links`, a migration queued in `docs/QUEUE.md`
 * until `drizzle-kit generate` runs over a rebuilt snapshot chain.
 */
export const MAX_TEAM_LINK_ROWS = 12;

/**
 * The links' rows (§474), posted as `links[i].<box>` by `TeamLinkRowsEditor` — gathered by index,
 * blanks included; `fields.ts` drops the spare line and names a refused row by this same index.
 * The editor always posts `links.present`, so a card whose every row was removed saves "no links".
 * Here rather than in the Server Action's file so the bound is tested without a request (§483).
 */
export function teamLinkRowsOf(form: FormData): Array<Record<string, string>> | undefined {
  if (form.get("links.present") === null) return undefined;
  const rows: Array<Record<string, string>> = [];
  for (const [key, entry] of form.entries()) {
    const match = /^links\[(\d+)\]\.(kind|url|labelRo|labelEn)$/.exec(key);
    if (!match || typeof entry !== "string") continue;
    const index = Number(match[1]);
    // Past the editor's own rows: not a row, and never an index to grow the array to (§483).
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

/**
 * An `https://` address with a host that has a dot in it, or not a link: `http:`, `javascript:`
 * and a bare word are refused, so the public card never renders an address the browser would run
 * or downgrade (§459's rule for the one link, kept for every row).
 */
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

/**
 * The kind a bare address most likely is — how the one link a card carried before this list
 * (`team_members.link`) is read: a Strava profile wears Strava's mark, an Instagram page
 * Instagram's, anything else is the person's site.
 */
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

/**
 * A stored link, read leniently on purpose — §332's discipline: a key a later release adds is
 * stripped, an unknown kind reads as "other", a label that cannot be read falls back to the
 * kind's word. Only the address is required.
 */
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
 * A card's links as stored: the list when the column holds one, else the one link from before the
 * list as a row of its guessed kind, else none. An entry that is not an https link is dropped;
 * a label in one language only reads as none on both pages (§352), the kind's word standing in.
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
