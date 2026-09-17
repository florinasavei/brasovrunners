import { isValidEmail } from "@/modules/participants/domain/canonical-email";
import { z } from "zod";
import { APP_ENVIRONMENTS, EMAIL_DELIVERY_MODES, STAFF_AUTH_MODES } from "./env-enums";

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
    APP_ENV: z.enum(APP_ENVIRONMENTS).default("local"),
    /**
     * The default is the port `yarn dev` actually starts on (`scripts/dev.mjs`), not 3000.
     *
     * It said 3000 and the dev server has never used it — `scripts/dev.mjs` picks 47821,
     * deliberately far from 3000, 5173, 8000 and 8080 so it does not collide with another
     * project. Every absolute URL this application emits derives from this value (§8), so the
     * mismatch meant a locally rendered confirmation link pointed at a port with nothing
     * listening on it, and the developer who clicked it learned nothing about their change.
     */
    APP_BASE_URL: z.url().default("http://localhost:47821"),
    // Optional only until WEEKEND.md step 2 lands the first table; then it is required.
    DATABASE_URL: z.url().optional(),

    /**
     * How a member of staff proves who they are (AGENTS.md §8, §13.1).
     *
     * `dev-switcher` is the seeded switcher: pick a synthetic identity from a list, no
     * password, no provider. It is a development tool and nothing else, so it is refused
     * outright in qa and production below.
     *
     * `provider` is the real thing: Auth.js with the Zitadel OAuth provider, gated on the
     * `staff_users` allowlist. Named for the mechanism rather than the vendor — matching
     * `EMAIL_DELIVERY_MODE`'s style — so a future change to what Zitadel's own login policy
     * offers is not an env var rename.
     *
     * `disabled` means there is no way to sign in at all — the safe default for qa and
     * production until an operator explicitly turns `provider` on for that environment. The
     * backoffice is not hidden when disabled — it is unreachable, because every guarded call
     * starts by asking who is signing this request and gets nobody.
     *
     * Left optional so the safe value is derived rather than typed: local and test get the
     * switcher, every other environment gets nothing until stated. Stating `dev-switcher`
     * outside local or test fails at startup.
     */
    STAFF_AUTH_MODE: z.enum(STAFF_AUTH_MODES).optional(),

    // Auth.js (AGENTS.md §13.1). Required together when STAFF_AUTH_MODE=provider.
    AUTH_SECRET: z.string().min(1).optional(),
    AUTH_ZITADEL_ID: z.string().min(1).optional(),
    AUTH_ZITADEL_SECRET: z.string().min(1).optional(),
    AUTH_ZITADEL_ISSUER: z.url().optional(),

    // Verifies job-endpoint callers (AGENTS.md §16.2) — a scheduler, not a staff session.
    JOB_SECRET: z.string().min(1).optional(),

    /**
     * The club's real site, for the "this is not the real site" banner to link to (§7.5).
     *
     * Deliberately not derived from `APP_BASE_URL`: that is *this* environment's host, and the
     * whole point here is to name a different one. Optional, and unset on a developer's machine
     * — there is no other site to send anybody to from localhost, and the banner just ends its
     * sentence. Production never renders the banner at all.
     */
    PRODUCTION_SITE_URL: z.url().optional(),

    /**
     * The club's own profiles elsewhere, for the footer and for the `sameAs` of the
     * `SportsOrganization` structured data (BR-REQ-052-02 criterion 1, which has been
     * incomplete for exactly this reason: inventing a profile URL misinforms a search engine
     * rather than merely being wrong).
     *
     * Configuration and not a constant, because §8 forbids a hostname anywhere under `src/` and
     * exempts no provider — and because a club that changes network should not need a release.
     * All optional: unset, the footer shows no social links and `sameAs` is omitted entirely,
     * which is the honest state rather than an empty array. Strava is where the club's runs are
     * actually recorded, which for a running club is the profile that matters most.
     */
    CLUB_FACEBOOK_URL: z.url().optional(),
    CLUB_INSTAGRAM_URL: z.url().optional(),
    CLUB_STRAVA_URL: z.url().optional(),

    /**
     * Where uploaded photos live (AGENTS.md §17; `DECISIONS.md` §66).
     *
     * Cloudflare R2 through its S3 API. Five values, all from the bucket's page and its API
     * token (`SETUP.md` §32): the S3 endpoint is configuration rather than assembled from an
     * account id, because §8 forbids a hostname literal under `src/` and exempts no provider;
     * `R2_PUBLIC_BASE_URL` is the address the bucket's objects are read at — its `r2.dev`
     * subdomain, or a custom one — so a photo is served by Cloudflare, never through a function.
     *
     * All optional here, and `STORAGE_MODE` below says what an incomplete set means: qa and
     * production run without a gallery until the five exist, rather than refusing to boot.
     */
    R2_ENDPOINT: z.url().optional(),
    R2_ACCESS_KEY_ID: z.string().min(1).optional(),
    R2_SECRET_ACCESS_KEY: z.string().min(1).optional(),
    R2_BUCKET: z.string().min(1).optional(),
    R2_PUBLIC_BASE_URL: z.url().optional(),

    // AGENTS.md §7.2 and §16.4. Defaults to the mode that transmits nothing.
    EMAIL_DELIVERY_MODE: z.enum(EMAIL_DELIVERY_MODES).default("capture"),
    EMAIL_ALLOWLIST: allowlist,
    MAILGUN_API_KEY: z.string().min(1).optional(),
    MAILGUN_DOMAIN: z.string().min(1).optional(),
    /**
     * Mailgun's API base, e.g. its US or EU region endpoint.
     *
     * Configuration for the same reason the club's profile URLs are: §8 forbids a hostname under
     * `src/` and exempts no provider. It also happens to matter — Mailgun's EU region is a
     * different host, and a club whose participants are European may need it.
     */
    MAILGUN_API_BASE_URL: z.url().optional(),

    /**
     * Who the club's email comes from, and where a reply goes (AGENTS.md §8, §16.4).
     *
     * Configuration rather than a literal, because a sending address contains a hostname and
     * §8 exempts no provider. It is also what lets one build run against a Mailgun sandbox
     * today and the club's own domain later without a line of code changing.
     *
     * Both are optional and both have a working default: the address falls back to
     * `noreply@<MAILGUN_DOMAIN>`, which is valid on a sandbox from the moment the account
     * exists. The club's real sender name and address are an owner decision (`BUSINESS.md`
     * §9) and can be filled in whenever they are made.
     */
    EMAIL_FROM_ADDRESS: z.email().optional(),
    EMAIL_FROM_NAME: z.string().min(1).max(120).default("Brașov Runners"),
    /**
     * Absent means a reply goes to the from address, which for `noreply@` means nowhere.
     * Setting this to a mailbox the club actually reads is the whole of "people can reply".
     */
    EMAIL_REPLY_TO: z.email().optional(),
    // Verifies inbound Mailgun webhooks (AGENTS.md §16.5) — a separate secret from the API
    // key, since the two prove different things: one authenticates outbound calls this
    // application makes, the other authenticates inbound calls Mailgun makes to it.
    MAILGUN_WEBHOOK_SIGNING_KEY: z.string().min(1).optional(),
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

    // A mode that can authenticate real staff needs Auth.js's own secret and the Zitadel
    // credentials — missing one would surface as a broken sign-in for the first person who
    // tries it, rather than as a deployment that did not start.
    if (
      value.STAFF_AUTH_MODE === "provider" &&
      (!value.AUTH_SECRET || !value.AUTH_ZITADEL_ID || !value.AUTH_ZITADEL_SECRET || !value.AUTH_ZITADEL_ISSUER)
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["STAFF_AUTH_MODE"],
        message:
          "STAFF_AUTH_MODE=provider requires AUTH_SECRET, AUTH_ZITADEL_ID, AUTH_ZITADEL_SECRET and AUTH_ZITADEL_ISSUER. AGENTS.md §13.1.",
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
    if (
      EMAIL_DELIVERY_MODE !== "capture" &&
      (!value.MAILGUN_API_KEY || !value.MAILGUN_DOMAIN || !value.MAILGUN_API_BASE_URL)
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["MAILGUN_API_KEY"],
        message: `EMAIL_DELIVERY_MODE=${EMAIL_DELIVERY_MODE} requires MAILGUN_API_KEY, MAILGUN_DOMAIN and MAILGUN_API_BASE_URL.`,
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
    /**
     * Derived, never set: `local` writes under `.media/` on a developer's disk and `fake`
     * keeps objects in memory for tests, so neither environment needs a bucket; `r2` when
     * the five variables are all present, and `unconfigured` when a deployed environment has
     * not got them yet — the gallery then refuses uploads with a sentence and `/admin/tasks`
     * says what to create. Deriving it from the variables is what makes "is the bucket wired"
     * a fact the task board can read rather than a mode somebody remembers to flip.
     */
    STORAGE_MODE:
      value.APP_ENV === "local"
        ? ("local" as const)
        : value.APP_ENV === "test"
          ? ("fake" as const)
          : value.R2_ENDPOINT &&
              value.R2_ACCESS_KEY_ID &&
              value.R2_SECRET_ACCESS_KEY &&
              value.R2_BUCKET &&
              value.R2_PUBLIC_BASE_URL
            ? ("r2" as const)
            : ("unconfigured" as const),
  }));

export type Env = z.infer<typeof envSchema>;

export const env = envSchema.parse(process.env);
