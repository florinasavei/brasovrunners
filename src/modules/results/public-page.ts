import type { Deadlines } from "@/modules/deadlines/domain/deadlines";
import {
  cachedDeadlines,
  cachedFirstResultsNoticeVersion,
  cachedPublicEventResults,
  cachedResultsDescribed,
  cachedResultsTermsDescribed,
} from "@/modules/public-cache/reads";
import { holdPageUntil } from "@/modules/public-cache/page-lifetime";
import { eventTakesResults } from "./domain/event-type";
import { resultsClockInstants, resultsOnShow, type ResultsOpenEvent } from "./domain/results-open";
import { canEnterResults, type StaffRole } from "@/modules/staff-identity/domain/roles";
import type { PublicEventResults } from "./results";

/**
 * What the public pages ask of the results (§809, race results part 2): the event page's «Clasament» section and the listing's
 * «Clasament» chip, from the one place, so the two cannot disagree about whether a race's results are on show.
 *
 * Everything here is a cached read (`public-cache/reads.ts`) — the club's period, the two notices' verdicts, the version below
 * which nobody is named, and the rows themselves — and **nothing is read for an event that cannot have results**: a page or a
 * listing with no published race asks nobody, so the pages that are not a race's cost what they cost before this existed.
 */

/** The four inputs of the rule that are not on the event's row. */
export type ResultsGates = {
  deadlines: Pick<Deadlines, "publicListDays">;
  noticeDescribes: boolean;
  termsDescribe: boolean;
  firstResultsNoticeVersion: number | null;
};

/** An event the results *might* be on show for: a race the Administrator published, with a date. The rest ask nobody. */
function couldShowResults(event: ResultsOpenEvent): boolean {
  return event.resultsPublished && eventTakesResults(event.type) && event.startsAt !== null;
}

/**
 * The inputs, read through the public cache (one read each, asked once per request however many cards or sections need them):
 * "Termene", the privacy notice's verdict, the terms' verdict, and — only when both describe the results — the first notice that did.
 */
export async function readResultsGates(now: Date): Promise<ResultsGates> {
  const [deadlines, noticeDescribes, termsDescribe] = await Promise.all([cachedDeadlines(), cachedResultsDescribed(now), cachedResultsTermsDescribed(now)]);
  const firstResultsNoticeVersion = noticeDescribes && termsDescribe ? await cachedFirstResultsNoticeVersion() : null;
  return { deadlines, noticeDescribes, termsDescribe, firstResultsNoticeVersion };
}

/**
 * The ids, among `events`, whose «Clasament» chip the listing draws (build item 3): published, started, inside the period, the
 * notice and the terms describing them — the very rule the section applies (`resultsOnShow`), over the rows the listing already holds,
 * with the gates read **once** for the page and no query per card. The page is held until the first instant any candidate changes by
 * the clock alone (a race starting, a period ending), so a static copy never keeps a chip past its section.
 */
export async function eventsWithResultsChip(events: readonly (ResultsOpenEvent & { id: string })[], now: Date): Promise<ReadonlySet<string>> {
  const candidates = events.filter(couldShowResults);
  if (candidates.length === 0) return new Set();
  const gates = await readResultsGates(now);
  await holdPageUntil(
    candidates.flatMap((event) => resultsClockInstants(event, gates.deadlines)),
    now,
  );
  return new Set(candidates.filter((event) => resultsOnShow(event, now, gates.deadlines, gates)).map((event) => event.id));
}

/**
 * One event's results for its page: the rows `readPublicEventResults` answers (cached), or `null` — and null is the whole answer:
 * no section, no heading, no «în curând». The page is held until the race starts and until the period ends. The period is checked
 * here against the request's own `now` as well, because the cached rows were made at an earlier request (a date passing is no write).
 */
export async function readEventResultsForPage(event: ResultsOpenEvent & { id: string }, now: Date): Promise<PublicEventResults | null> {
  if (!couldShowResults(event)) return null;
  const gates = await readResultsGates(now);
  await holdPageUntil(resultsClockInstants(event, gates.deadlines), now);
  if (!resultsOnShow(event, now, gates.deadlines, gates)) return null;
  const results = await cachedPublicEventResults(event.id, gates);
  if (!results || now.getTime() > results.closesAt.getTime()) return null;
  return results;
}

/**
 * `PageTodoContext.resultsRow` (§809): whether the editor's «Cursa s-a terminat și clasamentul nu e publicat» row is for this
 * viewer — they may open the results page, and the notice and the terms in force describe `{{results}}`, so the Administrator's
 * publish would be accepted. Cached verdicts, the same ones the public page reads.
 */
export async function resultsRowFor(role: StaffRole, now: Date): Promise<boolean> {
  if (!canEnterResults(role)) return false;
  const [noticeDescribes, termsDescribe] = await Promise.all([cachedResultsDescribed(now), cachedResultsTermsDescribed(now)]);
  return noticeDescribes && termsDescribe;
}
