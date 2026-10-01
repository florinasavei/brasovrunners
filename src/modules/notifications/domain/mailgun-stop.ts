import { RATE_PAUSE_ERROR_PREFIX } from "./hourly-pace";

/**
 * Mailgun said stop (§NNN, amending §605): a pause it asked for (a 429, the probation's "temporarily
 * disabled") or its daily or monthly allowance spent (a 402, a 420, a 400 with limit language, §40).
 * Either way the road is closed until `until`, and the message is not the reason — so it is never
 * lost to it, and, when the club's switch «Gmail preia când Mailgun se oprește» is on, every group's
 * due mail leaves on Gmail's road until Mailgun's road opens again.
 *
 * Pure: the marks, the shape of a stop and the one decision every reader of it makes — the claim,
 * «Trimite acum», `/api/health`, «Sarcini» and the queue panel.
 */

export type MailgunStopKind = "paused" | "allowance";

/** Mailgun's road closed, why, and until when. */
export type MailgunStop = { kind: MailgunStopKind; until: Date };

/**
 * What a row deferred to Mailgun's allowance reset carries on `last_error` (§NNN), before the
 * provider's sanitized reason: the mark the claim reads to send it at once on Gmail's road while the
 * fallback carries, and health reads to tell the allowance from a backoff. The pause has its own
 * mark since §605 (`RATE_PAUSE_ERROR_PREFIX`).
 */
export const ALLOWANCE_DEFERRED_ERROR_PREFIX = "allowance spent: ";

/**
 * What a row carries while Mailgun is stopped and Gmail cannot take it either (§NNN): the switch is
 * on but Gmail's cap is spent, or Gmail refused the connection. Not a Mailgun mark — the row is not
 * due at once on Gmail's road, it waits for Gmail's room or for Mailgun's road to open — and the
 * mark health counts as «nothing can carry it» once the row has waited ninety minutes.
 */
export const FALLBACK_WAITING_ERROR_PREFIX = "mailgun stopped, gmail could not carry it: ";

/** How long a row waits when Gmail could not carry it and gave no time: the job's daytime cadence. */
export const FALLBACK_RETRY_MS = 15 * 60_000;

/** Whether a row's `last_error` says Mailgun held it back — paused, or deferred to the allowance's reset. */
export function heldByMailgun(lastError: string | null): boolean {
  return lastError !== null && (lastError.startsWith(RATE_PAUSE_ERROR_PREFIX) || lastError.startsWith(ALLOWANCE_DEFERRED_ERROR_PREFIX));
}

/**
 * The stop in force from what was read: a pause first — it holds Mailgun's road whatever the switch
 * says (§605) — then the allowance; each only while its end is ahead of `now`.
 */
export function stopInForce(input: { pausedUntil: Date | null; allowanceUntil: Date | null }, now: Date): MailgunStop | null {
  if (input.pausedUntil && input.pausedUntil.getTime() > now.getTime()) return { kind: "paused", until: input.pausedUntil };
  if (input.allowanceUntil && input.allowanceUntil.getTime() > now.getTime()) return { kind: "allowance", until: input.allowanceUntil };
  return null;
}

/** Why nothing can carry a due Mailgun row while Mailgun is stopped: the remedy each sentence names. */
export type StopWaitReason = "fallbackOff" | "gmailUnconfigured" | "gmailCapSpent";

/**
 * Which road a due Mailgun row takes now (§NNN):
 *
 * - **mailgun** — Mailgun is not stopped;
 * - **gmail** — Mailgun is stopped, the switch is on, Gmail is configured and its rolling day still
 *   has room for `needed` recipients (one by default): Gmail carries it, inside its own cap and pace;
 * - **wait** — Mailgun is stopped and Gmail cannot carry it, with the reason (the switch is off,
 *   Gmail is not configured, or its cap is spent) and when Mailgun's road opens again.
 *
 * The switch off is checked after "configured": a deployment without Gmail cannot turn it on, and
 * the sentence must name the remedy that exists.
 */
export type StopRoute = { road: "mailgun" } | { road: "gmail"; stop: MailgunStop } | { road: "wait"; stop: MailgunStop; reason: StopWaitReason };

export function routeWhileStopped(input: {
  stop: MailgunStop | null;
  fallbackToGmail: boolean;
  gmailConfigured: boolean;
  /** Recipients Gmail's rolling day still has room for: the cap less what it reached. */
  gmailRoom: number;
  needed?: number;
}): StopRoute {
  const { stop } = input;
  if (!stop) return { road: "mailgun" };
  if (!input.gmailConfigured) return { road: "wait", stop, reason: "gmailUnconfigured" };
  if (!input.fallbackToGmail) return { road: "wait", stop, reason: "fallbackOff" };
  if (input.gmailRoom < Math.max(1, input.needed ?? 1)) return { road: "wait", stop, reason: "gmailCapSpent" };
  return { road: "gmail", stop };
}

/**
 * The switch as it acts (§NNN): on unless the club turned it off, and only where Gmail is configured
 * — a stored «on» on a deployment without the account carries nothing, and the panel greys it.
 */
export function fallbackActive(setting: { fallbackToGmail?: boolean }, gmailConfigured: boolean): boolean {
  return gmailConfigured && setting.fallbackToGmail !== false;
}

/**
 * When a row Gmail could not carry during a stop is tried again: when Gmail said it has room, or in
 * a quarter of an hour — never after Mailgun's road opens, where it is Mailgun's again.
 */
export function fallbackRetryAt(now: Date, stop: MailgunStop, gmailRoomAt: Date | undefined): Date {
  const gmail = gmailRoomAt ? gmailRoomAt.getTime() : now.getTime() + FALLBACK_RETRY_MS;
  return new Date(Math.max(now.getTime(), Math.min(gmail, stop.until.getTime())));
}
