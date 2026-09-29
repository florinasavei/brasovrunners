import { and, count, desc, eq, isNotNull, isNull, or, type SQL, sql } from "drizzle-orm";
import { emailOutbox } from "@/db/schema/email-outbox";
import { newsletterSubscribers, newsletterTokens } from "@/db/schema/newsletter";
import type { Database } from "@/db/types";
import type { Locale } from "@/i18n/routing";
import { canonicalizeEmail } from "@/modules/participants/domain/canonical-email";
import { type ConfirmLinkState, confirmLinkState, type SubscriberListQuery, SUBSCRIBER_TABLE_LIMIT } from "./domain/subscriber-list";
import { normalizeTopics, type OfferedTopic } from "./domain/topics";

/**
 * The newsletter's subscribers as the backoffice reads them (§550, amending §445; the owner,
 * 2026-09-28: «în newsletter vreau să și văd abonații și mailurile lor»). §445 showed numbers only;
 * the club now sees who, because a list it keeps and writes to is a list it must be able to answer
 * for — "am I on it?", "take me off", "how many really confirmed".
 *
 * Read by whoever may send (`canSendNewsletter`): the page asserts it, and so does the CSV route. Only
 * reads here; the one verb, the unsubscribe, is `unsubscribeNewsletterSubscriber` in `service.ts`, beside
 * the subscriber's own, so the two cannot drift apart.
 *
 * **The search is by address, through the canonicalizer** (AGENTS.md §10.4, §74): a whole address is
 * canonicalized and matched on `canonical_email` — `Ana.Pop+club@GoogleMail.com` finds the row of
 * `ana.pop@gmail.com` — never compared as typed. It is also a case-blind "contains" over both the
 * address as typed and its canonical form, as a fragment (`ana`, `@yahoo`) is, because a well-formed
 * part of an address (`pop@gmail.co`) is still a part: a way to find a row, never an identity decision.
 */

export type NewsletterSubscriberRow = {
  id: string;
  /** As typed, where the messages go (`delivery_email`). */
  email: string;
  locale: Locale;
  topics: OfferedTopic[];
  createdAt: Date;
  confirmedAt: Date | null;
  link: ConfirmLinkState;
};

export type NewsletterSubscriberList = {
  rows: NewsletterSubscriberRow[];
  /** Under the filter, the whole of it — not only the rows drawn. */
  confirmed: number;
  pending: number;
  /** More rows match than the table draws (`SUBSCRIBER_TABLE_LIMIT`): the CSV has them all. */
  truncated: boolean;
};

/** `%`, `_` and `\` literal before the term becomes a `LIKE` pattern (the registrations list's rule). */
function escapeLike(term: string): string {
  return term.replace(/[\\%_]/g, (character) => `\\${character}`);
}

function searchCondition(q: string): SQL | undefined {
  if (q === "") return undefined;
  const pattern = `%${escapeLike(q.toLowerCase())}%`;
  const contains = sql`(lower(${newsletterSubscribers.deliveryEmail}) LIKE ${pattern} ESCAPE '\\' OR ${newsletterSubscribers.canonicalEmail} LIKE ${pattern} ESCAPE '\\')`;
  if (!q.includes("@")) return contains;
  let canonical: string;
  try {
    canonical = canonicalizeEmail(q).canonicalEmail;
  } catch {
    // Not a whole address: a fragment, the "contains" alone.
    return contains;
  }
  // A whole address finds its identity; the "contains" keeps a well-formed part of a longer one findable.
  return or(eq(newsletterSubscribers.canonicalEmail, canonical), contains);
}

/**
 * A topic as the list filters it: «Toate noutățile» is who asked for everything; any other topic is
 * who receives it — its own subscribers and everything's (`receives`, `domain/topics.ts`), the
 * audience a letter on it would reach.
 */
function topicCondition(topic: OfferedTopic | null): SQL | undefined {
  if (topic === null) return undefined;
  if (topic === "ALL") return sql`'ALL' = ANY(${newsletterSubscribers.topics})`;
  return sql`${newsletterSubscribers.topics} && ARRAY['ALL', ${topic}]::newsletter_topic[]`;
}

function filterOf(query: Pick<SubscriberListQuery, "q" | "topic">): SQL | undefined {
  return and(searchCondition(query.q), topicCondition(query.topic));
}

function stateCondition(state: SubscriberListQuery["state"]): SQL | undefined {
  if (state === "confirmed") return isNotNull(newsletterSubscribers.confirmedAt);
  if (state === "pending") return isNull(newsletterSubscribers.confirmedAt);
  return undefined;
}

/** The row's own columns, the table's and the CSV's alike. */
const SUBSCRIBER_COLUMNS = {
  id: newsletterSubscribers.id,
  email: newsletterSubscribers.deliveryEmail,
  locale: newsletterSubscribers.locale,
  topics: newsletterSubscribers.topics,
  createdAt: newsletterSubscribers.createdAt,
  confirmedAt: newsletterSubscribers.confirmedAt,
};

const NEWEST_FIRST = [desc(newsletterSubscribers.createdAt), desc(newsletterSubscribers.id)] as const;

/**
 * The subscribers under the filter, newest first, with the counts the card's line says. The state
 * filter narrows the counts too: «confirmed» counts no pending address, so the line and the table
 * never disagree.
 */
export async function listNewsletterSubscribers<T extends Record<string, unknown>>(
  db: Database<T>,
  query: SubscriberListQuery,
  now: Date,
  limit: number = SUBSCRIBER_TABLE_LIMIT,
): Promise<NewsletterSubscriberList> {
  const where = and(filterOf(query), stateCondition(query.state));
  const [totals] = await db
    .select({
      confirmed: count(sql`CASE WHEN ${newsletterSubscribers.confirmedAt} IS NOT NULL THEN 1 END`),
      pending: count(sql`CASE WHEN ${newsletterSubscribers.confirmedAt} IS NULL THEN 1 END`),
    })
    .from(newsletterSubscribers)
    .where(where);

  /*
    Two correlated subqueries, written with their own aliases and the outer row named in full: a
    one-table select renders its columns unqualified ("id"), which inside a subquery would mean the
    subquery's own table. Each sits in a CASE on the row's own confirmation, so a confirmed row —
    most of the list — runs neither: its state is «Confirmat» whatever the tokens and the outbox say.
    The expiry comes back as epoch milliseconds, because a raw expression's timestamp arrives in the
    driver's text form, which `Date` does not read alike on every engine.
  */
  const pendingRow = sql`"newsletter_subscribers"."confirmed_at" IS NULL`;
  const liveConfirmUntil = sql<Date | null>`CASE WHEN ${pendingRow} THEN (
      SELECT floor(extract(epoch FROM max(t.expires_at)) * 1000) FROM ${newsletterTokens} t
       WHERE t.subscriber_id = "newsletter_subscribers"."id"
         AND t.purpose = 'CONFIRM' AND t.used_at IS NULL AND t.invalidated_at IS NULL
    ) END`.mapWith((value: unknown) => (value === null || value === undefined ? null : new Date(Number(value))));
  const confirmationQueued = sql<boolean>`CASE WHEN ${pendingRow} THEN EXISTS (
      SELECT 1 FROM ${emailOutbox} o
       WHERE o.message_type = 'NEWSLETTER_CONFIRM' AND o.status IN ('PENDING', 'PROCESSING')
         AND o.payload_json->>'subscriberId' = "newsletter_subscribers"."id"::text
    ) ELSE false END`.mapWith((value: unknown) => value === true || value === "t" || value === "true");

  const rows = await db
    .select({ ...SUBSCRIBER_COLUMNS, liveConfirmUntil, confirmationQueued })
    .from(newsletterSubscribers)
    .where(where)
    .orderBy(...NEWEST_FIRST)
    .limit(limit + 1);

  const confirmed = totals?.confirmed ?? 0;
  const pending = totals?.pending ?? 0;
  return {
    rows: rows.slice(0, limit).map((row) => ({
      ...ownColumns(row),
      link: confirmLinkState({ confirmedAt: row.confirmedAt, liveConfirmUntil: row.liveConfirmUntil, confirmationQueued: row.confirmationQueued }, now),
    })),
    confirmed,
    pending,
    truncated: rows.length > limit,
  };
}

/** A subscriber as the CSV writes one: the row's own columns, no link state (the file says «Confirmat» or «În așteptare» alone). */
export type NewsletterSubscriberExportRow = Omit<NewsletterSubscriberRow, "link">;

/**
 * Every subscriber under the filter for «Descarcă CSV», newest first, up to `limit`. The table's
 * read without its two subqueries: the file has no link-state column, and it asks for the whole
 * list, so it reads the subscribers table alone.
 */
export async function exportNewsletterSubscribers<T extends Record<string, unknown>>(
  db: Database<T>,
  query: SubscriberListQuery,
  limit: number,
): Promise<NewsletterSubscriberExportRow[]> {
  const rows = await db
    .select(SUBSCRIBER_COLUMNS)
    .from(newsletterSubscribers)
    .where(and(filterOf(query), stateCondition(query.state)))
    .orderBy(...NEWEST_FIRST)
    .limit(limit);
  return rows.map(ownColumns);
}

function ownColumns(row: { id: string; email: string; locale: string; topics: readonly string[] | null; createdAt: Date; confirmedAt: Date | null }): NewsletterSubscriberExportRow {
  return {
    id: row.id,
    email: row.email,
    locale: row.locale as Locale,
    topics: normalizeTopics(row.topics ?? []),
    createdAt: row.createdAt,
    confirmedAt: row.confirmedAt,
  };
}
