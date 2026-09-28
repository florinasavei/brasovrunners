import { DEFAULT_CLUB_COORDINATES, parseCoordinates } from "@/modules/events/domain/sun";
import { isValidEmail } from "@/modules/participants/domain/canonical-email";
import { CLUB_NAME } from "@/theme/brand";
import { z } from "zod";
import { ALLOW_EVERY_RECIPIENT, APP_ENVIRONMENTS, EMAIL_DELIVERY_MODES, STAFF_AUTH_MODES, TRANSLATE_PROVIDERS } from "./env-enums";

// AGENTS.md §7.1: APP_ENV is the environment identity; NODE_ENV is not.
// AGENTS.md §8: APP_BASE_URL is the single source of every absolute URL the app emits.

/** Comma-separated addresses, parsed at startup so a malformed entry fails boot, named. */
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
     * Defaults to the port `yarn dev` starts on (`scripts/dev.mjs`, 47821). A trailing slash is
     * dropped once here, since call sites join it as `${env.APP_BASE_URL}${pathname}` (§8); a
     * path prefix is kept.
     */
    APP_BASE_URL: z
      .url()
      .default("http://localhost:47821")
      .transform((value) => value.replace(/\/+$/, "")),
    // Optional only until WEEKEND.md step 2 lands the first table; then it is required.
    DATABASE_URL: z.url().optional(),

    /**
     * How staff sign in (AGENTS.md §8, §13.1): `dev-switcher` (seeded identities, local and test
     * only), `provider` (Auth.js + Zitadel, gated on `staff_users`), or `disabled` (nobody can).
     * Optional: when unset it is derived per environment, below.
     */
    STAFF_AUTH_MODE: z.enum(STAFF_AUTH_MODES).optional(),

    // Auth.js (AGENTS.md §13.1). Required together when STAFF_AUTH_MODE=provider.
    AUTH_SECRET: z.string().min(1).optional(),
    AUTH_ZITADEL_ID: z.string().min(1).optional(),
    AUTH_ZITADEL_SECRET: z.string().min(1).optional(),
    AUTH_ZITADEL_ISSUER: z.url().optional(),
    /**
     * A Zitadel service user's token with `user.write` (`SETUP.md` §37): lets Echipa create the
     * account and send the invitation (`DECISIONS.md` §123). Without it only the row is added.
     */
    ZITADEL_MANAGEMENT_PAT: z.string().min(1).optional(),

    // Verifies job-endpoint callers (AGENTS.md §16.2) — a scheduler, not a staff session.
    JOB_SECRET: z.string().min(1).optional(),
    /** How often the day-time monitor pings the job endpoints, in minutes (§148): 15 on production, 60 on QA. */
    PINGER_CADENCE_MINUTES: z.coerce.number().int().min(1).max(240).default(15),

    // Reads Neon's usage, plan and quota (SETUP.md §33) and writes its limits (§335); a
    // project-scoped key covers both.
    NEON_API_KEY: z.string().min(1).optional(),
    NEON_PROJECT_ID: z.string().min(1).optional(),
    /**
     * Set by `playwright.config.ts`'s `webServer` only: blanks `NEON_API_KEY`/`NEON_PROJECT_ID`
     * (below) so the suite never calls Neon even when `.env.local` has real keys. Setting them to
     * `""` would not work: `min(1)` refuses an empty string.
     */
    E2E_DISABLE_NEON: z
      .string()
      .optional()
      .transform((value) => value === "true" || value === "1"),
    /**
     * Set by the e2e `webServer`: a fixed forecast instead of Open-Meteo, for a deterministic
     * page (§402). Ignored on production (`WEATHER_SOURCE`, below).
     */
    E2E_WEATHER_STUB: z
      .string()
      .optional()
      .transform((value) => value === "true" || value === "1"),
    /**
     * Set by the e2e `webServer` only (`DECISIONS.md` §403): the YouTube poster fetch
     * (`modules/media/video-poster.ts`) returns an in-process fixture instead of calling out,
     * which CI may not reach. Ignored on production (`e2eStubYoutubePoster`).
     */
    E2E_STUB_YOUTUBE_POSTER: z
      .string()
      .optional()
      .transform((value) => value === "true" || value === "1"),
    /**
     * Set by the e2e `webServer` only (§430): a miss in the `fake` store reads `.media/<key>`
     * from disk, read-only, so a spec can plant a legacy picture. Consulted only in `fake` mode.
     */
    E2E_FAKE_MEDIA_FROM_DISK: z
      .string()
      .optional()
      .transform((value) => value === "true" || value === "1"),
    /**
     * Set by the e2e `webServer` only: under `APP_ENV=test` the outbox is not drained after a
     * request (`notifications/drain.ts`); this makes the suite's server drain like `local`.
     */
    E2E_DRAIN_OUTBOX: z
      .string()
      .optional()
      .transform((value) => value === "true" || value === "1"),
    // Read-only, for `/devs`'s deployments and build minutes (§101); team id only on a team.
    VERCEL_API_TOKEN: z.string().min(1).optional(),
    VERCEL_PROJECT_ID: z.string().min(1).optional(),
    VERCEL_TEAM_ID: z.string().min(1).optional(),

    /**
     * The domain renewal reminder (§435): registration date `YYYY-MM-DD` plus the years paid
     * **in total** from it (three more after the first is `4`) give the expiry.
     */
    DOMAIN_REGISTERED_ON: z.preprocess((value) => (value === "" ? undefined : value), z.iso.date().optional()),
    DOMAIN_RENEWAL_YEARS: z.preprocess(
      (value) => (value === "" ? undefined : value),
      z.coerce.number().int().min(1).max(10).default(1),
    ),

    /** The real site, linked from the "this is not the real site" banner (§7.5); not `APP_BASE_URL`. */
    PRODUCTION_SITE_URL: z.url().optional(),

    /**
     * The club's profiles, for the footer and `sameAs` (BR-REQ-052-02 criterion 1).
     * Configuration because §8 forbids a hostname under `src/`; unset omits them entirely.
     */
    CLUB_FACEBOOK_URL: z.url().optional(),
    CLUB_INSTAGRAM_URL: z.url().optional(),
    CLUB_STRAVA_URL: z.url().optional(),

    /**
     * Where the club runs, "latitude,longitude" (§394): its sunset decides night events. Unset is
     * Brașov's centre; a malformed value fails at startup, named, as it would silently move every sunset.
     */
    CLUB_COORDINATES: z
      .string()
      .optional()
      .transform((value, ctx) => {
        if (value === undefined || value.trim() === "") return DEFAULT_CLUB_COORDINATES;
        const parsed = parseCoordinates(value);
        if (!parsed) {
          ctx.addIssue({ code: "custom", message: `CLUB_COORDINATES must be "latitude,longitude" in decimal degrees, e.g. "45.6427,25.5887"; got "${value}".` });
          return z.NEVER;
        }
        return parsed;
      }),

    /**
     * Cloudflare R2 for uploaded photos (AGENTS.md §17; `DECISIONS.md` §66; `SETUP.md` §32).
     * `R2_PUBLIC_BASE_URL` serves objects directly, never through a function. An incomplete set
     * means no gallery, not a failed boot (`STORAGE_MODE`, below).
     */
    R2_ENDPOINT: z.url().optional(),
    R2_ACCESS_KEY_ID: z.string().min(1).optional(),
    R2_SECRET_ACCESS_KEY: z.string().min(1).optional(),
    R2_BUCKET: z.string().min(1).optional(),
    R2_PUBLIC_BASE_URL: z.url().optional(),

    /** Cloudflare Turnstile (`DECISIONS.md` §97): both or neither; neither leaves the honeypot and timing check. */
    TURNSTILE_SITE_KEY: z.string().min(1).optional(),
    TURNSTILE_SECRET_KEY: z.string().min(1).optional(),

    /**
     * «Tradu din română» (`DECISIONS.md` §464, §497): `deepl` is live only once `DEEPL_API_KEY`
     * is set; `off` hides every button.
     */
    TRANSLATE_PROVIDER: z.enum(TRANSLATE_PROVIDERS).default("deepl"),
    DEEPL_API_KEY: z.string().trim().min(1).optional(),

    // AGENTS.md §7.2 and §16.4. Defaults to the mode that transmits nothing.
    /** Whether the form offers "appear publicly under another name" (§95); off unless `true`. */
    FEATURE_DISPLAY_NAME: z
      .string()
      .optional()
      .transform((value) => value === "true" || value === "1"),
    EMAIL_DELIVERY_MODE: z.enum(EMAIL_DELIVERY_MODES).default("capture"),
    EMAIL_ALLOWLIST: allowlist,
    MAILGUN_API_KEY: z.string().min(1).optional(),
    MAILGUN_DOMAIN: z.string().min(1).optional(),
    /** Mailgun's API base (US or EU region); configuration because of §8. */
    MAILGUN_API_BASE_URL: z.url().optional(),

    /**
     * The From line (AGENTS.md §8, §16.4). The address falls back to `noreply@<MAILGUN_DOMAIN>`;
     * the name to `CLUB_NAME` (§215, §357).
     */
    EMAIL_FROM_ADDRESS: z.email().optional(),
    EMAIL_FROM_NAME: z.string().min(1).max(120).default(CLUB_NAME),
    /** Absent, replies go to the From address — nowhere, for `noreply@`. */
    EMAIL_REPLY_TO: z.email().optional(),
    /**
     * The club's legal identity for the legal templates (`DECISIONS.md` §132). Environment, not
     * source: the repository is public and a registered seat is somebody's address.
     */
    CLUB_LEGAL_NAME: z.string().trim().min(1).max(200).optional(),
    CLUB_REGISTRATION_NUMBER: z.string().trim().min(1).max(60).optional(),
    CLUB_REGISTERED_ADDRESS: z.string().trim().min(1).max(300).optional(),
    /** When set, every signed declaration's PDF is also queued here as `DECLARATION_ARCHIVE` (`DECISIONS.md` §99). */
    DECLARATIONS_ARCHIVE_TO: z.email().optional(),
    /**
     * The contact form's SMTP (Gmail app password), outside the outbox and Mailgun (`DECISIONS.md`
     * §149). Not validated as a set: without it the page shows the address (`CONTACT_FORM_MODE`).
     * `CONTACT_FORM_TO` is only the fallback for the recipients set in the app (§164).
     */
    CONTACT_SMTP_HOST: z.string().trim().min(1).default("smtp.gmail.com"),
    CONTACT_SMTP_PORT: z.coerce.number().int().min(1).max(65_535).default(465),
    CONTACT_SMTP_USER: z.email().optional(),
    CONTACT_SMTP_PASSWORD: z.string().min(1).optional(),
    CONTACT_FORM_TO: allowlist,
    // Verifies inbound Mailgun webhooks (AGENTS.md §16.5); distinct from the outbound API key.
    MAILGUN_WEBHOOK_SIGNING_KEY: z.string().min(1).optional(),
  })
  /**
   * BR-REQ-080-03 criterion 3: an unsafe combination fails at startup, not at send time, when a
   * real person may already have been reached.
   */
  .superRefine((value, ctx) => {
    const { APP_ENV, EMAIL_DELIVERY_MODE, EMAIL_ALLOWLIST } = value;

    // The dev switcher hands staff authority to anyone: local and test only (AGENTS.md §13.1).
    if (value.STAFF_AUTH_MODE === "dev-switcher" && APP_ENV !== "local" && APP_ENV !== "test") {
      ctx.addIssue({
        code: "custom",
        path: ["STAFF_AUTH_MODE"],
        message: `the development staff switcher is only permitted when APP_ENV is local or test; this process has APP_ENV=${APP_ENV}. AGENTS.md §13.1, BR-REQ-060-01.`,
      });
    }

    // Otherwise a missing credential surfaces as a broken sign-in, not a failed boot.
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


    // Live delivery is production's alone — stated on `live`, so a new environment is refused by default.
    if (EMAIL_DELIVERY_MODE === "live" && APP_ENV !== "production") {
      ctx.addIssue({
        code: "custom",
        path: ["EMAIL_DELIVERY_MODE"],
        message: `live email delivery is only permitted when APP_ENV=production; this process has APP_ENV=${APP_ENV}. AGENTS.md §16.4, BR-REQ-080-03.`,
      });
    }

    // §7.1: local and test capture — not even allowlist, which still reaches a real inbox.
    if ((APP_ENV === "local" || APP_ENV === "test") && EMAIL_DELIVERY_MODE !== "capture") {
      ctx.addIssue({
        code: "custom",
        path: ["EMAIL_DELIVERY_MODE"],
        message: `APP_ENV=${APP_ENV} must capture email; ${EMAIL_DELIVERY_MODE} transmits. AGENTS.md §7.1, §16.4.`,
      });
    }

    // `*` (§163) is read only in allowlist mode; elsewhere it would mislead.
    if (EMAIL_ALLOWLIST.includes(ALLOW_EVERY_RECIPIENT) && EMAIL_DELIVERY_MODE !== "allowlist") {
      ctx.addIssue({
        code: "custom",
        path: ["EMAIL_ALLOWLIST"],
        message: 'EMAIL_ALLOWLIST="*" means "send to anyone" and is read only in allowlist mode. Remove it, or set EMAIL_DELIVERY_MODE=allowlist.',
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
      // `*` (§163) is not an address but must pass here; the rule above already scoped it.
      if (entry === ALLOW_EVERY_RECIPIENT) continue;
      if (!isValidEmail(entry)) {
        ctx.addIssue({
          code: "custom",
          path: ["EMAIL_ALLOWLIST"],
          // Operator configuration, not participant data, so naming it is safe.
          message: `EMAIL_ALLOWLIST entry is not a valid address: "${entry}".`,
        });
      }
    }

    // Operator configuration, so the bad entry is named.
    for (const entry of value.CONTACT_FORM_TO) {
      if (!isValidEmail(entry)) {
        ctx.addIssue({
          code: "custom",
          path: ["CONTACT_FORM_TO"],
          message: `CONTACT_FORM_TO entry is not a valid address: "${entry}".`,
        });
      }
    }

    // A transmitting mode needs credentials; fail at boot, not per message.
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

    // Deliberately absent: production is not required to be `live` (AGENTS.md §7.2 pairs them,
    // BR-REQ-080-01).
  })
  /**
   * Derived values. `STAFF_AUTH_MODE` defaults per environment (switcher in local/test,
   * `disabled` elsewhere), which a plain Zod default cannot do.
   */
  .transform((value) => {
    const neonSwitchedOff = e2eNeonSwitchOff(value);
    return {
      ...value,
      E2E_DISABLE_NEON: neonSwitchedOff,
      E2E_STUB_YOUTUBE_POSTER: e2eStubYoutubePoster(value),
      STAFF_AUTH_MODE:
        value.STAFF_AUTH_MODE ??
        (value.APP_ENV === "local" || value.APP_ENV === "test"
          ? ("dev-switcher" as const)
          : ("disabled" as const)),
      NEON_API_KEY: neonSwitchedOff ? undefined : value.NEON_API_KEY,
      NEON_PROJECT_ID: neonSwitchedOff ? undefined : value.NEON_PROJECT_ID,
      /**
       * `local` writes under `.media/`, `fake` is in memory; a deployment is `r2` with all five
       * variables, else `unconfigured` (uploads refused, `/admin/tasks` says what to create).
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
      /**
       * Local and test capture in memory (§149); a deployment is `smtp` with user and password,
       * else `off`. Whether anyone receives it is `contact/delivery.ts`'s question (§164).
       */
      CONTACT_FORM_MODE:
        value.APP_ENV === "local" || value.APP_ENV === "test"
          ? ("capture" as const)
          : value.CONTACT_SMTP_USER && value.CONTACT_SMTP_PASSWORD
            ? ("smtp" as const)
            : ("off" as const),
      /**
       * The forecast source (§402): `stub` for the e2e server (never production), `off` in unit
       * tests, `open-meteo` everywhere else.
       */
      WEATHER_SOURCE:
        value.E2E_WEATHER_STUB && value.APP_ENV !== "production"
          ? ("stub" as const)
          : value.APP_ENV === "test"
            ? ("off" as const)
            : ("open-meteo" as const),
    };
  });

/**
 * `E2E_DISABLE_NEON` takes effect everywhere but production, where it would silence the quota
 * alarm (§327, §335). Ignored with a warning rather than refused, so it cannot stop a boot.
 */
function e2eNeonSwitchOff(value: { E2E_DISABLE_NEON: boolean; APP_ENV: string }): boolean {
  if (!value.E2E_DISABLE_NEON) return false;
  if (value.APP_ENV === "production") {
    console.warn(
      "[env] E2E_DISABLE_NEON is set on production and is ignored: production always reads its Neon quota (the 80% warning on /api/health). Remove the variable from this environment.",
    );
    return false;
  }
  return true;
}

/** `E2E_STUB_YOUTUBE_POSTER` takes effect everywhere but production, like `e2eNeonSwitchOff`. */
function e2eStubYoutubePoster(value: { E2E_STUB_YOUTUBE_POSTER: boolean; APP_ENV: string }): boolean {
  if (!value.E2E_STUB_YOUTUBE_POSTER) return false;
  if (value.APP_ENV === "production") {
    console.warn(
      "[env] E2E_STUB_YOUTUBE_POSTER is set on production and is ignored: production always fetches the real poster. Remove the variable from this environment.",
    );
    return false;
  }
  return true;
}

export type Env = z.infer<typeof envSchema>;

export const env = envSchema.parse(process.env);
