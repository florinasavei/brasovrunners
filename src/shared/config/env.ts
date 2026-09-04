import { isValidEmail } from "@/modules/participants/domain/canonical-email";
import { z } from "zod";

// AGENTS.md §7.1: APP_ENV is the environment identity; NODE_ENV is not.
// AGENTS.md §8: APP_BASE_URL is the single source of every absolute URL the app emits.

/**
 * Comma-separated addresses, empty by default.
 *
 * Parsed here rather than at the point of use so that a malformed allowlist is a startup
 * failure with the offending entry named, not a message quietly captured six weeks later
 * because someone typed a semicolon.
 */
const allowlist = z
  .string()
  .default("")
  .transform((value) =>
    value
      .split(",")
      .map((entry) => entry.trim())
      .filter((entry) => entry !== ""),
  );

export const envSchema = z
  .object({
    APP_ENV: z.enum(["local", "test", "qa", "production"]).default("local"),
    APP_BASE_URL: z.url().default("http://localhost:3000"),
    // Optional only until WEEKEND.md step 2 lands the first table; then it is required.
    DATABASE_URL: z.url().optional(),

    /**
     * How a member of staff proves who they are (AGENTS.md §8, §13.1).
     *
     * `dev-switcher` is the seeded switcher: pick a synthetic identity from a list, no
     * password, no provider. It is a development tool and nothing else, so it is refused
     * outright in qa and production below.
     *
     * `disabled` means there is no way to sign in at all, which is the honest state of qa and
     * production until the staff login lands (DECISIONS.md §24). The backoffice is not hidden
     * there — it is unreachable, because every guarded call starts by asking who is signing
     * this request and gets nobody.
     *
     * Left optional so the safe value is derived rather than typed: local and test get the
     * switcher, every other environment gets nothing. An operator may still state it
     * explicitly, and stating `dev-switcher` outside local or test fails at startup.
     */
    STAFF_AUTH_MODE: z.enum(["dev-switcher", "disabled"]).optional(),

    // AGENTS.md §7.2 and §16.4. Defaults to the mode that transmits nothing.
    EMAIL_DELIVERY_MODE: z.enum(["capture", "allowlist", "live"]).default("capture"),
    EMAIL_ALLOWLIST: allowlist,
    MAILGUN_API_KEY: z.string().min(1).optional(),
    MAILGUN_DOMAIN: z.string().min(1).optional(),
  })
  /**
   * BR-REQ-080-03 criterion 3: an unsafe combination fails at startup.
   *
   * At startup, and not at send time, because the failure these rules prevent is a message
   * reaching a real person from a system that was not supposed to reach anyone. By the time a
   * send is attempted the participant has already registered on a test system, the QA database
   * already holds their address, and the mail is already going out. A process that refuses to
   * boot is noticed by whoever deployed it, within seconds, before anything happened.
   */
  .superRefine((value, ctx) => {
    const { APP_ENV, EMAIL_DELIVERY_MODE, EMAIL_ALLOWLIST } = value;

    /**
     * The development staff switcher never runs where real content lives.
     *
     * AGENTS.md §13.1 permits a seeded switcher in local and test and requires it to be
     * unavailable in qa and production. It hands out staff authority to whoever asks, so a
     * process configured this way in qa is a backoffice with the lock taken off. Refused at
     * startup, by the same reasoning as live email: a deployment that will not boot is noticed
     * within seconds, and a permissive one is noticed after someone has used it.
     */
    if (value.STAFF_AUTH_MODE === "dev-switcher" && APP_ENV !== "local" && APP_ENV !== "test") {
      ctx.addIssue({
        code: "custom",
        path: ["STAFF_AUTH_MODE"],
        message: `the development staff switcher is only permitted when APP_ENV is local or test; this process has APP_ENV=${APP_ENV}. AGENTS.md §13.1, BR-REQ-060-01.`,
      });
    }

    /**
     * Live delivery belongs to production alone.
     *
     * This is the rule the requirement names by example — "QA configured for live delivery" —
     * and it is stated as a property of `live` rather than as a list of forbidden
     * environments, so a fifth environment added later is refused by default rather than
     * missed.
     */
    if (EMAIL_DELIVERY_MODE === "live" && APP_ENV !== "production") {
      ctx.addIssue({
        code: "custom",
        path: ["EMAIL_DELIVERY_MODE"],
        message: `live email delivery is only permitted when APP_ENV=production; this process has APP_ENV=${APP_ENV}. AGENTS.md §16.4, BR-REQ-080-03.`,
      });
    }

    // §7.1: local and test capture. Not allowlist either — a developer's own address on an
    // allowlist is still a real inbox, reached from a machine running seed data.
    if ((APP_ENV === "local" || APP_ENV === "test") && EMAIL_DELIVERY_MODE !== "capture") {
      ctx.addIssue({
        code: "custom",
        path: ["EMAIL_DELIVERY_MODE"],
        message: `APP_ENV=${APP_ENV} must capture email; ${EMAIL_DELIVERY_MODE} transmits. AGENTS.md §7.1, §16.4.`,
      });
    }

    if (EMAIL_DELIVERY_MODE === "allowlist" && EMAIL_ALLOWLIST.length === 0) {
      ctx.addIssue({
        code: "custom",
        path: ["EMAIL_ALLOWLIST"],
        message:
          "EMAIL_DELIVERY_MODE=allowlist with an empty EMAIL_ALLOWLIST would transmit to nobody while looking like live delivery. Set the authorized addresses, or use capture.",
      });
    }

    for (const entry of EMAIL_ALLOWLIST) {
      if (!isValidEmail(entry)) {
        ctx.addIssue({
          code: "custom",
          path: ["EMAIL_ALLOWLIST"],
          // The entry is configuration written by an operator, not participant data, so
          // naming it is what makes the error fixable.
          message: `EMAIL_ALLOWLIST entry is not a valid address: "${entry}".`,
        });
      }
    }

    // A mode that can transmit needs credentials. Missing ones would surface as a failed send
    // per message rather than as a deployment that did not start.
    if (EMAIL_DELIVERY_MODE !== "capture" && (!value.MAILGUN_API_KEY || !value.MAILGUN_DOMAIN)) {
      ctx.addIssue({
        code: "custom",
        path: ["MAILGUN_API_KEY"],
        message: `EMAIL_DELIVERY_MODE=${EMAIL_DELIVERY_MODE} requires MAILGUN_API_KEY and MAILGUN_DOMAIN.`,
      });
    }

    /**
     * The check deliberately absent: production is NOT required to be live.
     *
     * AGENTS.md §7.2 pairs production with live delivery, and that is where this ends up. It
     * is not enforced yet because it would refuse to start the pilot — production runs public
     * event pages, has no Mailgun account, and enqueues no message of any kind, so capture
     * there transmits nothing because there is nothing to transmit. The day the first message
     * type ships (BR-REQ-080-01), production capturing email means participants never receive
     * a confirmation, and this check must be added with it.
     */
  })
  /**
   * Derive the staff authentication mode when nobody stated one.
   *
   * Done here rather than with a Zod default so the safe value depends on the environment:
   * a default of `dev-switcher` would enable the switcher in production the first time
   * someone forgot the variable, and a default of `disabled` would mean every developer and
   * the end-to-end suite must set it before they can sign in at all.
   */
  .transform((value) => ({
    ...value,
    STAFF_AUTH_MODE:
      value.STAFF_AUTH_MODE ??
      (value.APP_ENV === "local" || value.APP_ENV === "test"
        ? ("dev-switcher" as const)
        : ("disabled" as const)),
  }));

export type Env = z.infer<typeof envSchema>;

export const env = envSchema.parse(process.env);
