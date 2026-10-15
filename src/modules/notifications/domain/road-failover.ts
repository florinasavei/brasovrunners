import type { SendResult } from "@/infrastructure/email/adapter";

/**
 * Which road carries a visitor's message next, and what a road's answer means (§NNN, amending §149,
 * §676, §772 and §622). Pure, so the rule can be read as a table and asserted without a provider.
 *
 * **The rule.** A message has a chosen road (the club's choice for the form) and, when the club lets it,
 * a second one. The chosen road gets `RELAY_FAILOVER_AFTER` failed attempts; the **service's** failures
 * count — a refused login, a 5xx, no connection, a spent allowance — never the recipient's (a bad address,
 * a bounce), which end the message and are not the other road's to try. After them the other road is tried,
 * and the two take turns by their failure counts until one of them carries it. Both directions: Mailgun to
 * Gmail and Gmail to Mailgun.
 *
 * **Never a double send.** A failure after which the service may already have the message — the connection
 * broke or timed out once the message was on its way (`mayHaveBeenAccepted`) — is *ambiguous*, and pins the
 * message to that road for good: it is retried there and never handed to the other, because the first road
 * may be about to deliver it. There is no way to ask Gmail whether it took a message, and Mailgun's id is
 * only known from an answer that never came, so «until the road's state is known» is decided in the only
 * way that can be: the state of an ambiguous send is never known, and the message does not change road.
 * (A failure before the service could have taken it — a refused connection, a login, a DNS answer, the
 * server's own 5xx, a connect timeout — is not ambiguous: nothing was accepted.)
 */
export type Road = "gmail" | "mailgun";

export const ROADS = ["gmail", "mailgun"] as const satisfies readonly Road[];

/**
 * Failed attempts on the chosen road before the other is tried: two. One failure is a hiccup; a second
 * one a minute later is a road that is down. Short, because this is a person's message and the answer to
 * «does it get through when a service is down» is minutes, not an hour (the outbox's own retry schedule
 * starts at one minute, and the relay's first two retries are seconds, `relay.ts`).
 */
export const RELAY_FAILOVER_AFTER = 2;

export type RoadFailure = {
  /** The service's failures of this message on this road. */
  count: number;
  /** One of them may have been accepted: this message stays on this road. */
  ambiguous: boolean;
  /** A short sanitized code of the latest — `smtp EAUTH`, `mailgun 503` — never a body or an address. */
  lastError: string | null;
};

export type RoadFailures = Partial<Record<Road, RoadFailure>>;

export function otherRoad(road: Road): Road {
  return road === "gmail" ? "mailgun" : "gmail";
}

/** A stored `road_failures` value, read defensively: anything this code cannot read is no failures. */
export function readRoadFailures(value: unknown): RoadFailures {
  const failures: RoadFailures = {};
  if (!value || typeof value !== "object") return failures;
  for (const road of ROADS) {
    const stored = (value as Record<string, unknown>)[road];
    if (!stored || typeof stored !== "object") continue;
    const { count, ambiguous, lastError } = stored as Record<string, unknown>;
    if (typeof count !== "number" || !Number.isFinite(count) || count < 0) continue;
    failures[road] = { count: Math.floor(count), ambiguous: ambiguous === true, lastError: typeof lastError === "string" ? lastError : null };
  }
  return failures;
}

/** One more failure on a road, written to the value `road_failures` holds; the ambiguity once set stays set. */
export function withFailure(failures: RoadFailures, road: Road, failure: { error: string; ambiguous: boolean; immediate?: boolean }): RoadFailures {
  const before = failures[road] ?? { count: 0, ambiguous: false, lastError: null };
  return {
    ...failures,
    [road]: {
      // A road that said stop (an allowance spent, a pause) is down for every attempt: it counts as all of them at once.
      count: Math.max(before.count + 1, failure.immediate ? RELAY_FAILOVER_AFTER : 0),
      ambiguous: before.ambiguous || failure.ambiguous,
      lastError: failure.error.slice(0, 200),
    },
  };
}

export type RoadPlan =
  /** Send by this road now; `failedOver` when it is not the chosen one. */
  | { road: Road; failedOver: boolean }
  /** No road can carry it now: wait (the chosen road is pinned and unavailable, or none is configured). */
  | { road: null; why: "pinned-unavailable" | "none-available" };

export type RoadPlanInput = {
  chosen: Road;
  failures: RoadFailures;
  /** Which roads exist and are not stopped right now (configured; Mailgun not paused or out of allowance). */
  available: Readonly<Record<Road, boolean>>;
  /** The other road may carry it: the form's default, or Girl Zone with the club's tick and the notice's words. */
  fallbackAllowed: boolean;
};

export function planRoad(input: RoadPlanInput): RoadPlan {
  const { chosen, failures, available, fallbackAllowed } = input;
  const other = otherRoad(chosen);
  const count = (road: Road) => failures[road]?.count ?? 0;

  // An ambiguous send pins the message to its road: retried there, never by the other (see the header).
  const pinned = failures[chosen]?.ambiguous ? chosen : failures[other]?.ambiguous ? other : null;
  if (pinned) return available[pinned] ? { road: pinned, failedOver: pinned !== chosen } : { road: null, why: "pinned-unavailable" };

  const candidates: Road[] = [chosen, ...(fallbackAllowed ? [other] : [])].filter((road) => available[road]);
  if (candidates.length === 0) return { road: null, why: "none-available" };

  // The chosen road keeps the message until it has failed it enough times — or does not exist or is stopped.
  if (available[chosen] && (count(chosen) < RELAY_FAILOVER_AFTER || !candidates.includes(other))) return { road: chosen, failedOver: false };

  // Then the roads take turns by what each has failed: the one that has failed less, the chosen one on a tie.
  const best = candidates.reduce((a, b) => (count(b) < count(a) ? b : a));
  return { road: best, failedOver: best !== chosen };
}

/** What a road's answer means for one message. */
export type RoadOutcome =
  | { kind: "sent" }
  /** The recipient's: an address the service refused for good. The message ends BOUNCED; no other road is tried. */
  | { kind: "recipient"; error: string }
  /** The service's: a refused login, a 5xx, no connection, a spent allowance. Counted; the other road may take over. */
  | { kind: "service"; error: string; immediate: boolean }
  /** The service's, and the message may be on its way already: pinned to this road. */
  | { kind: "ambiguous"; error: string }
  /** Held back for a pace, not refused: nothing was tried, the attempt is given back. */
  | { kind: "paced"; until: Date | null };

/**
 * Reads a road's `SendResult` for a relay row. The one place that says which refusals are the service's
 * and which the recipient's:
 *
 * - `permanent_failure` without `notTheAddress` is the address (Gmail's `5.1.x`, Mailgun's 400 naming it): the
 *   recipient's. With `notTheAddress` it is the account's or the message's — 401, 403, a refused sender, a
 *   malformed message — which a person must fix: the service's, so the other road gets its turn.
 * - `transient_failure` is the service's, ambiguous when it says the message may have been accepted.
 * - `throttled` with `paced` and no `rateRefused` is the club's own pace (Gmail's spacing): not a failure.
 *   Any other `throttled` — Mailgun's allowance or its pause, Gmail's cap — is a road that says stop: the
 *   service's, and it counts as every attempt at once (`immediate`).
 */
export function readRoadOutcome(result: SendResult): RoadOutcome {
  switch (result.outcome) {
    case "sent":
      return { kind: "sent" };
    case "permanent_failure":
      return result.notTheAddress ? { kind: "service", error: result.error, immediate: false } : { kind: "recipient", error: result.error };
    case "transient_failure":
      return result.mayHaveBeenAccepted
        ? { kind: "ambiguous", error: result.error }
        : result.addressRefusedForNow
          ? // Gmail refused the address for now while a copy went: the address's, not the account's, and the copies are out already.
            { kind: "ambiguous", error: result.error }
          : { kind: "service", error: result.error, immediate: false };
    case "throttled":
      if (result.paced && !result.rateRefused) return { kind: "paced", until: result.retryAfter ?? null };
      return { kind: "service", error: result.error, immediate: true };
  }
}
