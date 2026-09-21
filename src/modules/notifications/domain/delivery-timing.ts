import { z } from "zod";

/**
 * When a queued message actually leaves: the moment the request that queued it finishes, or
 * on the scheduler's next visit (`DECISIONS.md` §221).
 *
 * The owner asked for the switch, and the reason it is worth having is that the two failure
 * modes are opposite and the club cannot know in advance which one it is in.
 *
 * - **`immediate`** is what has always happened: `drainOutboxAfterResponse` sends after the
 *   response, so a confirmation link arrives in seconds. It is the right default, and it is
 *   the reason a registration feels instant. Its cost is that a burst — eighty people
 *   registering when a popular race opens — is eighty sends inside a few minutes, which is
 *   where a daily allowance is spent fastest and where a provider's rate limiter answers 429.
 * - **`scheduled`** sends nothing from the web request and leaves everything to the pinger,
 *   which visits every fifteen minutes by day (§68). Messages are late by up to that, and in
 *   exchange the sending is paced, the allowance drains predictably, and a burst cannot take
 *   the site's own response times with it.
 *
 * **Superadministrator only**, unlike the Mailgun plan beside it, which is the Administrator's
 * (§100). The plan is a fact about the account that the club's data controller knows; this is
 * an operational trade that makes every email on the platform arrive later, and getting it
 * wrong is invisible until somebody asks why their link took a quarter of an hour.
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
 * Immediate, because it is what the platform did before this setting existed and because a
 * participant waiting on a confirmation link is the case that matters most. A setting that
 * defaults to the slower behaviour would change how the site feels for every club that never
 * opens this screen.
 */
export const DEFAULT_DELIVERY_TIMING: DeliveryTimingSetting = { timing: "immediate" };
