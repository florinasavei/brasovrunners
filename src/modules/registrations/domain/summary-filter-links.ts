import type { RegistrationStatus } from "@/db/schema/registrations";
import { buildListHref } from "@/modules/staff-identity/domain/admin-list-query";

/**
 * Where a pill of the registrations list's summary strip leads (§626; the owner, 2026-10-01, on
 * the strip: «Și aceste pilluri trebuie să fie clickable (filtre)»).
 *
 * Every pill is a link to the same page with `status` set — a filter, written in the address like
 * every other filter of that list, so it can be bookmarked and sent. The pill of the status in
 * force links to the page without it (pressing it again clears the filter), and so does the total.
 *
 * ## What travels, and what never does
 *
 * An **allowlist** of the keys that shape the list: the event, the search, the club-member, bounced
 * and offers filters, the sort and the page size. The page's one-shot keys — `saved`, `error`,
 * `cancelled`, `erased`, `failed`, `sent`, `erase`, `marked`, `voided`, `test`, `until`, `stop`,
 * `gmail`, `held` — say what the last press did, and a filter link that carried one would show
 * that message again on a page nobody had pressed anything on (and `erase` would reopen the erase
 * panel). A list of what to drop would need a new row for every flash a screen invents; a list of
 * what to keep cannot go stale that way. The page number is dropped too: a filter lands on the
 * first page of its own list, as `buildListHref` does for every filter.
 *
 * Pure, so the toggle and the allowlist are tested without a page.
 */
export const SUMMARY_KEPT_KEYS = ["eventId", "clubMember", "bounced", "promo", "outside", "q", "sort", "dir", "perPage"] as const;

/** The keys of the page's query a pill reads: the ones it keeps and `status`. */
export type SummaryQuery = Partial<Record<(typeof SUMMARY_KEPT_KEYS)[number] | "status", string | undefined>> &
  Record<string, string | undefined>;

/**
 * The address a pill points at. `status` is the pill's own state, or `null` for the total; the
 * state already in the address (`current.status`) switches off rather than on.
 */
export function summaryPillHref(basePath: string, current: SummaryQuery, status: RegistrationStatus | null): string {
  const kept: Record<string, string | undefined> = {};
  for (const key of SUMMARY_KEPT_KEYS) kept[key] = current[key];
  const next = status !== null && current.status !== status ? status : undefined;
  return buildListHref(basePath, kept, { status: next });
}

/**
 * Where the «În afara locurilor» pill leads (§NNN): the same list with `outside=1`, a filter like the
 * state pills and kept beside whichever state is in force; pressed again, the list without it. The
 * same allowlist as the state pills, so no flash and no page number travel.
 */
export function outsidePillHref(basePath: string, current: SummaryQuery): string {
  const kept: Record<string, string | undefined> = {};
  for (const key of SUMMARY_KEPT_KEYS) kept[key] = current[key];
  return buildListHref(basePath, { ...kept, status: current.status }, { outside: current.outside === "1" ? undefined : "1" });
}
