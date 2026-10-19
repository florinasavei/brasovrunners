import { z } from "zod";

/**
 * «Cui îi trimitem întrebarea „Vii?"» (§823; the owner, 2026-10-19: «I need to set how these emails are sent») — WHO the day-before
 * question (§818) is asked of, pure. One club setting with three answers, a choice and never a pair of switches:
 *
 *   - `SUBSCRIBERS` — **the default, and what the platform did until the club could choose**: the confirmed newsletter subscribers
 *     who ticked the topic «Întrebarea «Vii?» înaintea alergărilor» (or «Toate noutățile»), under a notice that names the question.
 *   - `ANSWERERS` — the people who answered «Vin!» (and were counted) at an earlier date of the SAME series. The address was given to
 *     count a person at a run, and asking it again about the next date of that run is a new use of it: so this answer is gated by its
 *     own words in the privacy notice (`{{rsvpAskAnswerers}}`, `legal-documents/domain/merge-fields.ts#describesRsvpAskAnswerers`)
 *     and is refusable for good, per series («Nu mă mai întreba la seria aceasta», `rsvp/ask-refusal.ts`). Off until the club chooses it.
 *   - `BOTH` — the two lists, one email each person: a person on both is asked as a subscriber, whose way out is their own topic page.
 *
 * Pure: no database, no environment. The setting's storage is `ask-audience.ts`.
 */
export const RSVP_ASK_AUDIENCES = ["SUBSCRIBERS", "ANSWERERS", "BOTH"] as const;

export type RsvpAskAudience = (typeof RSVP_ASK_AUDIENCES)[number];

/** Subscribers only: today's behaviour, and the safer default — the answerers' audience needs the club's choice AND the notice. */
export const DEFAULT_RSVP_ASK_AUDIENCE: RsvpAskAudience = "SUBSCRIBERS";

export const rsvpAskAudienceSchema = z.object({ audience: z.enum(RSVP_ASK_AUDIENCES) }).strict();

export type RsvpAskAudienceSetting = z.infer<typeof rsvpAskAudienceSchema>;

/** Whether the question goes to the newsletter's subscribers of the topic. */
export function asksSubscribers(audience: RsvpAskAudience): boolean {
  return audience === "SUBSCRIBERS" || audience === "BOTH";
}

/** Whether the question goes to the people who answered «Vin!» at an earlier date of the series. */
export function asksAnswerers(audience: RsvpAskAudience): boolean {
  return audience === "ANSWERERS" || audience === "BOTH";
}

/** A stored value read leniently: one this code cannot read is the default — never a failed send, never a wider audience. */
export function readRsvpAskAudience(value: unknown): RsvpAskAudience {
  const parsed = rsvpAskAudienceSchema.safeParse(value);
  return parsed.success ? parsed.data.audience : DEFAULT_RSVP_ASK_AUDIENCE;
}

/** Whoever the question can be asked of, by the identity the platform compares addresses by (AGENTS.md §10.4). */
export type AskRecipient = { canonicalEmail: string };

/**
 * Who is asked, pure: the two lists as the queue reads them (`rsvp/ask.ts#queueRsvpAsks`), as people with a canonical address, narrowed by
 * the audience. The union by canonical address — **one email per person**: a person on both lists is a subscriber — less every address
 * that refused the series (the refusal holds for both lists: «niciodată» means never) and every address that already answered this event.
 * The caller has done the notice's version rule on each list; this is the arithmetic `tests/unit/rsvp/ask-audience.test.ts` pins.
 *
 * Order is the subscribers' first, then the answerers', each in the order given: the queue's order is the outbox's order.
 */
export function mergeAskRecipients<S extends AskRecipient, A extends AskRecipient>(params: {
  audience: RsvpAskAudience;
  subscribers: readonly S[];
  answerers: readonly A[];
  refused: ReadonlySet<string>;
  answered: ReadonlySet<string>;
}): { subscribers: S[]; answerers: A[] } {
  const taken = new Set<string>();
  const keep = (canonicalEmail: string): boolean => {
    if (params.refused.has(canonicalEmail) || params.answered.has(canonicalEmail) || taken.has(canonicalEmail)) return false;
    taken.add(canonicalEmail);
    return true;
  };
  const subscribers = asksSubscribers(params.audience) ? params.subscribers.filter((row) => keep(row.canonicalEmail)) : [];
  const answerers = asksAnswerers(params.audience) ? params.answerers.filter((row) => keep(row.canonicalEmail)) : [];
  return { subscribers, answerers };
}
