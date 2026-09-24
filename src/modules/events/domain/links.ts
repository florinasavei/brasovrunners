import { z } from "zod";

/**
 * "Linkuri și fișiere" on an event (`DECISIONS.md` §332; the owner, 2026-09-23: "Also on Event I
 * wanna be able to put other links such as google drive files for GPX track files, etc").
 *
 * An ordered list in `events.links`, `[{ kind, url, labelRo, labelEn }]`, at most twelve: the
 * GPX of the course on Google Drive, the extended rules as a PDF on Dropbox, last year's album,
 * the results. Links and never files — the file stays wherever the club keeps it, and the page
 * points at it; there is no upload here and no copy that goes stale (`AGENTS.md` §17).
 *
 * This file is the one place that decides what a stored row means, so the page, the preview,
 * the editor and the emails cannot disagree about it — the same role `co-hosts.ts` plays for the
 * partners. Imports nothing but Zod, so a client island can read the kinds without pulling a
 * database or a catalogue in with them.
 */

/**
 * What a link is, as a closed set, so the page can say it in the reader's language without the
 * club typing a word: a GPX track, a map or a route on a platform, a document, an album, results,
 * or something else. A seventh is a code change with a decision behind it, not free text.
 */
export const EVENT_LINK_KINDS = ["GPX", "MAP", "DOCUMENT", "PHOTOS", "RESULTS", "OTHER"] as const;
export type EventLinkKind = (typeof EVENT_LINK_KINDS)[number];

/** Twelve: more than a race has ever needed to hand out, few enough to read on a phone. */
export const MAX_EVENT_LINKS = 12;
/** The longest address accepted — longer than any share link Drive, Dropbox or OneDrive makes. */
export const MAX_EVENT_LINK_URL = 2048;
/** A label is a few words on one line, not a paragraph. */
export const MAX_EVENT_LINK_LABEL = 80;

/**
 * What a new row starts as, and what an unknown stored kind is read as. "Other", not "GPX": a
 * kind nobody chose must not make the page call a PDF "the route (GPX)" — a generic word beside
 * the host is plain, a wrong one is misleading.
 */
export const DEFAULT_EVENT_LINK_KIND: EventLinkKind = "OTHER";

export const isEventLinkKind = (value: string): value is EventLinkKind => (EVENT_LINK_KINDS as readonly string[]).includes(value);

/**
 * https, and nothing else, like every other link an organizer pastes (`map_url`, `route_url`):
 * the page renders it as a link a visitor clicks, and a stored `javascript:` is a script that
 * runs on the club's own page. Any host — Google Drive, Dropbox, OneDrive, Strava, Garmin.
 */
export const isEventLinkUrl = (value: string) => /^https:\/\/\S+$/i.test(value) && value.length <= MAX_EVENT_LINK_URL;

/**
 * The scheme written in lower case, so a pasted "HTTPS://…" satisfies the database's own check,
 * which reads the stored text as it is.
 */
export const normalizeEventLinkUrl = (value: string) => value.replace(/^https:\/\//i, "https://");

export type EventLink = {
  kind: EventLinkKind;
  url: string;
  /** The club's own words for it in each language, or null for the kind's default in that language. */
  labelRo: string | null;
  labelEn: string | null;
};

const optionalLabel = z
  .string()
  .trim()
  .max(MAX_EVENT_LINK_LABEL)
  .nullable()
  .optional()
  .transform((value) => (value ? value : null))
  .catch(null);

/**
 * A stored link, read leniently on purpose — the discipline `coHostSchema` follows (§169).
 *
 * Not `.strict()`: a key a later release adds is stripped, never a reason to drop the link. A
 * kind this release does not know reads as "other" rather than taking the link down, and a label
 * that cannot be read falls back to the kind's word. Only the address is required: a link
 * without an https address is nothing to render, so that row is dropped.
 */
const storedLinkSchema = z.object({
  kind: z
    .string()
    .refine(isEventLinkKind)
    .catch(DEFAULT_EVENT_LINK_KIND)
    .transform((value) => value as EventLinkKind),
  url: z.string().trim().refine(isEventLinkUrl),
  labelRo: optionalLabel,
  labelEn: optionalLabel,
});

/**
 * The event's links, in the order the club listed them, at most twelve. Anything that is not an
 * array is "no links" — null is every row saved before the column existed — and an entry that
 * cannot be a link is dropped rather than rendered, the rule `readCoHosts` and
 * `readScheduleItems` follow.
 */
export function readEventLinks(value: unknown): EventLink[] {
  if (!Array.isArray(value)) return [];
  return value
    .flatMap((entry) => {
      const parsed = storedLinkSchema.safeParse(entry);
      return parsed.success ? [parsed.data] : [];
    })
    .slice(0, MAX_EVENT_LINKS);
}

/**
 * The label the club wrote in this language, or null — and then the caller shows the kind's own
 * word in the reader's language ("Traseul (GPX)" / "Route (GPX)"), so a link needs no
 * translation to be published. Never the other language's label: an English page does not show
 * Romanian the club typed for the Romanian one (BR-REQ-040-02's rule for every other word).
 *
 * **Both or neither** (§354, bilingual everywhere — `coHostDescription`'s rule for a label): the
 * save refuses a label in one language only, and a row stored before that rule, with a label in
 * one language, answers null in **both**, so both pages show the kind's own word rather than the
 * club's label on one page and the default on the other. The editor reads `labelRo`/`labelEn`
 * themselves, so the half is still there to be completed.
 */
export function eventLinkLabel(link: Pick<EventLink, "labelRo" | "labelEn">, locale: "ro" | "en"): string | null {
  if (!link.labelRo || !link.labelEn) return null;
  return locale === "ro" ? link.labelRo : link.labelEn;
}

/** A row the next save will refuse: a label of the club's in one language and not the other (§354). */
export const hasOneLanguageLabel = (link: Pick<EventLink, "labelRo" | "labelEn">): boolean => !link.labelRo !== !link.labelEn;

/**
 * Where the link goes, as the host a runner recognises — "drive.google.com", "dropbox.com" —
 * shown in small text under the label so nobody is surprised by the page that opens. The
 * leading `www.` is dropped: it says nothing. Null when the address cannot be parsed, which a
 * stored https link never is.
 */
export function eventLinkHost(url: string): string | null {
  try {
    const host = new URL(url).hostname.toLowerCase();
    if (!host) return null;
    return host.startsWith("www.") ? host.slice(4) : host;
  } catch {
    return null;
  }
}
