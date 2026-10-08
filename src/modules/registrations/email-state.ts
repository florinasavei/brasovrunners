import { and, eq, gt, notInArray, type SQL, type SQLWrapper, sql } from "drizzle-orm";
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
} from "./domain/email-state";

/**
 * The registration's one email state, as SQL (§NNN; the kinds are `domain/email-state.ts`'s). One
 * correlated subquery per registration row — the participant's refused rows, through
 * `email_outbox_participant_idx` — returning one JSON object, so a list of two hundred is two hundred
 * index probes and never a query each. The rule lives here and only here: which refusals are still
 * open, which kind each one is, and which one the registration shows.
 *
 * **Open.** A participant's own message (`participantMessageCondition`: their type, their id, not a
 * club copy — the archive copy and the confirmation notice carry the participant's id and are not
 * theirs), refused (`BOUNCED`) or complained about (`COMPLAINED`), and:
 *
 * - this registration's own message, not resolved — the same message delivered later, or for a refusal
 *   of the club's account, left later (`resolved_at`);
 * - or another registration's **at the same event** on the same address (a family, §543) whose refusal
 *   still stands for the address: nothing delivered to it since, and not a refusal of the account;
 * - or any complaint at the same event: the person's own word, which no delivery withdraws.
 *
 * **Which one.** The address first (`unreachable`: nothing will arrive), then what is owed (`not-sent`,
 * `missing`), then what waits (`retried`); the newest refusal within each.
 */

/** The kind of one open refused row, for the registration in the outer query. */
function kindSql(): SQL<EmailStateKind> {
  return sql<EmailStateKind>`(case
    when ${emailOutbox.status} = 'COMPLAINED' or ${emailOutbox.registrationId} is distinct from ${registrations.id} then 'unreachable'
    when ${emailOutbox.rejectionCause} = 'account' then 'not-sent'
    when ${emailOutbox.retriedAt} is not null then 'retried'
    when ${emailOutbox.laterDeliveredAt} is not null then 'missing'
    else 'unreachable'
  end)`;
}

/** The order the registration shows them in: the address, then what is owed, then what waits; newest first. */
function rankSql(): SQL<number> {
  return sql<number>`(case ${kindSql()} when 'unreachable' then 0 when 'retried' then 2 else 1 end)`;
}

/** The participant's open refusals for the registration in the outer query (`registrations`). */
function openRefusalsWhere(): SQL {
  return sql`${emailOutbox.participantId} = ${registrations.participantId}
    and ${participantMessageCondition()}
    and ${emailOutbox.status} in ('BOUNCED', 'COMPLAINED')
    and (
      (${emailOutbox.registrationId} = ${registrations.id} and (${emailOutbox.status} = 'COMPLAINED' or ${emailOutbox.resolvedAt} is null))
      or (
        ${emailOutbox.registrationId} <> ${registrations.id}
        and exists (
          select 1 from ${registrations} as "family"
          where "family"."id" = ${emailOutbox.registrationId} and "family"."event_id" = ${registrations.eventId}
        )
        and (
          ${emailOutbox.status} = 'COMPLAINED'
          or (${emailOutbox.resolvedAt} is null and ${emailOutbox.laterDeliveredAt} is null and ${emailOutbox.rejectionCause} is distinct from 'account')
        )
      )
    )`;
}

const epochMs = (instant: SQLWrapper) => sql`floor(extract(epoch from ${instant}) * 1000)`;

type Projection = "desk" | "list" | "page";

/**
 * The object's fields, by who reads it: the desk never gets provider text or more than it needs (§67) —
 * what did not arrive, why, and when it was refused, sent again or the address answered again, which are
 * instants and not words. `unclassified` is the one exception, and it never leaves the server: a refusal
 * written without a cause (by a deployment older than this one, between the migration and the build that
 * follows it) carries its stored answer so the mapper classifies it with `rejectionCause` and drops it.
 */
function fieldsSql(projection: Projection): SQL {
  const desk = sql`'kind', ${kindSql()},
    'messageType', ${emailOutbox.messageType},
    'at', ${epochMs(rejectionInstantSql())},
    'sent', ${emailOutbox.sentAt} is not null,
    'status', ${emailOutbox.status},
    'cause', ${emailOutbox.rejectionCause},
    'unclassified', case when ${emailOutbox.rejectionCause} is null then ${emailOutbox.lastError} end,
    'own', ${emailOutbox.registrationId} = ${registrations.id},
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
    from ${emailOutbox}
    where ${openRefusalsWhere()}
    order by ${rankSql()}, ${rejectionInstantSql()} desc, ${emailOutbox.createdAt} desc
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
 * How many real, live registrations of each scheduled event that has not started ask somebody to act on
 * their email (§NNN): the club's side counts them per race («N participanți nu primesc emailurile»). The
 * caller asserts who may read it; the count names nobody.
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
        eq(events.eventStatus, "SCHEDULED"),
        gt(events.startsAt, now),
        eq(registrations.kind, "REAL"),
        notInArray(registrations.status, ["CANCELLED", "EXPIRED"]),
        needsEmailActionSql(),
      ),
    )
    .groupBy(registrations.eventId);
  return rows;
}

/**
 * Whether its state asks somebody to act (`EMAIL_STATE_NEEDS_ACTION`: unreachable, not sent, missing) —
 * the same as "an open refusal of one of those kinds exists", because each of them outranks `retried`,
 * the one kind that waits.
 */
export function needsEmailActionSql(): SQL<boolean> {
  const kinds = sql.join(EMAIL_STATE_NEEDS_ACTION.map((kind) => sql`${kind}`), sql`, `);
  return sql<boolean>`exists (select 1 from ${emailOutbox} where ${openRefusalsWhere()} and ${kindSql()} in (${kinds}))`;
}
