/**
 * The configuration enums, defined once (AGENTS.md §1.5, rule 3: one rule in one place).
 *
 * `env.ts` validates against these and `/devs` renders them, and before this file existed the
 * second list did not exist at all: the diagnostics page could show which mode a deployment was
 * in and had no way to say what the alternatives were. Somebody looking at
 * `EMAIL_DELIVERY_MODE=capture` and asking "what else could this be?" had to open the source.
 *
 * Keeping the two in step by hand is exactly the kind of drift that makes a diagnostics page
 * lie, and a diagnostics page that lies is worse than none — so `env.ts` builds its `z.enum`
 * from these arrays rather than repeating the values. Adding a mode here is the only edit.
 *
 * `as const` and `readonly` are load-bearing: `z.enum` needs a literal tuple to produce a
 * union type rather than `string`.
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

/**
 * What `/devs` renders, and the one place that says which enums are worth showing there.
 *
 * Values only — a mode name is not a secret and never becomes one. Nothing here reads `env`;
 * the page pairs this list with the current value it already holds.
 *
 * Every setting and every one of its values carries a message key, because a list of tokens
 * answers "what could this be?" and not "what would that do?", and the second question is the
 * one somebody has at two in the afternoon with a deployment behaving oddly. The prose lives
 * in `messages/*.json` under `Devs.setting.*`, not here — this module is imported by `env.ts`,
 * which runs before anything is translated, and §9.3 keeps user-facing strings out of code
 * regardless.
 */
export const CONFIGURATION_ENUMS = [
  { variable: "APP_ENV", values: APP_ENVIRONMENTS },
  { variable: "EMAIL_DELIVERY_MODE", values: EMAIL_DELIVERY_MODES },
  { variable: "STAFF_AUTH_MODE", values: STAFF_AUTH_MODES },
] as const satisfies ReadonlyArray<{ variable: string; values: readonly string[] }>;
