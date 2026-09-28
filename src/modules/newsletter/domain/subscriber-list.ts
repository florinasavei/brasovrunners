import { isNewsletterTopic, type OfferedTopic } from "./topics";

/**
 * «Abonați» on `/admin/newsletter` (§NNN, amending §445; the owner, 2026-09-28 22:48: «în newsletter
 * vreau să și văd abonații și mailurile lor»): what the list's address says, and what each row's
 * state is. Pure, so the page, the CSV route and the tests read one rule.
 *
 * **The list's state is the address** (the registrations list's and the events list's rule, §527):
 * `q` the search, `topic` a topic, `state` confirmed or pending — a plain GET form, bookmarked, kept
 * across the unsubscribe's redirect, and the same filter the CSV button carries.
 */

export const SUBSCRIBER_STATES = ["confirmed", "pending"] as const;
export type SubscriberState = (typeof SUBSCRIBER_STATES)[number];

/** The search box's ceiling: an address is at most 254 characters, a fragment of one far less. */
export const MAX_SUBSCRIBER_QUERY_LENGTH = 254;

/** The rows the table draws at most; the counts and the CSV are always the whole filter. */
export const SUBSCRIBER_TABLE_LIMIT = 500;

export type SubscriberListQuery = { q: string; topic: OfferedTopic | null; state: SubscriberState | null };

const first = (value: string | string[] | undefined): string => (Array.isArray(value) ? (value[0] ?? "") : (value ?? ""));

/** The address's parameters as the list reads them; anything that is not a topic or a state is no filter. */
export function parseSubscriberListQuery(params: Readonly<Record<string, string | string[] | undefined>>): SubscriberListQuery {
  const q = first(params.q).trim().slice(0, MAX_SUBSCRIBER_QUERY_LENGTH);
  const topic = first(params.topic);
  const state = first(params.state);
  return {
    q,
    topic: isNewsletterTopic(topic) ? topic : null,
    state: (SUBSCRIBER_STATES as readonly string[]).includes(state) ? (state as SubscriberState) : null,
  };
}

/** The query back as the address's parameters, only what narrows it — for the CSV button and the redirect back. */
export function subscriberListParams(query: SubscriberListQuery): URLSearchParams {
  const params = new URLSearchParams();
  if (query.q !== "") params.set("q", query.q);
  if (query.topic) params.set("topic", query.topic);
  if (query.state) params.set("state", query.state);
  return params;
}

/** Whether a filter narrows the list: the fold then opens by itself (§336, `inUse`). */
export function subscriberListInUse(query: SubscriberListQuery): boolean {
  return query.q !== "" || query.topic !== null || query.state !== null;
}

/**
 * A row's confirmation link, from `newsletter_tokens` and the outbox (§NNN, the brief's (8)):
 *
 * - `confirmed` — the address confirmed; no link to speak of;
 * - `sending` — the confirmation email is still in the outbox: its link is minted when it leaves
 *   (§14.5), so there is no link yet, and one is on its way (§513: emails leave on the tick);
 * - `live` — a link that still works, until `expiresAt`;
 * - `expired` — no link that works: spent, superseded or past its time. The retention sweep
 *   deletes such an address once its link can no longer work (`jobs/retention.ts`).
 */
export type ConfirmLinkState =
  | { kind: "confirmed" }
  | { kind: "sending" }
  | { kind: "live"; expiresAt: Date }
  | { kind: "expired" };

export function confirmLinkState(
  row: { confirmedAt: Date | null; liveConfirmUntil: Date | null; confirmationQueued: boolean },
  now: Date,
): ConfirmLinkState {
  if (row.confirmedAt !== null) return { kind: "confirmed" };
  if (row.confirmationQueued) return { kind: "sending" };
  if (row.liveConfirmUntil !== null && row.liveConfirmUntil.getTime() > now.getTime()) return { kind: "live", expiresAt: row.liveConfirmUntil };
  return { kind: "expired" };
}
