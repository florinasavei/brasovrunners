import type { EditorialStatus } from "@/modules/staff-identity/domain/roles";
import { readRepeatRule } from "./repeat";

/**
 * The dates of a series that are not on the site because they are drafts, and why the platform
 * made them that way (`DECISIONS.md` §341).
 *
 * The owner, of a series row reading "Publicat · 8 date · Ciornă · 1 date": "ce înseamnă această
 * 1 ciornă?". On QA it was the newest Monday of "Happy Monday": the standing job (§122) had made
 * it as a draft, because the series' rule says `publish: false`, and the row gave no hint that
 * the site was missing that date. `materializeSeries` publishes a new date only when the rule
 * asks for it **and** the source is published; either half missing is a draft nobody asked for
 * by name, so the list names the half:
 *
 * - `sourceNotPublished` — the rule's source (a draft, in review, archived) is not published:
 *   the copies of an unpublished event stay unpublished whatever the rule's own flag says
 *   (§122) — checked first, because a series started from a draft source (the common case: the
 *   new-event form's own "creează ca ciornă") always stores `publish: false` on the rule
 *   regardless of what was ticked, so the flag alone cannot tell the two cases apart.
 * - `autoPublishOff` — the source is published, but the rule's own `publish` is off: every new
 *   date is a draft until somebody publishes it. The remedy is the rule's own switch — and that
 *   switch only takes effect once the source is live.
 * - `null` — no rule among the dates (a hand-made set, §64), or a rule that publishes from a
 *   published source: the drafts were made some other way (by hand, before the switch was on,
 *   or taken back to a draft one by one), and there is no mechanism to name.
 *
 * Only the drafts still ahead, soonest first — the ones the site is missing and the ones there
 * is still something to do about. A past draft (a standing job's date whose day came and went
 * before anyone published it) is left out: the site was never going to show it, there is nothing
 * left to publish, and naming it here would read as an ask nobody can act on. Pure: the columns
 * in, the answer out; the words are the page's.
 */
export type DraftReason = "autoPublishOff" | "sourceNotPublished";

export type SeriesDraftMember = {
  editorialStatus: EditorialStatus;
  startsAt: Date;
  /** The source's rule (§122); null on every other date of the series. */
  repeatRule: unknown;
};

export function seriesDrafts<M extends SeriesDraftMember>(
  members: readonly M[],
  now: Date,
): {
  drafts: M[];
  reason: DraftReason | null;
  /**
   * The date that holds the series' rule — the event the series was started from, which the
   * line's "Publică automat de acum" switches and its "Deschide seria" opens (§NNN). Null for a
   * set of dates with no rule among them.
   */
  source: M | null;
} {
  const source = members.find((member) => readRepeatRule(member.repeatRule) !== null) ?? null;
  const ahead = members
    .filter((member) => member.editorialStatus === "DRAFT" && member.startsAt.getTime() >= now.getTime())
    .sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
  if (ahead.length === 0) return { drafts: [], reason: null, source };

  let reason: DraftReason | null = null;
  const rule = source ? readRepeatRule(source.repeatRule) : null;
  if (source && rule) {
    if (source.editorialStatus !== "PUBLISHED") reason = "sourceNotPublished";
    else if (!rule.publish) reason = "autoPublishOff";
  }

  return { drafts: ahead, reason, source };
}

/**
 * What the draft line offers to do about its drafts, by why they are drafts (§NNN) — before the
 * viewer's role is asked; the page renders a remedy only for a role the server would let use it.
 *
 * The owner, of the line and the paragraphs behind its "?": "ai pus grămadă de text degeaba în
 * tooltip". The line explained *how* to fix it — which box, which tick, which button — instead of
 * carrying the fix. It carries it now:
 *
 * - `autoPublishOff` — **publish** the dates listed, and **switch the rule on** so the dates the
 *   series creates from now on need nothing at all. Two separate presses, because they are two
 *   different things: the switch changes nothing about the dates that already exist.
 * - `sourceNotPublished` — **open the source**, and nothing else: the cause is the event the
 *   series starts from, the switch cannot take effect while it is not published, and publishing
 *   its copies one by one would leave the next date a draft again.
 * - `null` — drafts made by hand: **publish** them.
 */
export type DraftRemedies = { publish: boolean; autoPublish: boolean; openSource: boolean };

export function draftRemedies(reason: DraftReason | null): DraftRemedies {
  if (reason === "autoPublishOff") return { publish: true, autoPublish: true, openSource: false };
  if (reason === "sourceNotPublished") return { publish: false, autoPublish: false, openSource: true };
  return { publish: true, autoPublish: false, openSource: false };
}
