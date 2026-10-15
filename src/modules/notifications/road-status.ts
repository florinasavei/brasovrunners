import { and, eq, gt, max, sql } from "drizzle-orm";
import { emailOutbox } from "@/db/schema/email-outbox";
import { platformSettings } from "@/db/schema/platform-settings";
import type { Database } from "@/db/types";
import type { SendResult } from "@/infrastructure/email/adapter";
import { type EmailSender, GMAIL_NOT_TAKING_ERROR } from "@/infrastructure/email/delivery";
import { env } from "@/shared/config/env";
import { GMAIL_CAP_DEFERRED_ERROR } from "./domain/email-transport";
import { type Road, ROADS } from "./domain/road-failover";

/**
 * What each road — Gmail and Mailgun — last did, for `/devs` → Stare, `/admin/tasks` and `/api/health`
 * (§778, amending §443 and §622).
 *
 * The last **success** is read from the outbox itself (`transport` and `sent_at`, the index the Gmail ledger
 * already uses): it needs no write on the hot path. The last **failure** and when the road **began failing**
 * are a `platform_settings` row written only when a road fails and when a failing road works again — a
 * message the service refused (a refused login, a 5xx, no connection, a spent allowance), never one that
 * bounced for its address, which says nothing about the road. «Failing» is what `/admin/tasks` rings for
 * (`roadFailingLong`): failures that have gone on for over an hour **and are still coming**.
 */
export const ROAD_STATUS_KEY = "emailRoadStatus";

/** A road that has been failing for this long is a row on `/admin/tasks` and a line on `/api/health`. */
export const ROAD_FAILING_ALARM_MS = 60 * 60_000;

export type RoadState = {
  /** The first failure of the run that has not been broken by a success yet; null while the road works. */
  failingSince: Date | null;
  lastFailureAt: Date | null;
  /** A short sanitized code (`smtp EAUTH`, `mailgun 503`) — never a body, an address or a secret (§14.5). */
  lastError: string | null;
};

export type RoadStates = Record<Road, RoadState>;

const EMPTY: RoadState = { failingSince: null, lastFailureAt: null, lastError: null };

function dateOf(value: unknown): Date | null {
  if (typeof value !== "string") return null;
  const at = new Date(value);
  return Number.isNaN(at.getTime()) ? null : at;
}

export function readRoadStatesValue(value: unknown): RoadStates {
  const states: RoadStates = { gmail: { ...EMPTY }, mailgun: { ...EMPTY } };
  if (!value || typeof value !== "object") return states;
  for (const road of ROADS) {
    const stored = (value as Record<string, unknown>)[road];
    if (!stored || typeof stored !== "object") continue;
    const { failingSince, lastFailureAt, lastError } = stored as Record<string, unknown>;
    states[road] = { failingSince: dateOf(failingSince), lastFailureAt: dateOf(lastFailureAt), lastError: typeof lastError === "string" ? lastError : null };
  }
  return states;
}

function valueOf(states: RoadStates): Record<Road, { failingSince: string | null; lastFailureAt: string | null; lastError: string | null }> {
  const write = (state: RoadState) => ({
    failingSince: state.failingSince?.toISOString() ?? null,
    lastFailureAt: state.lastFailureAt?.toISOString() ?? null,
    lastError: state.lastError,
  });
  return { gmail: write(states.gmail), mailgun: write(states.mailgun) };
}

export async function readRoadStates<T extends Record<string, unknown>>(db: Database<T>): Promise<RoadStates> {
  const [row] = await db.select({ value: platformSettings.value }).from(platformSettings).where(eq(platformSettings.key, ROAD_STATUS_KEY)).limit(1);
  return readRoadStatesValue(row?.value);
}

/** Written under the row's lock: two senders noting a failure at once must not drop either. */
async function writeRoadState<T extends Record<string, unknown>>(
  db: Database<T>,
  at: Date,
  change: (states: RoadStates) => RoadStates | null,
): Promise<void> {
  await db.transaction(async (tx) => {
    await tx
      .insert(platformSettings)
      .values({ key: ROAD_STATUS_KEY, value: valueOf({ gmail: { ...EMPTY }, mailgun: { ...EMPTY } }), updatedAt: at, updatedByStaffUserId: null })
      .onConflictDoNothing({ target: platformSettings.key });
    const [row] = await tx.select({ value: platformSettings.value }).from(platformSettings).where(eq(platformSettings.key, ROAD_STATUS_KEY)).for("update");
    const next = change(readRoadStatesValue(row?.value));
    if (!next) return;
    await tx.update(platformSettings).set({ value: valueOf(next), updatedAt: at }).where(eq(platformSettings.key, ROAD_STATUS_KEY));
  });
}

/** The service refused: the road is failing, since the first failure of this run. */
export async function recordRoadFailure<T extends Record<string, unknown>>(db: Database<T>, road: Road, error: string, at: Date): Promise<void> {
  await writeRoadState(db, at, (states) => ({
    ...states,
    [road]: { failingSince: states[road].failingSince ?? at, lastFailureAt: at, lastError: error.slice(0, 200) },
  }));
}

/** The road carried a message: it works again. Writes nothing while it was not failing. */
export async function recordRoadSuccess<T extends Record<string, unknown>>(db: Database<T>, road: Road, at: Date): Promise<void> {
  await writeRoadState(db, at, (states) => (states[road].failingSince ? { ...states, [road]: { ...states[road], failingSince: null } } : null));
}

/**
 * Whether a road has been failing long enough to ring (§778): the run began over an hour ago, no success has ended
 * it, **and the latest failure is within the last hour**. One failure on a quiet road — Gmail at night, or a Gmail
 * failure whose message Mailgun then carried — is not a road that is down: it can never ring, because the first and
 * the latest failure of a single failure are the same moment, and a run whose failures stopped coming (the road is
 * not asked, or was turned off) goes quiet an hour after its last one rather than staying red until a message
 * happens to cross it.
 */
export function roadFailingLong(state: RoadState, now: Date): boolean {
  if (state.failingSince === null || state.lastFailureAt === null) return false;
  return now.getTime() - state.failingSince.getTime() >= ROAD_FAILING_ALARM_MS && now.getTime() - state.lastFailureAt.getTime() < ROAD_FAILING_ALARM_MS;
}

/** Whether the deployment has this road at all: Gmail needs the club's account and app password; Mailgun is always the platform's. */
export function roadIsConfigured(road: Road): boolean {
  return road === "mailgun" || Boolean(env.CONTACT_SMTP_USER && env.CONTACT_SMTP_PASSWORD);
}

/** What the pages ring for: a road that exists here and is failing long. A Gmail account taken away clears its row. */
export function roadRings(road: Road, state: RoadState, now: Date): boolean {
  return roadIsConfigured(road) && roadFailingLong(state, now);
}

/** When each road last carried a message that reached somebody (not a captured one), from the outbox itself. */
export async function readRoadLastSuccess<T extends Record<string, unknown>>(db: Database<T>): Promise<Record<Road, Date | null>> {
  const rows = await db
    .select({ transport: emailOutbox.transport, last: max(emailOutbox.sentAt) })
    .from(emailOutbox)
    .where(and(eq(emailOutbox.status, "SENT"), gt(emailOutbox.recipientCount, 0), sql`${emailOutbox.transport} is not null`))
    .groupBy(emailOutbox.transport);
  const last: Record<Road, Date | null> = { gmail: null, mailgun: null };
  for (const row of rows) {
    if ((row.transport === "gmail" || row.transport === "mailgun") && row.last) last[row.transport] = new Date(row.last);
  }
  return last;
}

const NOT_A_ROAD_FAILURE = new Set([GMAIL_NOT_TAKING_ERROR, "gmail is not configured", GMAIL_CAP_DEFERRED_ERROR]);

/**
 * The road a refusal belongs to and its short code, when it is the **service's** refusal — read from the adapters'
 * own words (`gmail: smtp EAUTH`, `mailgun 503: …`, `mailgun unreachable: …`): a transient failure, a stop (the
 * allowance, a pause), a refusal of the account or the message. Never an address that bounced, never the club's
 * own pace, never a sent message, and never the club's own words about Gmail: «not taking messages in this batch»
 * says only that an earlier failure was already noted with its real code (overwriting it with the generic phrase hid
 * the code SETUP §38 promises), «not configured» is no road at all, and «daily cap: deferred» is the club's own cap,
 * not a service that is down. Null when it says nothing about a road.
 */
export function roadFailureOf(result: SendResult): { road: Road; error: string } | null {
  if (result.outcome === "sent") return null;
  if (NOT_A_ROAD_FAILURE.has(result.error)) return null;
  if (result.outcome === "permanent_failure" && !result.notTheAddress) return null;
  if (result.outcome === "throttled" && result.paced && !result.rateRefused) return null;
  const road = /^gmail\b/i.test(result.error) ? "gmail" : /^mailgun\b/i.test(result.error) ? "mailgun" : null;
  return road ? { road, error: result.error } : null;
}

/**
 * The outbox's sender, noting what each road did (§778): a refusal of the service is a failure of that road,
 * and the first message a failing road carries again clears it. One read per road per batch — once it has been
 * seen working, the rest of the batch writes nothing. Gmail's refusals are also noted by the sender itself
 * (`onFailure`, §443), which is where the `/api/health` reading of them comes from; this one keeps the single
 * record both roads share.
 */
export function withRoadStatus<T extends Record<string, unknown>>(db: Database<T>, sender: EmailSender, clock: () => Date = () => new Date()): EmailSender {
  const seenWorking = new Set<Road>();
  return {
    ...(sender.close ? { close: () => sender.close?.() } : {}),
    async send(message) {
      const result = await sender.send(message);
      try {
        const failure = roadFailureOf(result);
        if (failure) {
          seenWorking.delete(failure.road);
          await recordRoadFailure(db, failure.road, failure.error, clock());
        } else if (result.outcome === "sent") {
          const road: Road = result.transport === "gmail" ? "gmail" : "mailgun";
          // A captured message reached nobody: it proves nothing about the road.
          if ((result.recipients ?? 1) > 0 && !seenWorking.has(road)) {
            await recordRoadSuccess(db, road, clock());
            seenWorking.add(road);
          }
        }
      } catch (error) {
        // Noting what a road did must never be what changes the message's own outcome.
        console.error("[email-road] the road's state could not be noted", error);
      }
      return result;
    },
  };
}
