import { z } from "zod";

/**
 * The organizations an event is held with (`DECISIONS.md` §168; the owner: "any number of
 * partners on one event, each with a name and an optional link") — and, since §NNN (the owner:
 * "this can have multiple links, so it should be a card, it's like: partner link, partner
 * event, etc"), any number of links on each partner: its own site, its own event, where to
 * register with it, its socials.
 *
 * The row used to carry one partner in two columns, `co_host_name` and `co_host_url` (§121),
 * then a list of `{ name, url }` in `co_hosts` (§168). It carries a list of `{ name, links }`
 * now, and neither older shape is rewritten: this file is the only place that decides what a
 * stored row means, so the page, the card, the calendar, the structured data and the editor
 * cannot disagree about it.
 */

/** Eight is more partners than the club has ever had, and few enough to read on a card. */
export const MAX_CO_HOSTS = 8;
/** Eight links is more than one partner has ever needed: its site, its event, where to
 * register, and its socials, with room to spare. */
export const MAX_CO_HOST_LINKS = 8;
/** A label is a few words on one line, not a paragraph — the same ceiling `EventLink` uses. */
export const MAX_CO_HOST_LINK_LABEL = 80;
/** Longer than any share link a partner's own site, event platform or social profile makes. */
export const MAX_CO_HOST_LINK_URL = 2000;

/**
 * What a partner's link is, as a closed set: its own site, its own page for this event, where
 * to register with it, its three socials, or something else. A seventh is a code change with a
 * decision behind it, not free text — the discipline `EVENT_LINK_KINDS` follows (§332).
 */
export const CO_HOST_LINK_KINDS = ["SITE", "EVENT", "REGISTRATION", "FACEBOOK", "INSTAGRAM", "STRAVA", "OTHER"] as const;
export type CoHostLinkKind = (typeof CO_HOST_LINK_KINDS)[number];

export const isCoHostLinkKind = (value: string): value is CoHostLinkKind => (CO_HOST_LINK_KINDS as readonly string[]).includes(value);

/**
 * What a new link row starts as, and what a stored kind nobody chose is read as — "other", not
 * "site", so a kind this release does not know never makes the page call an unrelated link the
 * partner's own site (the reasoning `DEFAULT_EVENT_LINK_KIND` carries for §332).
 */
export const DEFAULT_CO_HOST_LINK_KIND: CoHostLinkKind = "OTHER";

/**
 * The one kind a partner's bare `url` always meant, from §168 until this list existed: the
 * partner's own page. Named apart from `DEFAULT_CO_HOST_LINK_KIND` because the two answer
 * different questions — that one is "a kind nobody chose", this one is "the kind §168 always
 * meant" — and a later release must be free to change either without touching the other.
 */
const LEGACY_CO_HOST_LINK_KIND: CoHostLinkKind = "SITE";

/** A partner's link: https, like every other link an organizer pastes (`AGENTS.md` §8). */
export const isCoHostUrl = (value: string) => /^https:\/\/\S+$/i.test(value) && value.length <= MAX_CO_HOST_LINK_URL;

/**
 * The scheme written in lower case, so a pasted "HTTPS://…" satisfies the database's own check —
 * the same courtesy `normalizeEventLinkUrl` does for "Linkuri și fișiere" (§332).
 */
export const normalizeCoHostUrl = (value: string) => value.replace(/^https:\/\//i, "https://");

export type CoHostLink = {
  kind: CoHostLinkKind;
  url: string;
  /** The club's own word for it in each language, or null for the kind's default word. */
  labelRo: string | null;
  labelEn: string | null;
};

export type CoHost = {
  name: string;
  links: CoHostLink[];
};

const optionalLabel = z
  .string()
  .trim()
  .max(MAX_CO_HOST_LINK_LABEL)
  .nullable()
  .optional()
  .transform((value) => (value ? value : null))
  .catch(null);

/**
 * A stored link, read leniently on purpose — the discipline `storedLinkSchema` follows for
 * "Linkuri și fișiere" (§332). Not `.strict()`: a key a later release adds is stripped, never a
 * reason to drop the link. A kind this release does not know reads as "other" rather than
 * taking the link down, and a label that cannot be read falls back to the kind's own word. Only
 * the address is required: a link without an https address is nothing to render.
 */
const coHostLinkSchema = z.object({
  kind: z
    .string()
    .refine(isCoHostLinkKind)
    .catch(DEFAULT_CO_HOST_LINK_KIND)
    .transform((value) => value as CoHostLinkKind),
  url: z.string().trim().refine(isCoHostUrl),
  labelRo: optionalLabel,
  labelEn: optionalLabel,
});

/**
 * A stored partner, read leniently on purpose (§169), and read whichever shape it was last
 * saved in: the list's own two releases.
 *
 * `links` is this release's shape; a bare `url` is the one a row saved by the release before
 * this wrote (§168), read as the one link it always meant — the partner's own site. Neither key
 * makes the object fail to parse on its own: an unreadable `url` (not a string, not https) is
 * silently "no link", exactly as the two columns before the list ever did, and an unreadable
 * entry inside `links` is dropped rather than taking the rest of the partner's links with it.
 * A name is still required — a partner without one is nothing to render.
 */
const coHostSchema = z
  .object({
    name: z.string().trim().min(1).max(200),
    links: z.unknown().optional(),
    url: z.unknown().optional(),
  })
  .transform((row): CoHost => {
    const rawLinks = row.links;
    const links = Array.isArray(rawLinks)
      ? rawLinks
          .flatMap((entry) => {
            const parsed = coHostLinkSchema.safeParse(entry);
            return parsed.success ? [parsed.data] : [];
          })
          .slice(0, MAX_CO_HOST_LINKS)
      : typeof row.url === "string" && isCoHostUrl(row.url)
        ? [{ kind: LEGACY_CO_HOST_LINK_KIND, url: row.url, labelRo: null, labelEn: null }]
        : [];
    return { name: row.name, links };
  });

/** What a row has to carry to be read: the column, and the two columns it replaced. */
export type CoHostSource = {
  coHosts: unknown;
  coHostName: string | null;
  coHostUrl: string | null;
};

/**
 * The event's partners, in the order the club listed them.
 *
 * A row saved since the column exists answers with the column — **including when the answer
 * is none**: an empty array is the club having removed every partner, and falling back to the
 * old columns there would bring back a name somebody deleted. So anything that is an array is
 * the answer, and only a null column (a row nobody has saved since) reads the two old columns
 * as the one co-host they always were, its page — if https — the one link it had.
 */
export function readCoHosts(row: CoHostSource): CoHost[] {
  if (Array.isArray(row.coHosts)) {
    return row.coHosts
      .flatMap((entry) => {
        const parsed = coHostSchema.safeParse(entry);
        return parsed.success ? [parsed.data] : [];
      })
      .slice(0, MAX_CO_HOSTS);
  }
  if (row.coHostName) {
    const url = row.coHostUrl && isCoHostUrl(row.coHostUrl) ? row.coHostUrl : null;
    return [{ name: row.coHostName, links: url ? [{ kind: LEGACY_CO_HOST_LINK_KIND, url, labelRo: null, labelEn: null }] : [] }];
  }
  return [];
}

/**
 * The label the club wrote for this link in this language, or null — the caller shows the
 * kind's own default word then, the same contract `eventLinkLabel` carries for §332.
 */
export function coHostLinkLabel(link: Pick<CoHostLink, "labelRo" | "labelEn">, locale: "ro" | "en"): string | null {
  return (locale === "ro" ? link.labelRo : link.labelEn) ?? null;
}

/**
 * Where a partner's link goes, in small text under its label — the same reading `eventLinkHost`
 * gives "Linkuri și fișiere" (§332). Duplicated rather than imported so this file still depends
 * on nothing but Zod, the discipline its own header comment states.
 */
export function coHostLinkHost(url: string): string | null {
  try {
    const host = new URL(url).hostname.toLowerCase();
    if (!host) return null;
    return host.startsWith("www.") ? host.slice(4) : host;
  } catch {
    return null;
  }
}

/**
 * A partner's one link for a sentence that can carry only one: the compact card's mention and
 * the JSON-LD organizer's `url` (§168, §169) — its own site if it named one, else the first
 * link it did, else none.
 */
export function primaryCoHostLink(host: Pick<CoHost, "links">): CoHostLink | null {
  return host.links.find((link) => link.kind === "SITE") ?? host.links[0] ?? null;
}
