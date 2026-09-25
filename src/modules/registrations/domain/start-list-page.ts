/**
 * Which rows of the public start list one page shows (`DECISIONS.md` §250; the owner: "I want
 * the participants table to be a real table! with pagination").
 *
 * Pure arithmetic, and it earns its own file because two kinds of row share one sequence: the
 * runners who are named, in the order they confirmed, and then one line per runner who asked to
 * be left off (§186) — counted, never named. The page has to know how many of each it holds, or
 * a list of four hundred would fetch four hundred rows to show fifty.
 *
 * The anonymous lines come last, as they do today, so a named runner never moves page when
 * somebody else opts out.
 */

/** Fifty names is a screen's worth on a phone and two round trips fewer than twenty-five. */
export const START_LIST_PAGE_SIZE = 50;

export type StartListPage = {
  /** Which page this is, clamped into range; the first is 1. */
  page: number;
  pages: number;
  /** What to ask the database for: the named rows this page shows. */
  namedOffset: number;
  namedLimit: number;
  /** How many "left off the list" lines this page shows, after the named ones. */
  anonymousOnPage: number;
  /**
   * What to ask the database for from the rows after the confirmed ones — the pending and the
   * waiting list, shown only behind the privacy notice's gate (§NNN). Zero wherever the caller
   * passed none.
   */
  othersOffset: number;
  othersLimit: number;
  /** The number to print beside the first row of this page. */
  firstPosition: number;
  /** Every confirmed runner, named or not — the count the heading and the summary line read. */
  confirmed: number;
  /** Every row of the list, the pending and waiting ones included. */
  total: number;
};

/**
 * `others` (§NNN) is the pending and waiting rows, which follow every confirmed one — named and
 * anonymous — so a confirmed runner never changes page when somebody joins the waiting list, as a
 * named one never does when somebody opts out (§250).
 */
export function startListPage(
  named: number,
  anonymous: number,
  requestedPage: unknown,
  perPage: number = START_LIST_PAGE_SIZE,
  others: number = 0,
): StartListPage {
  const confirmed = named + anonymous;
  const total = confirmed + others;
  const pages = Math.max(1, Math.ceil(total / perPage));
  // Anything that is not a page number is page one: a query string is typed by anybody.
  const asked = typeof requestedPage === "number" ? requestedPage : Number.parseInt(String(requestedPage ?? ""), 10);
  const page = Number.isFinite(asked) ? Math.min(Math.max(Math.trunc(asked), 1), pages) : 1;

  const from = (page - 1) * perPage;
  const namedOffset = Math.min(from, named);
  const namedLimit = Math.max(0, Math.min(perPage, named - from));
  // Whatever room the named rows left, filled from the anonymous ones this page has reached.
  const anonymousBefore = Math.max(0, from - named);
  const anonymousOnPage = Math.max(0, Math.min(perPage - namedLimit, anonymous - anonymousBefore));
  // And whatever room is left after both, from the rows after the confirmed ones.
  const othersOffset = Math.max(0, from - confirmed);
  const othersLimit = Math.max(0, Math.min(perPage - namedLimit - anonymousOnPage, others - othersOffset));

  return { page, pages, namedOffset, namedLimit, anonymousOnPage, othersOffset, othersLimit, firstPosition: from + 1, confirmed, total };
}
