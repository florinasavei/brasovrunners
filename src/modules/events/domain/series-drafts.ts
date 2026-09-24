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
 *   date is a draft until somebody publishes it. The remedy is the rule's own switch, in the
 *   source's editor — and that switch is only there to try once the source is live.
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
): { drafts: M[]; reason: DraftReason | null } {
  const ahead = members
    .filter((member) => member.editorialStatus === "DRAFT" && member.startsAt.getTime() >= now.getTime())
    .sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
  if (ahead.length === 0) return { drafts: [], reason: null };

  let reason: DraftReason | null = null;
  for (const member of members) {
    const rule = readRepeatRule(member.repeatRule);
    if (!rule) continue;
    if (member.editorialStatus !== "PUBLISHED") reason = "sourceNotPublished";
    else if (!rule.publish) reason = "autoPublishOff";
    break;
  }

  return { drafts: ahead, reason };
}

/**
 * The explanation behind the draft line's "?", from the sentences the page translated: what a
 * draft date is and how to publish it, always; why this series makes them, only when the list
 * can name the reason. Joined by a line break, which the tooltip keeps (§257).
 */
export function draftExplanation(
  reason: DraftReason | null,
  sentences: { always: string } & Record<DraftReason, string>,
): string {
  return reason ? `${sentences.always}\n${sentences[reason]}` : sentences.always;
}
