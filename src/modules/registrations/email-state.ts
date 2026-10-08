import { and, eq, notInArray, type SQL, type SQLWrapper, sql } from "drizzle-orm";
import { emailOutbox } from "@/db/schema/email-outbox";
import { events } from "@/db/schema/events";
import { registrations } from "@/db/schema/registrations";
import type { Database } from "@/db/types";
import { participantMessageCondition, rejectionInstantSql } from "@/modules/notifications/delivery-facts";
import {
  deskEmailStateOf,
  type DeskEmailState,
  EMAIL_STATE_NEEDS_ACTION,
  type EmailStateKind,
  emailStateDetailOf,
  emailStateOf,
  type RegistrationEmailState,
  type RegistrationEmailStateDetail,
  STILL_NEEDED_KEYS,
} from "./domain/email-state";

/**
 * The registration's one email state, as SQL (§NNN; the kinds are `domain/email-state.ts`'s). One
 * correlated subquery per registration row — the participant's refused rows, through
 * `email_outbox_participant_idx`, each joined to the registration it was for and that registration's
 * event by their keys — returning one JSON object, so a list of two hundred is two hundred index probes
 * and never a query each. The rule lives here and only here: which refusals are still open, which kind
 * each one is, and which one the registration shows.
 *
 * **Which rows.** A participant's own message (`participantMessageCondition`: their type, their id, not a
 * club copy — the archive copy and the confirmation notice carry the participant's id and are not theirs),
 * refused (`BOUNCED`) or complained about (`COMPLAINED`), for this registration or another one at the same
 * event on the same address (a family, §543) — and every one of them read by the **same** kind and the
 * same openness, the family's against its own registration, so one refusal has one state wherever it
 * shows.
 *
 * **Open.** Nothing once the event has ended (`ends_at`, else the end of its start day in its own time
 * zone): after it nobody has anything to do about its registrations' email, and the history keeps every
 * row. Until then — race day included — `unreachable` always (the address refuses the club's mail: the
 * call list, whatever the message was); `not-sent`, `missing` and `retried` only while the registration
 * the message was for still needs it (`stillNeededMessageTypes`). A refusal answered — a message that
 * carries it delivered later, or for the club's account left later (`resolved_at`) — is closed.
 *
 * **Which one.** The address first (`unreachable`: nothing will arrive), then what never left
 * (`not-sent`), then what is owed to an address that works (`missing`), then what waits (`retried`); within
 * each, the registration's own before a family member's, then the newest refusal.
 */

/** The refused row's own registration and its event, joined by their keys inside the subquery. */
const OWNER = sql.raw('"email_owner"');
const OWNER_EVENT = sql.raw('"email_owner_event"');
/** The kind, computed once per refused row (`lateral`), so the filter, the order and the object read one value. */
const FACT = sql.raw('"email_fact"');

/** The kind of one refused row — null when it is answered — whichever registration reads it. */
function kindSql(): SQL<EmailStateKind | null> {
  return sql<EmailStateKind | null>`(case
    when ${emailOutbox.status} = 'COMPLAINED' then 'unreachable'
    when ${emailOutbox.resolvedAt} is not null then null
    when ${emailOutbox.rejectionCause} = 'account' then 'not-sent'
    when ${emailOutbox.retriedAt} is not null then 'retried'
    when ${emailOutbox.laterDeliveredAt} is not null then 'missing'
    else 'unreachable'
  end)`;
}

/** The instant the reads compare with: the database's `now()`, or the caller's (`countNeedingEmailActionByEvent`). */
const clockSql = (now?: Date): SQL => (now ? sql`${now.toISOString()}::timestamptz` : sql`now()`);

/**
 * When an event has ended (§NNN): its `ends_at`, else the end of its start day in its own time zone —
 * the next midnight there, so a summer-time change that day is the zone's own. `event` is the table or
 * an alias of it.
 */
function eventEndSql(event: SQLWrapper): SQL<Date> {
  return sql<Date>`coalesce(${event}."ends_at", (date_trunc('day', ${event}."starts_at" at time zone ${event}."timezone") + interval '1 day') at time zone ${event}."timezone")`;
}

/** Whether the event has not ended yet (`eventEndSql`), race day included. */
function eventNotEndedSql(event: SQLWrapper, now?: Date): SQL<boolean> {
  return sql<boolean>`${clockSql(now)} < ${eventEndSql(event)}`;
}

/**
 * Whether the registration the refused message was for still needs it (§NNN): its status now, where its
 * event stands (`EVENT_MOMENTS`; an ended event has no state at all, `openRefusalsWhere`), and the message's
 * type, against the list `stillNeededMessageTypes` builds.
 */
function stillNeededSql(now?: Date): SQL<boolean> {
  const keys = sql.join(STILL_NEEDED_KEYS.map((key) => sql`${key}`), sql`, `);
  const ahead = sql`${OWNER_EVENT}."starts_at" > ${clockSql(now)}`;
  const moment = sql`(case
    when ${OWNER_EVENT}."event_status" = 'CANCELLED' then (case when ${ahead} then 'cancelled-ahead' else 'cancelled-started' end)
    when ${ahead} then 'ahead'
    else 'started'
  end)`;
  return sql<boolean>`(${moment} || ':' || ${OWNER}."status"::text || ':' || ${emailOutbox.messageType}::text) in (${keys})`;
}

/** The participant's refused rows for the registration in the outer query (`registrations`), with their kind. */
function refusalsFromSql(): SQL {
  return sql`${emailOutbox}
    join ${registrations} as ${OWNER} on ${OWNER}."id" = ${emailOutbox.registrationId}
    join ${events} as ${OWNER_EVENT} on ${OWNER_EVENT}."id" = ${OWNER}."event_id"
    cross join lateral (select ${kindSql()} as "kind") as ${FACT}`;
}

/** The open ones (above): the same condition for the registration's own and for a family member's, at one event, until it ends. */
function openRefusalsWhere(now?: Date): SQL {
  return sql`${emailOutbox.participantId} = ${registrations.participantId}
    and ${participantMessageCondition()}
    and ${emailOutbox.status} in ('BOUNCED', 'COMPLAINED')
    and ${OWNER}."event_id" = ${registrations.eventId}
    and ${eventNotEndedSql(OWNER_EVENT, now)}
    and (${FACT}."kind" = 'unreachable' or (${FACT}."kind" is not null and ${stillNeededSql(now)}))`;
}

/** The order the registration shows them in: the address, then what never left, what is owed, what waits; its own first; newest first. */
function orderSql(): SQL {
  return sql`(case ${FACT}."kind" when 'unreachable' then 0 when 'not-sent' then 1 when 'missing' then 2 else 3 end),
    (${emailOutbox.registrationId} = ${registrations.id}) desc,
    ${rejectionInstantSql()} desc,
    ${emailOutbox.createdAt} desc`;
}

const epochMs = (instant: SQLWrapper) => sql`floor(extract(epoch from ${instant}) * 1000)`;

type Projection = "desk" | "list" | "page";

/**
 * The object's fields, by who reads it: the desk never gets provider text or more than it needs (§67) —
 * what did not arrive, why, and when it was refused, sent again or the address answered again, which are
 * instants and not words, and the status of the registration it was for (which press clears it).
 * `unclassified` is the one exception, and it never leaves the server: a refusal written without a cause
 * (by a deployment older than this one, between the migration and the build that follows it) carries its
 * stored answer so the mapper classifies it with `rejectionCause` and drops it.
 */
function fieldsSql(projection: Projection): SQL {
  const desk = sql`'kind', ${FACT}."kind",
    'messageType', ${emailOutbox.messageType},
    'at', ${epochMs(rejectionInstantSql())},
    'sent', ${emailOutbox.sentAt} is not null,
    'status', ${emailOutbox.status},
    'cause', ${emailOutbox.rejectionCause},
    'unclassified', case when ${emailOutbox.rejectionCause} is null then ${emailOutbox.lastError} end,
    'own', ${emailOutbox.registrationId} = ${registrations.id},
    'registrationStatus', ${OWNER}."status",
    'laterDeliveredAt', ${epochMs(emailOutbox.laterDeliveredAt)},
    'retriedAt', ${epochMs(emailOutbox.retriedAt)},
    'retriedVia', ${emailOutbox.retriedVia}`;
  if (projection !== "page") return desk;
  // The page alone reads the provider's words (no list payload carries them): the redacted detail, or
  // for a refusal at the send, the stored answer, which is redacted the same way.
  return sql`${desk},
    'code', ${emailOutbox.providerCode},
    'detail', coalesce(${emailOutbox.providerDetail}, ${emailOutbox.lastError})`;
}

function stateSql(projection: Projection): SQL {
  return sql`(
    select json_build_object(${fieldsSql(projection)})
    from ${refusalsFromSql()}
    where ${openRefusalsWhere()}
    order by ${orderSql()}
    limit 1
  )`;
}

/** The list's and the export's state: no provider text (§NNN: the list must not carry it). */
export function registrationEmailStateSql(): SQL<RegistrationEmailState | null> {
  return stateSql("list").mapWith(emailStateOf) as SQL<RegistrationEmailState | null>;
}

/** The desk's: what did not arrive and why, never an address or the provider's words (§67, `AGENTS.md` §15.11). */
export function deskEmailStateSql(): SQL<DeskEmailState | null> {
  return stateSql("desk").mapWith(deskEmailStateOf) as SQL<DeskEmailState | null>;
}

/** The registration page's: the state with the provider's code and words, for the small print. */
export function registrationEmailStateDetailSql(): SQL<RegistrationEmailStateDetail | null> {
  return stateSql("page").mapWith(emailStateDetailOf) as SQL<RegistrationEmailStateDetail | null>;
}

/**
 * How many real, live registrations of each event that has not ended ask somebody to act on their email
 * (§NNN), by the same rule as the state, at `now`: the club's side counts them per race («N participanți
 * nu primesc emailurile»). A cancelled event counts while the people told of it may not know (its start
 * ahead); race day counts until the day is over. The caller asserts who may read it; the count names nobody.
 */
export async function countNeedingEmailActionByEvent<T extends Record<string, unknown>>(
  db: Database<T>,
  now: Date,
): Promise<Array<{ eventId: string; count: number }>> {
  const rows = await db
    .select({ eventId: registrations.eventId, count: sql<number>`count(*)`.mapWith(Number) })
    .from(registrations)
    .innerJoin(events, eq(events.id, registrations.eventId))
    .where(
      and(
        eventNotEndedSql(events, now),
        eq(registrations.kind, "REAL"),
        notInArray(registrations.status, ["CANCELLED", "EXPIRED"]),
        needsEmailActionSql(now),
      ),
    )
    .groupBy(registrations.eventId);
  return rows;
}

/**
 * Whether its state asks somebody to act (`EMAIL_STATE_NEEDS_ACTION`: unreachable, not sent, missing) —
 * the same as "an open refusal of one of those kinds exists", because each of them outranks `retried`,
 * the one kind that waits. Open means what it means for the state: a refusal no longer needed, or of an
 * event that has ended, is not here. `now` is the database's own unless the caller names its instant.
 */
export function needsEmailActionSql(now?: Date): SQL<boolean> {
  const kinds = sql.join(EMAIL_STATE_NEEDS_ACTION.map((kind) => sql`${kind}`), sql`, `);
  return sql<boolean>`exists (select 1 from ${refusalsFromSql()} where ${openRefusalsWhere(now)} and ${FACT}."kind" in (${kinds}))`;
}
