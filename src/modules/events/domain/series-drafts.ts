import type { EditorialStatus } from "@/modules/staff-identity/domain/roles";
import { readRepeatRule } from "./repeat";

/**
 * The dates of a series that are not on the site because they are drafts, and why the platform
 * made them that way (`DECISIONS.md` §NNN).
 *
 * The owner, of a series row reading "Publicat · 8 date · Ciornă · 1 date": "ce înseamnă această
 * 1 ciornă?". On QA it was the newest Monday of "Happy Monday": the standing job (§122) had made
 * it as a draft, because the series' rule says `publish: false`, and the row gave no hint that
 * the site was missing that date. `materializeSeries` publishes a new date only when the rule
 * asks for it **and** the source is published; either half missing is a draft nobody asked for
 * by name, so the list names the half:
 *
 * - `autoPublishOff` — the rule's `publish` is off: every new date is a draft until somebody
 *   publishes it. The remedy is the rule's own switch, in the source's editor.
 * - `sourceNotPublished` — the rule would publish, but its source is not published (a draft, in
 *   review, archived): the copies of an unpublished event stay unpublished (§122).
 * - `null` — no rule among the dates (a hand-made set, §64), or a rule that publishes from a
 *   published source: the drafts were made some other way (by hand, before the switch was on,
 *   or taken back to a draft one by one), and there is no mechanism to name.
 *
 * The drafts come still-ahead first, soonest first — those are the ones the site is missing —
 * and then the past ones, latest first. Pure: the columns in, the answer out; the words are the
 * page's.
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
  const drafts = members.filter((member) => member.editorialStatus === "DRAFT");
  if (drafts.length === 0) return { drafts: [], reason: null };

  const ahead = drafts.filter((member) => member.startsAt.getTime() >= now.getTime()).sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
  const past = drafts.filter((member) => member.startsAt.getTime() < now.getTime()).sort((a, b) => b.startsAt.getTime() - a.startsAt.getTime());

  let reason: DraftReason | null = null;
  for (const member of members) {
    const rule = readRepeatRule(member.repeatRule);
    if (!rule) continue;
    if (!rule.publish) reason = "autoPublishOff";
    else if (member.editorialStatus !== "PUBLISHED") reason = "sourceNotPublished";
    break;
  }

  return { drafts: [...ahead, ...past], reason };
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
