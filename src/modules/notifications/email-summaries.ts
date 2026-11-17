import { and, asc, inArray, lte, not, type SQL, sql } from "drizzle-orm";
import { type EmailMessageType, emailOutbox } from "@/db/schema/email-outbox";
import type { Database } from "@/db/types";
import type { StaffSubject } from "@/modules/staff-identity/domain/roles";
import { isUuid } from "@/shared/ids";
import { type EmailOutcome, emailOutcomeOf } from "./domain/email-outcome";
import { assertMayReadEmailHistory, CLUB_SIDE_OF_ROW } from "./email-history";
import { VOLUNTEER_ID_OF_ROW } from "./journal";

/**
 * The lists' «Emailuri» column (§NNN; the owner, 2026-11-17, the morning after the volunteers were emailed their
 * points: «Vreau sa vad mai clar ce mailuri a primit fiecare om»): for a page of registrations or of volunteers, each
 * person's newest emails in three facts — which email, when it left, what became of it — and how many they have in
 * all. The person's own «Emailuri» fold (`email-history.ts`, §915) stays the whole story, with the tries and who
 * caused each; this is its newest three, a line each — newest by the moment the line shows — and its count, read for a
 * page of people at once.
 *
 * **Who reads it.** The Administrator and the Superadministrator alone — the fold's own assertion
 * (`assertMayReadEmailHistory`, BR-REQ-060-01), asked here before anything is read: every other role is refused with
 * FORBIDDEN, never handed an empty map that reads as «nobody got anything».
 *
 * **What is read, and what never is** — the fold's rule, narrower: the type, the state, when it was queued and when it
 * left, how many it reached and whether the recipient's server took it (`delivered_at`). Of the payload only what
 * names the row: the volunteer's id it carries and the club-copy flag — never its words. Never an address, a body, a
 * link, `last_error`, the provider's code or words, who pressed. The club's own rows — a copy, the declaration's
 * archive, a notice to the club's people (`isClubSide`, as SQL `CLUB_SIDE_OF_ROW`) — are neither counted nor drawn,
 * exactly as the fold counts a person's own.
 *
 * **One query a page**, and none for no ids: the three newest and the count of each person are computed in the query
 * (`row_number()` and `count(*)` over the person), so the answer is at most `EMAIL_SUMMARY_LINES` rows a person —
 * a person with a thousand emails costs three rows. Registrations are found by `registration_id`
 * (`email_outbox_registration_created_idx`); volunteers by the id their payload names (`VOLUNTEER_ID_OF_ROW`, the
 * journal's own expression), which no index holds — the outbox is read through once a page, as a volunteer's fold
 * reads it once a person (§915: no migration while the outbox is small). At most `EMAIL_SUMMARY_PEOPLE_MAX` people
 * are asked about in one call: a list's largest page is half of it, so a caller that passes more is not a page.
 *
 * It only reads: no write, no cache tag, nothing remembered between requests.
 */

/** The newest emails drawn for each person; the rest are counted and are on the person's page. */
export const EMAIL_SUMMARY_LINES = 3;

/**
 * The most people one call answers for: twice the lists' largest page (`PER_PAGE_OPTIONS`, 100). Ids past it are not
 * read and get no entry — so a page can never make the query, or its answer of three rows a person, unbounded.
 */
export const EMAIL_SUMMARY_PEOPLE_MAX = 200;

export type EmailSummarySubject = { registrationIds: readonly string[] } | { volunteerIds: readonly string[] };

/** One of a person's emails in a line: which, when, what became of it. Nothing of its words, nobody's address. */
export type EmailSummaryLine = {
  id: string;
  messageType: EmailMessageType;
  /** When it left (`sent_at`) or, while it has not, when it was queued. */
  at: Date;
  /** The fold's own judgement (`domain/email-outcome.ts`). */
  outcome: EmailOutcome;
};

export type EmailSummary = {
  /** The person's own emails in all — the club's rows never counted. */
  total: number;
  /** The newest `EMAIL_SUMMARY_LINES` of them, newest first — by `at`, the moment each line shows. */
  lines: EmailSummaryLine[];
};

/**
 * Each person's emails in short, by id — for the Administrator and the Superadministrator; anybody else is refused
 * (FORBIDDEN). Every well-formed id asked about has an entry, `{ total: 0, lines: [] }` for a person with no email; a
 * malformed id is dropped before the query and has none, and neither has an id past `EMAIL_SUMMARY_PEOPLE_MAX`. The
 * keys are the ids in lower case, as PostgreSQL writes a uuid. It takes no clock, unlike the fold's reader: a line's
 * moment is the row's own, and nothing it answers depends on the hour it is asked.
 */
export async function readEmailSummaries<T extends Record<string, unknown>>(
  db: Database<T>,
  actor: StaffSubject,
  subject: EmailSummarySubject,
): Promise<Map<string, EmailSummary>> {
  assertMayReadEmailHistory(actor);
  const ofRegistrations = "registrationIds" in subject;
  const asked = ofRegistrations ? subject.registrationIds : subject.volunteerIds;
  // Only what is shaped like a uuid reaches PostgreSQL, each id once, and no more people than a page holds.
  const ids = [...new Set(asked.filter(isUuid).map((id) => id.toLowerCase()))].slice(0, EMAIL_SUMMARY_PEOPLE_MAX);
  const summaries = new Map<string, EmailSummary>(ids.map((id) => [id, { total: 0, lines: [] }]));
  if (ids.length === 0) return summaries;

  // Whose row it is, as text: the registration it belongs to, or the volunteer its payload names (the journal's expression).
  const person: SQL = ofRegistrations ? sql`${emailOutbox.registrationId}::text` : sql`(${VOLUNTEER_ID_OF_ROW})`;
  // The moment a line shows — when it left or, while it has not, when it was queued — is the moment the lines are ordered
  // by, so the hours of a cell never run backwards: an email held back and sent after a later one stands above it. (The
  // fold is ordered by the queueing its rows show first: the same emails, each screen by the moment it shows.)
  const moment = sql`coalesce(${emailOutbox.sentAt}, ${emailOutbox.createdAt})`;
  const ranked = db
    .select({
      id: emailOutbox.id,
      personId: sql<string>`${person}`.as("person_id"),
      messageType: emailOutbox.messageType,
      status: emailOutbox.status,
      createdAt: emailOutbox.createdAt,
      sentAt: emailOutbox.sentAt,
      recipientCount: emailOutbox.recipientCount,
      deliveredAt: emailOutbox.deliveredAt,
      // Each row's place among its person's, newest moment first, and the person's count, the rows past the third included.
      position: sql<number>`(row_number() over (partition by ${person} order by ${moment} desc, ${emailOutbox.id} desc))::int`.as("position"),
      total: sql<number>`(count(*) over (partition by ${person}))::int`.as("total"),
    })
    .from(emailOutbox)
    .where(and(ofRegistrations ? inArray(emailOutbox.registrationId, ids) : inArray(person, ids), not(CLUB_SIDE_OF_ROW)))
    .as("person_emails");
  const rows = await db
    .select()
    .from(ranked)
    .where(lte(ranked.position, EMAIL_SUMMARY_LINES))
    .orderBy(asc(ranked.personId), asc(ranked.position));

  for (const row of rows) {
    const summary = summaries.get(row.personId);
    // A row of somebody not asked about cannot come back; the guard is for the type's sake.
    if (!summary) continue;
    summary.total = row.total;
    summary.lines.push({
      id: row.id,
      messageType: row.messageType,
      at: row.sentAt ?? row.createdAt,
      outcome: emailOutcomeOf({ status: row.status, recipientCount: row.recipientCount, deliveredAt: row.deliveredAt }),
    });
  }
  return summaries;
}
