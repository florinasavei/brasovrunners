import { z } from "zod";

/**
 * When a queued message actually leaves: the moment the request that queued it finishes, or
 * on the scheduler's next visit (`DECISIONS.md` §221, §513).
 *
 * The two failure modes are opposite, which is why it is a setting and not a constant.
 *
 * - **`immediate`**: `drainOutboxAfterResponse` sends after the response, so a confirmation link
 *   arrives in seconds. Its cost is a burst — eighty people registering when a popular race opens
 *   is eighty sends inside a few minutes, where a daily allowance is spent fastest and where a
 *   provider's rate limiter answers 429 — and one message per request, so a parent registering
 *   three people gets three emails in three minutes where one would do.
 * - **`scheduled`** sends nothing from the web request and leaves everything to the outbox job,
 *   which the pinger visits every fifteen minutes by day and once an hour at night (§68). Messages
 *   are late by up to that, and in exchange the sending is paced, the allowance drains
 *   predictably, a burst cannot take the site's own response times with it, and what one sitting
 *   queued leaves together.
 *
 * **A «Termene» setting since §513**, the Administrator's (`canManageClubSettings`) — it decides a
 * wait every participant is told about, on the screen after the form and in the newsletter's
 * pop-up, like the other numbers in that fold. It was the Superadministrator's under §221 and §450
 * with no control left on any screen.
 */
export const DELIVERY_TIMINGS = ["immediate", "scheduled"] as const;
export type DeliveryTiming = (typeof DELIVERY_TIMINGS)[number];

export const deliveryTimingSettingSchema = z
  .object({
    timing: z.enum(DELIVERY_TIMINGS),
  })
  .strict();

export type DeliveryTimingSetting = z.infer<typeof deliveryTimingSettingSchema>;

/**
 * Scheduled — the owner, 2026-09-27: emails leave on the scheduler's tick, not right after the
 * request (§513, reversing §221's default). A deployment that never stored the row sends on the
 * tick; `immediate` is one save away in «Termene».
 */
export const DEFAULT_DELIVERY_TIMING: DeliveryTimingSetting = { timing: "scheduled" };

/**
 * The default where nobody stored a choice, per environment (§513). Scheduled where a pinger
 * exists — QA and production, the cron-job.org monitors of `SETUP.md` §40. Immediate on a laptop
 * (`local`) and on the end-to-end suite's server (`test`): neither has a pinger, so "on the tick"
 * would be "never", and a developer's registration would wait for a scheduler that does not come.
 * A stored choice wins everywhere.
 */
export function defaultDeliveryTiming(appEnv: "local" | "test" | "qa" | "production"): DeliveryTimingSetting {
  return appEnv === "qa" || appEnv === "production" ? DEFAULT_DELIVERY_TIMING : { timing: "immediate" };
}
