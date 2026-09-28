/**
 * The configuration enums, defined once (AGENTS.md §1.5, rule 3): `env.ts` validates against
 * them and `/devs` lists them. `as const` is load-bearing: `z.enum` needs a literal tuple.
 */

/** AGENTS.md §7.1 — the environment identity. `NODE_ENV` is not this. */
export const APP_ENVIRONMENTS = ["local", "test", "qa", "production"] as const;
export type AppEnvironment = (typeof APP_ENVIRONMENTS)[number];

/** AGENTS.md §16.4 — how much of a message actually leaves the process. */
export const EMAIL_DELIVERY_MODES = ["capture", "allowlist", "live"] as const;
export type EmailDeliveryMode = (typeof EMAIL_DELIVERY_MODES)[number];

/** AGENTS.md §13.1 — how a member of staff proves who they are, or that they cannot. */
export const STAFF_AUTH_MODES = ["dev-switcher", "provider", "disabled"] as const;
export type StaffAuthMode = (typeof STAFF_AUTH_MODES)[number];

/** «Tradu din română» (`DECISIONS.md` §464) — the translation engine, or none. */
export const TRANSLATE_PROVIDERS = ["deepl", "off"] as const;
export type TranslateProviderSetting = (typeof TRANSLATE_PROVIDERS)[number];

/**
 * The enums `/devs` shows, values only (never secrets). Each setting and value has its
 * explanation under `Devs.setting.*` in `messages/*.json` (§9.3).
 */
export const CONFIGURATION_ENUMS = [
  { variable: "APP_ENV", values: APP_ENVIRONMENTS },
  { variable: "EMAIL_DELIVERY_MODE", values: EMAIL_DELIVERY_MODES },
  { variable: "STAFF_AUTH_MODE", values: STAFF_AUTH_MODES },
] as const satisfies ReadonlyArray<{ variable: string; values: readonly string[] }>;

/**
 * The one `EMAIL_ALLOWLIST` entry that is not an address: every recipient (`DECISIONS.md` §163).
 * Here because the env schema and the delivery decision share it and neither may import the other.
 */
export const ALLOW_EVERY_RECIPIENT = "*";
