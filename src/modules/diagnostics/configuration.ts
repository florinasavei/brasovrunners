/**
 * What this deployment is configured to do, and what it is one variable away from doing
 * (BR-REQ-090-04).
 *
 * The question this answers is the one that costs an afternoon: a build fails, or email
 * silently stops, and the message names a variable rather than a remedy. `env.ts` already
 * refuses an unsafe combination at startup — that is the guard, and it stays. This is the same
 * knowledge rendered *before* somebody trips over it: which mode each subsystem is in, what
 * that mode requires, and which of those requirements this deployment actually has.
 *
 * ## It cannot leak a value, by construction
 *
 * This module never receives one. `ConfigurationFacts` carries the *names* of variables and a
 * boolean for each, plus the handful of enums that are not secret — the environment, the
 * delivery mode, the auth mode. There is no code path here that could print a key, because no
 * key is ever passed in. That is deliberate and it is the whole reason this is a pure function
 * over a narrow input rather than a component that reads `env` directly: a page that had the
 * env object in scope would be one careless line away from rendering it.
 *
 * A pure function for the second reason too (AGENTS.md §1.5): every branch below is a rule
 * about configuration, and rules are tested without a browser or a deployment.
 */

export type AppEnvironment = "local" | "test" | "qa" | "production";
export type EmailDeliveryMode = "capture" | "allowlist" | "live";
export type StaffAuthMode = "dev-switcher" | "provider" | "disabled";

/** Every variable this report can speak about. Names only — never a value. */
export type ConfigurableVariable =
  | "MAILGUN_API_KEY"
  | "MAILGUN_DOMAIN"
  | "MAILGUN_API_BASE_URL"
  | "MAILGUN_WEBHOOK_SIGNING_KEY"
  | "EMAIL_FROM_ADDRESS"
  | "EMAIL_REPLY_TO"
  | "AUTH_SECRET"
  | "AUTH_ZITADEL_ID"
  | "AUTH_ZITADEL_SECRET"
  | "AUTH_ZITADEL_ISSUER"
  | "JOB_SECRET"
  | "MAP_LINK_BASE_URL"
  | "DATABASE_URL";

export type ConfigurationFacts = {
  appEnv: AppEnvironment;
  emailDeliveryMode: EmailDeliveryMode;
  staffAuthMode: StaffAuthMode | undefined;
  /** How many addresses `EMAIL_ALLOWLIST` parsed to. The addresses themselves stay out. */
  allowlistCount: number;
  /** Whether each variable has a non-empty value. Never the value. */
  present: Partial<Record<ConfigurableVariable, boolean>>;
};

export type CheckStatus =
  /** Configured coherently for what it is doing. */
  | "ok"
  /** Missing something its own mode requires — the process would refuse to start. */
  | "blocked"
  /** Working, but doing less than somebody probably expects. */
  | "limited";

export type ConfigurationCheck = {
  /** A message key under `Devs.checks`, so this module holds no user-facing prose. */
  key: string;
  status: CheckStatus;
  /** The mode or state this subsystem is in, as a bare token the page labels. */
  state: string;
  /** What this mode needs, and whether this deployment has it. */
  requires: Array<{ variable: ConfigurableVariable; present: boolean }>;
};

const has = (facts: ConfigurationFacts, variable: ConfigurableVariable): boolean =>
  facts.present[variable] === true;

function requirements(
  facts: ConfigurationFacts,
  variables: readonly ConfigurableVariable[],
): Array<{ variable: ConfigurableVariable; present: boolean }> {
  return variables.map((variable) => ({ variable, present: has(facts, variable) }));
}

/**
 * Email, which is where every configuration mistake so far has landed.
 *
 * `capture` needs nothing and transmits nothing — correct locally, and a deployed environment
 * in capture mode is *limited* rather than ok, because the messages go into a serverless
 * process's memory and are gone before anybody could read them. Somebody registering on that
 * deployment waits forever for a confirmation, which looks like a bug in registration.
 */
function emailCheck(facts: ConfigurationFacts): ConfigurationCheck {
  if (facts.emailDeliveryMode === "capture") {
    const deployed = facts.appEnv === "qa" || facts.appEnv === "production";
    return {
      key: deployed ? "emailCaptureDeployed" : "emailCaptureLocal",
      status: deployed ? "limited" : "ok",
      state: facts.emailDeliveryMode,
      requires: [],
    };
  }

  const needed = requirements(facts, [
    "MAILGUN_API_KEY",
    "MAILGUN_DOMAIN",
    "MAILGUN_API_BASE_URL",
  ]);
  const missing = needed.some((entry) => !entry.present);
  // An allowlist mode with nobody on the list transmits to nobody while looking like delivery,
  // which `env.ts` refuses outright. Reported here so it is visible before a deploy, not after.
  const emptyAllowlist = facts.emailDeliveryMode === "allowlist" && facts.allowlistCount === 0;

  return {
    key: facts.emailDeliveryMode === "allowlist" ? "emailAllowlist" : "emailLive",
    status: missing || emptyAllowlist ? "blocked" : "ok",
    state: facts.emailDeliveryMode,
    requires: needed,
  };
}

function staffAuthCheck(facts: ConfigurationFacts): ConfigurationCheck {
  if (facts.staffAuthMode === "provider") {
    const needed = requirements(facts, [
      "AUTH_SECRET",
      "AUTH_ZITADEL_ID",
      "AUTH_ZITADEL_SECRET",
      "AUTH_ZITADEL_ISSUER",
    ]);
    return {
      key: "staffProvider",
      status: needed.some((entry) => !entry.present) ? "blocked" : "ok",
      state: "provider",
      requires: needed,
    };
  }

  if (facts.staffAuthMode === "dev-switcher") {
    return { key: "staffDevSwitcher", status: "ok", state: "dev-switcher", requires: [] };
  }

  // Absent and `disabled` are the same thing to a visitor: every staff route answers 404.
  return { key: "staffDisabled", status: "limited", state: "disabled", requires: [] };
}

/**
 * The scheduled jobs, which are the only thing that drains the outbox or expires a hold.
 *
 * Without `JOB_SECRET` the endpoints refuse every caller, so nothing runs at all — and the
 * symptom is not an error anywhere, it is email that never arrives and holds that never lapse.
 */
function jobsCheck(facts: ConfigurationFacts): ConfigurationCheck {
  const needed = requirements(facts, ["JOB_SECRET"]);
  return {
    key: "jobs",
    status: needed[0].present ? "ok" : "blocked",
    state: needed[0].present ? "configured" : "unconfigured",
    requires: needed,
  };
}

/** The Mailgun webhook, which is how a bounce ever reaches the outbox row. */
function webhookCheck(facts: ConfigurationFacts): ConfigurationCheck {
  const needed = requirements(facts, ["MAILGUN_WEBHOOK_SIGNING_KEY"]);
  const transmitting = facts.emailDeliveryMode !== "capture";
  return {
    key: "webhook",
    // Only worth flagging where mail is actually going out; capture produces no bounces.
    status: needed[0].present ? "ok" : transmitting ? "limited" : "ok",
    state: needed[0].present ? "configured" : "unconfigured",
    requires: needed,
  };
}

/** Optional, and its absence is a documented behaviour rather than a fault (AGENTS.md §8). */
function mapCheck(facts: ConfigurationFacts): ConfigurationCheck {
  const needed = requirements(facts, ["MAP_LINK_BASE_URL"]);
  return {
    key: "mapLink",
    status: needed[0].present ? "ok" : "limited",
    state: needed[0].present ? "configured" : "unconfigured",
    requires: needed,
  };
}

export function describeConfiguration(facts: ConfigurationFacts): ConfigurationCheck[] {
  return [
    emailCheck(facts),
    staffAuthCheck(facts),
    jobsCheck(facts),
    webhookCheck(facts),
    mapCheck(facts),
  ];
}

/** Whether anything on this deployment is outright broken, for the page's headline. */
export function worstStatus(checks: readonly ConfigurationCheck[]): CheckStatus {
  if (checks.some((check) => check.status === "blocked")) return "blocked";
  if (checks.some((check) => check.status === "limited")) return "limited";
  return "ok";
}
