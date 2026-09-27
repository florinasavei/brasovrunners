import { newsletterTopic, type NewsletterTopic } from "@/db/schema/newsletter";

/**
 * The newsletter's topics (§445), in the order the pop-up lists them — the owner's list, 2026-09-26:
 * "every update, big events (such as the anniversary cross), discount codes, shoe testing, special
 * events, you think of it" — the discount codes retired since (`RETIRED_TOPICS`) — plus new
 * events on the calendar, calls for volunteers and the club's news. `ALL` is "everything", today's topics and any the club adds later.
 *
 * Pure: the form, the service, the pages and the job all read the same rules from here.
 */

/**
 * Topics the club no longer offers (§517; the owner, 2026-09-27: the discount codes are for the
 * club's members only, so the newsletter does not offer them). The value stays in the database's
 * enum — a value is never removed, and an old send's row still names it — but no box, no composer
 * choice and no saved subscription carries it: the migration that retired it stripped it from
 * every stored subscription, and `normalizeTopics` drops it from anything posted.
 */
export const RETIRED_TOPICS = ["DISCOUNTS"] as const satisfies readonly NewsletterTopic[];

type RetiredTopic = (typeof RETIRED_TOPICS)[number];

/** A topic a subscriber may choose today. */
export type OfferedTopic = Exclude<NewsletterTopic, RetiredTopic>;

/** A topic a message may be written for. */
export type SendableTopic = Exclude<OfferedTopic, "ALL">;

export const NEWSLETTER_TOPICS: readonly OfferedTopic[] = newsletterTopic.enumValues.filter(
  (topic): topic is OfferedTopic => !(RETIRED_TOPICS as readonly string[]).includes(topic),
);

/** The topics a message is written for: every one but `ALL`, which is a subscriber's choice, not a subject. */
export const SENDABLE_TOPICS: readonly SendableTopic[] = NEWSLETTER_TOPICS.filter((topic): topic is SendableTopic => topic !== "ALL");

export function isNewsletterTopic(value: unknown): value is OfferedTopic {
  return typeof value === "string" && (NEWSLETTER_TOPICS as readonly string[]).includes(value);
}

export function isSendableTopic(value: unknown): value is SendableTopic {
  return isNewsletterTopic(value) && value !== "ALL";
}

/**
 * The topics as a subscriber chose them, in the catalogue's order, each once. "Everything" ticked
 * is everything, whatever else was ticked beside it: the row then says `ALL` alone, so a topic the
 * club adds next year reaches the person who asked for everything. Anything that is not a topic is
 * dropped — a retired topic too (§517); nothing chosen is an empty list, which the service refuses.
 */
export function normalizeTopics(values: readonly unknown[]): OfferedTopic[] {
  const chosen = new Set(values.filter(isNewsletterTopic));
  if (chosen.has("ALL")) return ["ALL"];
  return NEWSLETTER_TOPICS.filter((topic) => chosen.has(topic));
}

/**
 * Whether a subscriber with these topics receives a send written for those: they asked for
 * everything, or for at least one of the send's topics. The one rule the send, the alert, the
 * counts on `/admin/newsletter` and their SQL twin (`service.ts#receivesSql`) all mean.
 */
export function receives(subscriberTopics: readonly NewsletterTopic[], sendTopics: readonly NewsletterTopic[]): boolean {
  if (subscriberTopics.includes("ALL")) return true;
  return sendTopics.some((topic) => subscriberTopics.includes(topic));
}
