import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Chip from "@mui/material/Chip";
import Divider from "@mui/material/Divider";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import type { Metadata } from "next";
import { hasLocale } from "next-intl";
import { getFormatter, getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { getDb } from "@/db/client";
import { checkSchemaVersion } from "@/db/schema-version";
import { routing } from "@/i18n/routing";
import {
  type ConfigurationFacts,
  describeConfiguration,
  worstStatus,
} from "@/modules/diagnostics/configuration";
import { resolveContactRecipients } from "@/modules/contact/domain/recipients";
import { readContactRecipients } from "@/modules/contact/recipients";
import { checkJobHealth } from "@/modules/jobs/health";
import { readJobCadence } from "@/modules/jobs/cadence";
import { describeJob } from "@/modules/jobs/overview";
import { type JobName, NEXT_DUE_CAP_MINUTES } from "@/modules/jobs/schedule";
import { countMediaAssets, ORPHAN_ASSET_DAYS } from "@/modules/media/references";
import { readDatabaseSizeBytes } from "@/modules/diagnostics/database-size";
import { REPO_DOCS } from "@/modules/diagnostics/repo-docs";
import { checkEmailHealth } from "@/modules/notifications/health";
import { readEmailVolumeToday } from "@/modules/notifications/volume";
import { readNeonConsumption } from "@/modules/diagnostics/neon";
import { readNeonPlan } from "@/modules/diagnostics/neon-plan";
import { describeNeonBlock, NEON_PLANS, NEON_PLANS_CHECKED_ON } from "@/modules/diagnostics/domain/neon-plan";
import { readVercelMonth, VERCEL_HOBBY_BUILD_MINUTES_PER_MONTH, VERCEL_HOBBY_DEPLOYMENTS_PER_DAY } from "@/modules/diagnostics/vercel";
import { OPERATIONAL_LIMITS } from "@/modules/diagnostics/platform-plans";
import MuiLink from "@mui/material/Link";
import { getPathname, Link } from "@/i18n/navigation";
import { RATE_LIMITS } from "@/modules/rate-limit/service";
import { canManageRegistrations, canSeeDiagnostics, STAFF_ROLES } from "@/modules/staff-identity/domain/roles";
import SubNav from "@/shared/ui/SubNav";
import { STAFF_ROLE_LABEL } from "@/modules/staff-identity/domain/staff-labels";
import { requireStaff } from "@/modules/staff-identity/session";
import { buildInfo, formatLastUpdated, formatVersion } from "@/shared/config/build-info";
import { CONFIGURATION_ENUMS } from "@/shared/config/env-enums";
import { env } from "@/shared/config/env";
import { capturedEmails } from "@/infrastructure/email/sender";
import { capturedContactMessages } from "@/modules/contact/delivery";

type Props = {
  params: Promise<{ locale: string }>;
  /** Which panel to show (§265); anything else is the first one. */
  searchParams: Promise<Record<string, string | undefined>>;
};

/**
 * The panels this page is divided into (§265; the owner: "partea de configurare ar trebui să
 * aibă subtaburi, pt status, general, mailuri, captcha, etc").
 *
 * Six hundred lines was one scroll from "is it working" past Neon's compute hours to the roles
 * table. Three panels, in the order somebody arrives with a question:
 *
 * - `status` — is it working: the verdict, the database and the jobs, Neon's month, Vercel's
 *   month, what each limit does when it is met, and the runtime.
 * - `general` — how it is set up: which variables are present (never a value, §8), the rate
 *   limits, what each setting can be, and who may do what.
 * - `email` — the club's mail: today's volume against the plan, and what was captured locally.
 *
 * A query parameter rather than three routes, because every panel needs the same session and the
 * same `env`: three routes would be three copies of this page's head, which is where the
 * secret-free mapping of `env` lives and the last place worth duplicating.
 */
const DEVS_PANELS = ["status", "general", "email"] as const;
type DevsPanel = (typeof DEVS_PANELS)[number];

/** Reads the session and the live configuration; never cached, never prerendered. */
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  robots: { index: false, follow: false, nocache: true },
};

/**
 * `/devs` — what this deployment is configured to do (BR-REQ-090-04).
 *
 * It exists because the failure mode it prevents is expensive and undignified: a build refuses
 * with a message naming a variable, or email silently stops, and answering "what is actually
 * set here" means a maintainer opening the hosting dashboard while somebody waits. `/api/health`
 * already answers the machine's version of this question; this is the person's version, and it
 * adds the half health cannot see — whether the *configuration* is coherent, as opposed to
 * whether the process that already started is alive.
 *
 * ## What it does not show, and cannot
 *
 * Any value. The page maps `env` to a set of booleans before anything is rendered, and
 * `describeConfiguration` receives only those booleans and the three non-secret enums. There is
 * no code path from a secret to this markup — not "we are careful here", but "the value is not
 * in scope". AGENTS.md §14.5 and §8.
 *
 * Administrator only, asserted on the server (BR-REQ-060-01). Knowing which variables a
 * deployment is missing is a map of where to push on it, so this is not an Editor's screen, and
 * a role that may not see it gets the 404 a non-existent route would give rather than a refusal
 * that confirms it is there.
 */
export default async function DevsPage({ params, searchParams }: Props) {
  const { locale } = await params;
  const requested = (await searchParams).panel;
  const panel: DevsPanel = DEVS_PANELS.includes(requested as DevsPanel)
    ? (requested as DevsPanel)
    : "status";
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);

  const actor = await requireStaff();
  if (!canSeeDiagnostics(actor.role)) notFound();

  const t = await getTranslations("Devs");
  const format = await getFormatter();
  const now = new Date();
  const neon = await readNeonConsumption(env);
  // This month's deployments and build minutes (§101): the two Hobby ceilings a token can read.
  const vercel = await readVercelMonth(env, now);

  /**
   * The whole of the secret handling on this page: presence, computed here, values discarded.
   *
   * `Boolean(...)` rather than passing `env` through, so the report below is structurally
   * incapable of printing a key even if somebody later adds a field to it.
   */
  const facts: ConfigurationFacts = {
    appEnv: env.APP_ENV,
    emailDeliveryMode: env.EMAIL_DELIVERY_MODE,
    staffAuthMode: env.STAFF_AUTH_MODE,
    contactFormMode: env.CONTACT_FORM_MODE,
    // Where the recipients come from (§164) — the source, never an address.
    contactRecipientsSource: resolveContactRecipients(await readContactRecipients(getDb()), env.CONTACT_FORM_TO).source,
    allowlistCount: env.EMAIL_ALLOWLIST.length,
    present: {
      MAILGUN_API_KEY: Boolean(env.MAILGUN_API_KEY),
      MAILGUN_DOMAIN: Boolean(env.MAILGUN_DOMAIN),
      MAILGUN_API_BASE_URL: Boolean(env.MAILGUN_API_BASE_URL),
      MAILGUN_WEBHOOK_SIGNING_KEY: Boolean(env.MAILGUN_WEBHOOK_SIGNING_KEY),
      EMAIL_FROM_ADDRESS: Boolean(env.EMAIL_FROM_ADDRESS),
      EMAIL_REPLY_TO: Boolean(env.EMAIL_REPLY_TO),
      AUTH_SECRET: Boolean(env.AUTH_SECRET),
      AUTH_ZITADEL_ID: Boolean(env.AUTH_ZITADEL_ID),
      AUTH_ZITADEL_SECRET: Boolean(env.AUTH_ZITADEL_SECRET),
      AUTH_ZITADEL_ISSUER: Boolean(env.AUTH_ZITADEL_ISSUER),
      JOB_SECRET: Boolean(env.JOB_SECRET),
      DATABASE_URL: Boolean(env.DATABASE_URL),
      NEON_API_KEY: Boolean(env.NEON_API_KEY),
      CONTACT_SMTP_USER: Boolean(env.CONTACT_SMTP_USER),
      CONTACT_SMTP_PASSWORD: Boolean(env.CONTACT_SMTP_PASSWORD),
      CONTACT_FORM_TO: env.CONTACT_FORM_TO.length > 0,
    },
  };

  const checks = describeConfiguration(facts);
  const overall = worstStatus(checks);

  const db = getDb();
  const schema = await checkSchemaVersion(db);
  const jobs = await Promise.all(
    ["registration-maintenance", "email-outbox"].map((jobName) =>
      checkJobHealth(db, jobName, now),
    ),
  );
  /*
    What the pings will do (§NNN): the cached "nothing due until" or the minimum interval, and the
    last ping and whether it woke the database — from the cache, beside the last real run from
    `job_runs` above.
  */
  const jobCadence = await readJobCadence(db);
  const jobSchedules = await Promise.all(
    jobs.map((job) =>
      describeJob(db, { job: job.jobName as JobName, now, cadenceMinutes: jobCadence.minutes, lastFinishedAt: job.lastFinishedAt }),
    ),
  );
  const volume = await readEmailVolumeToday(db, now);
  const emailHealth = await checkEmailHealth(db, now);
  const pictures = await countMediaAssets(db, now);
  const databaseBytes = await readDatabaseSizeBytes(db);
  /**
   * The Neon plan the club says it is on (§280's follow-up), and the month read against it:
   * Free's ceilings and the red past eighty percent, or Launch's estimate at the catalogue's
   * rates and no ceiling at all. Set on `/admin/tasks` → Costuri; this page reads it and, for
   * a reader who may open that screen, links to it.
   */
  const neonPlan = await readNeonPlan(db);
  const neonBlock = describeNeonBlock({ plan: neonPlan.plan, databaseBytes, consumption: neon.ok ? neon.consumption : null, now });
  const usd = (value: number) => format.number(value, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const rate = (value: number) => format.number(value, { maximumFractionDigits: 3 });

  /** The value each configuration enum currently holds, for marking it in the list below. */
  const currentSetting: Record<string, string> = {
    APP_ENV: env.APP_ENV,
    EMAIL_DELIVERY_MODE: env.EMAIL_DELIVERY_MODE,
    STAFF_AUTH_MODE: env.STAFF_AUTH_MODE ?? "disabled",
    FEATURE_DISPLAY_NAME: env.FEATURE_DISPLAY_NAME ? "true" : "false",
    TURNSTILE: env.TURNSTILE_SITE_KEY && env.TURNSTILE_SECRET_KEY ? "on" : "off",
    // On when the club named a mailbox on /admin/emails, or the deployment did (§244).
    DECLARATIONS_ARCHIVE: volume.archiveConfigured ? "on" : "off",
  };

  // Built here, because `getPathname` is a server function and the sub-nav takes strings (§265).
  const devsPath = getPathname({ locale, href: "/devs" });
  const tasksPath = getPathname({ locale, href: "/admin/tasks" });

  const severity = (status: string) =>
    status === "blocked" ? "error" : status === "limited" ? "warning" : "success";

  return (
    <Stack spacing={4} sx={{ maxWidth: 900 }}>
      <Box>
        {/* Under the backoffice's own title and tabs (§119): a section heading, like the others. */}
        <Typography variant="h2" sx={{ fontSize: "1.25rem" }}>
          {t("title")}
        </Typography>
        <Typography variant="body2" color="text.secondary">
          {t("intro")}
        </Typography>
      </Box>

      {panel === "email" && (
        <>
        {/* Locally nothing is sent: the messages land here, with their links, so the participant
            journey can be clicked through (§124). Never off local or test — a captured message
            carries a live token. */}
        {(env.APP_ENV === "local" || env.APP_ENV === "test") && (
          <Box component="section">
            <Typography variant="h2" sx={{ fontSize: "1.25rem", mb: 1 }}>
              {t("captured.title")}
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
              {t("captured.intro")}
            </Typography>
            {capturedEmails().length === 0 ? (
              <Typography variant="body2" color="text.secondary">
                {t("captured.empty")}
              </Typography>
            ) : (
              <Stack spacing={1.5}>
                {capturedEmails().map((message) => (
                  <Box key={message.providerMessageId} sx={{ border: 1, borderColor: "divider", borderRadius: 1, p: 1.5 }}>
                    <Typography variant="body2" sx={{ fontWeight: 600 }}>
                      {message.subject}
                    </Typography>
                    <Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 0.5 }}>
                      {message.to} · {format.dateTime(message.capturedAt, { dateStyle: "short", timeStyle: "short", hourCycle: "h23" })}
                    </Typography>
                    <Stack spacing={0.25}>
                      {[...new Set(message.text.match(/https?:\/\/\S+/g) ?? [])].map((link) => (
                        <MuiLink key={link} href={link} sx={{ fontSize: "0.8125rem", wordBreak: "break-all", display: "inline-flex", minHeight: 32, alignItems: "center" }}>
                          {link}
                        </MuiLink>
                      ))}
                    </Stack>
                  </Box>
                ))}
              </Stack>
            )}

            {/* The contact form's messages (§149): the same capture, a different mailbox — the club's. */}
            {capturedContactMessages().length > 0 && (
              <Stack spacing={1.5} sx={{ mt: 2 }}>
                <Typography variant="body2" color="text.secondary">
                  {t("captured.contact")}
                </Typography>
                {capturedContactMessages().map((message) => (
                  <Box key={message.providerMessageId} sx={{ border: 1, borderColor: "divider", borderRadius: 1, p: 1.5 }}>
                    <Typography variant="body2" sx={{ fontWeight: 600 }}>
                      {message.subject}
                    </Typography>
                    <Typography variant="caption" color="text.secondary" sx={{ display: "block" }}>
                      {message.to.join(", ")} · Reply-To {message.replyTo.address} ·{" "}
                      {format.dateTime(message.capturedAt, { dateStyle: "short", timeStyle: "short", hourCycle: "h23" })}
                    </Typography>
                  </Box>
                ))}
              </Stack>
            )}
          </Box>
        )}

        </>
      )}
      {/*
        The panels (§265), and the anti-bot switch beside them: that switch belongs to the club's
        own to-do screen (§254), where the club works, and "where do I turn the captcha off" is a
        configuration question wherever the answer is kept.
      */}
      <SubNav
        items={[
          ...DEVS_PANELS.map((name) => ({
            href: name === "status" ? devsPath : `${devsPath}?panel=${name}`,
            label: t(`panel.${name}`),
            active: panel === name,
          })),
          { href: `${tasksPath}?panel=botCheck`, label: t("panel.botCheck") },
        ]}
      />

      {/* Which deployment, and which build. The commonest confusion is not "what is wrong" but
          "which of these two identical-looking systems am I even looking at". */}
      <Stack direction="row" spacing={1} sx={{ flexWrap: "wrap", gap: 1 }}>
        <Chip color="primary" label={`${t("environment")}: ${env.APP_ENV}`} />
        <Chip variant="outlined" label={formatVersion()} />
        <Chip variant="outlined" label={formatLastUpdated(locale) ?? t("buildUnknown")} />
        {buildInfo.commit && <Chip variant="outlined" label={buildInfo.commit} />}
      </Stack>

      <Alert severity={severity(overall)}>{t(`overall.${overall}`)}</Alert>

      {panel === "general" && (
        <>
        <Box component="section">
          <Typography variant="h2" sx={{ fontSize: "1.25rem", mb: 1 }}>
            {t("configuration")}
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            {t("neverValues")}
          </Typography>

          <Stack spacing={2}>
            {checks.map((check) => (
              <Box
                key={check.key}
                sx={{ border: 1, borderColor: "divider", borderRadius: 1, p: 2 }}
              >
                <Stack direction="row" spacing={1} sx={{ mb: 1, flexWrap: "wrap", gap: 1 }}>
                  <Chip size="small" color={severity(check.status)} label={t(`status.${check.status}`)} />
                  <Typography variant="subtitle2" sx={{ alignSelf: "center" }}>
                    {t(`checks.${check.key}.title`)}
                  </Typography>
                  <Chip size="small" variant="outlined" label={check.state} />
                </Stack>

                <Typography variant="body2" sx={{ mb: check.requires.length > 0 ? 1 : 0 }}>
                  {t(`checks.${check.key}.body`)}
                </Typography>

                {check.requires.length > 0 && (
                  <Stack component="ul" spacing={0.5} sx={{ listStyle: "none", p: 0, m: 0 }}>
                    {check.requires.map((requirement) => (
                      <Typography
                        component="li"
                        variant="body2"
                        key={requirement.variable}
                        color={requirement.present ? "text.secondary" : "error.main"}
                        sx={{ fontFamily: "monospace", fontSize: "0.8125rem" }}
                      >
                        {requirement.present ? "✓" : "✗"} {requirement.variable}
                      </Typography>
                    ))}
                  </Stack>
                )}
              </Box>
            ))}
          </Stack>
        </Box>

        <Divider />

        {/*
          The throttle in force, read from the policy itself rather than restated. A limit somebody
          is hitting is the commonest "the site is broken" that is not broken, and the numbers are
          the first thing to look at when a registration window is busy.
        */}
        <Box component="section">
          <Typography variant="h2" sx={{ fontSize: "1.25rem", mb: 1 }}>
            {t("rateLimits")}
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            {t("rateLimitsIntro")}
          </Typography>
          <Stack spacing={1}>
            {Object.entries(RATE_LIMITS).map(([scope, policy]) => (
              <Typography variant="body2" key={scope} sx={{ fontFamily: "monospace", fontSize: "0.8125rem" }}>
                {scope}: {policy.limit} / {Math.round(policy.windowMs / 60_000)} min
              </Typography>
            ))}
          </Stack>
        </Box>

        <Divider />

        {/*
          Every value each configuration enum accepts, with the one in force marked. The page
          could always say which mode this deployment was in and never what the alternatives
          were, so "what else could this be set to?" meant opening the source. The list comes
          from `shared/config/env-enums.ts`, which is also what `env.ts` validates against, so
          it cannot drift from what the process would actually accept.
        */}
        <Box component="section">
          <Typography variant="h2" sx={{ fontSize: "1.25rem", mb: 1 }}>
            {t("settings")}
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            {t("settingsIntro")}
          </Typography>
          <Stack spacing={3}>
            {CONFIGURATION_ENUMS.map(({ variable, values }) => (
              <Box key={variable} sx={{ border: 1, borderColor: "divider", borderRadius: 1, p: 2 }}>
                <Typography
                  variant="subtitle2"
                  sx={{ fontFamily: "monospace", fontSize: "0.8125rem" }}
                >
                  {variable}
                </Typography>
                {/* What the setting is for, before what its values are. */}
                <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
                  {t(`setting.${variable}.what`)}
                </Typography>

                {/* One row per value: the token, whether it is the one in force, and what it
                    does. A list of bare tokens says what this could be set to and not what
                    setting it would mean, which is the question somebody actually has. */}
                <Stack component="ul" spacing={1} sx={{ listStyle: "none", p: 0, m: 0 }}>
                  {values.map((value) => {
                    const active = currentSetting[variable] === value;
                    return (
                      <Stack
                        component="li"
                        key={value}
                        direction={{ xs: "column", sm: "row" }}
                        spacing={{ xs: 0.5, sm: 1.5 }}
                        sx={{ alignItems: { sm: "baseline" } }}
                      >
                        <Chip
                          size="small"
                          label={active ? `${value} · ${t("inUse")}` : value}
                          color={active ? "primary" : "default"}
                          variant={active ? "filled" : "outlined"}
                          sx={{ flexShrink: 0 }}
                        />
                        <Typography
                          variant="body2"
                          color={active ? "text.primary" : "text.secondary"}
                        >
                          {t(`setting.${variable}.values.${value}`)}
                        </Typography>
                      </Stack>
                    );
                  })}
                </Stack>
              </Box>
            ))}
          </Stack>
        </Box>

        <Divider />
        </>
      )}

      {panel === "email" && (
        <>
        {/*
          The arithmetic of `docs/PLATFORM.md` limit 1, done here so nobody has to do it by hand
          on the morning it matters: four messages per completed registration (the reminder since §81) against a daily
          allowance of a hundred. Test registrations are counted, and counted separately — §12.6
          keeps them out of every count the *club* is given, and this is an operator's forecast
          of what will reach the provider, which a synthetic participant consumes just the same.
        */}
        <Box component="section">
          <Typography variant="h2" sx={{ fontSize: "1.25rem", mb: 1 }}>
            {t("emailVolume")}
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            {t("emailVolumeIntro")}
          </Typography>
          <Alert
            severity={
              volume.remaining === 0
                ? "error"
                : volume.remaining !== null && volume.projectedMessages > volume.remaining
                  ? "warning"
                  : "success"
            }
            sx={{ mb: 2 }}
          >
            {t(`emailVolumeHeadroom.${volume.period}`, {
              remaining: volume.remaining ?? "",
              allowance: volume.allowance ?? "",
              plan: volume.planName,
            })}
          </Alert>
          {/* The stall the monitors are told about (§98): `/api/health` answers 503 while it lasts. */}
          <Alert severity={emailHealth.status === "stalled" ? "error" : "success"} sx={{ mb: 2 }}>
            {t(`emailHealth.${emailHealth.status}`, {
              deferred: emailHealth.deferred,
              overdue: emailHealth.overdue,
              failed: emailHealth.failed,
              reason: emailHealth.lastError ?? "—",
            })}
          </Alert>
          <Stack spacing={0.5}>
            <Typography variant="body2">
              {t("registrationsToday")}: <strong>{volume.realRegistrations}</strong>
              {volume.testRegistrations > 0
                ? ` (+${volume.testRegistrations} ${t("testRegistrations")})`
                : ""}
            </Typography>
            <Typography variant="body2">
              {t("projectedMessages")}: <strong>{volume.projectedMessages}</strong>
            </Typography>
            <Typography variant="body2">
              {t("queuedMessages")}: <strong>{volume.queuedMessages}</strong>
            </Typography>
            <Typography variant="body2">
              {t("sentMessages")}: <strong>{volume.sentMessages}</strong>
              {volume.period === "day" ? ` / ${volume.allowance}` : ""} · {t("sentThisMonth")}: <strong>{volume.sentThisMonth}</strong>
              {volume.period === "month" ? ` / ${volume.allowance}` : ""} · {t("emailPlanLabel")}: <strong>{volume.planName}</strong>
            </Typography>
          </Stack>
        </Box>

        <Divider />
        </>
      )}

      {panel === "status" && (
        <>
        {/*
          The database's month, from Neon itself (BR-REQ-090-07), read against the plan the club
          says it is on. On Free it is the one figure whose exhaustion takes the site down; on
          Launch it is the bill — and the pinger cadence drives both (`DECISIONS.md` §68, §280).
        */}
        <Box component="section" data-testid="neon-block">
          <Typography variant="h2" sx={{ fontSize: "1.25rem", mb: 1 }}>
            {t("neon.title")}
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
            {neonBlock.plan === "LAUNCH" ? t("neon.introLaunch", { checkedOn: NEON_PLANS_CHECKED_ON }) : t("neon.intro", { of: NEON_PLANS.FREE.cuHoursPerMonth ?? 0 })}
          </Typography>
          {/* Which plan the figures are read against, and where it is set: a link for a reader who may open that screen, a sentence for the rest. */}
          <Typography variant="body2" sx={{ mb: 2 }} data-testid="neon-plan-sentence">
            {t(`neon.plan.${neonBlock.plan}`)}{" "}
            {canManageRegistrations(actor.role) ? (
              <Link href={{ pathname: "/admin/tasks", query: { panel: "costs" } }}>{t("neon.planLink")}</Link>
            ) : (
              t("neon.planSetBy")
            )}
          </Typography>
          {/* Storage, from the database itself (§88): no key needed. Against Free's half gigabyte, or at Launch's rate. */}
          <Typography variant="body1" sx={{ fontWeight: 600, mb: 1 }} color={neonBlock.storage.warn ? "error.main" : "text.primary"}>
            {neonBlock.storage.usedMb === null
              ? t("neon.sizeUnknown")
              : neonBlock.plan === "LAUNCH"
                ? t("neon.sizeLaunch", {
                    used: neonBlock.storage.usedMb,
                    storageRate: rate(neonBlock.rates?.usdPerGbMonth ?? 0),
                    // A club database is megabytes: under a cent a month, said as "under" rather than as a zero.
                    usd: (neonBlock.storage.estimatedUsdPerMonth ?? 0) === 0 ? `< ${usd(0.01)}` : usd(neonBlock.storage.estimatedUsdPerMonth ?? 0),
                  })
                : t("neon.size", {
                    used: neonBlock.storage.usedMb,
                    of: neonBlock.storage.ceilingMb ?? 0,
                    percent: neonBlock.storage.percent ?? 0,
                  })}
          </Typography>
          {!neon.ok ? (
            <Alert severity={neon.reason === "unconfigured" ? "info" : "warning"}>
              {neon.reason === "unconfigured" ? t("neon.unavailable") : t("neon.failed", { reason: neon.reason })}
            </Alert>
          ) : neonBlock.compute && (
            <Stack spacing={0.5}>
              {/* Red past eighty percent of a ceiling; on Launch there is none, so it never is. */}
              <Typography variant="body1" sx={{ fontWeight: 600 }} color={neonBlock.compute.warn ? "error.main" : "text.primary"}>
                {neonBlock.plan === "LAUNCH"
                  ? t("neon.usedLaunch", {
                      used: neonBlock.compute.cuHours.toFixed(1),
                      usd: usd(neonBlock.compute.estimatedUsd ?? 0),
                      rate: rate(neonBlock.rates?.usdPerCuHour ?? 0),
                    })
                  : t("neon.used", {
                      used: neonBlock.compute.cuHours.toFixed(1),
                      of: neonBlock.compute.ceilingCuHours ?? 0,
                      percent: neonBlock.compute.percent ?? 0,
                    })}
              </Typography>
              {/* On both plans: what keeps the compute awake is what explains the hours, and the bill. */}
              <Typography variant="body2">
                {t("neon.awake", {
                  hours: Math.round(neonBlock.compute.activeHours),
                  elapsed: Math.round(neonBlock.compute.elapsedHours),
                })}
              </Typography>
              <Typography variant="body2" color="text.secondary">
                {t("neon.period", { date: format.dateTime(neonBlock.compute.periodEnd, { dateStyle: "long" }) })}
              </Typography>
              {neonBlock.plan === "LAUNCH" && (
                <Typography variant="body2" color="text.secondary">
                  {t("neon.estimate", { restoreRate: rate(neonBlock.rates?.restoreUsdPerGbMonth ?? 0) })}
                </Typography>
              )}
            </Stack>
          )}
          {/*
            Hosting (the owner: "as a dev I should also see the DB usage and Vercel usage"). Vercel
            publishes no usage figure to a Hobby project's own code, so this is what the platform
            injects about the running deployment, and the one link to the usage dashboard.
          */}
          <Typography variant="h3" sx={{ fontSize: "1rem", mt: 3, mb: 1 }}>
            {t("vercel.title")}
          </Typography>
          {process.env.VERCEL ? (
            <Stack spacing={0.25} sx={{ mb: 1 }}>
              <Typography variant="body2">
                {t("vercel.deployment", {
                  env: process.env.VERCEL_ENV ?? "?",
                  region: process.env.VERCEL_REGION ?? "?",
                  commit: (process.env.VERCEL_GIT_COMMIT_SHA ?? "").slice(0, 7) || "?",
                  branch: process.env.VERCEL_GIT_COMMIT_REF ?? "?",
                })}
              </Typography>
              <Typography variant="body2" color="text.secondary">
                {t("vercel.id", { id: process.env.VERCEL_DEPLOYMENT_ID ?? "?" })}
              </Typography>
            </Stack>
          ) : (
            <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
              {t("vercel.notOnVercel")}
            </Typography>
          )}
          {vercel.ok ? (
            <Alert
              severity={
                vercel.month.buildMinutes >= VERCEL_HOBBY_BUILD_MINUTES_PER_MONTH * 0.8 ||
                vercel.month.deploymentsToday >= VERCEL_HOBBY_DEPLOYMENTS_PER_DAY * 0.8
                  ? "warning"
                  : "success"
              }
              sx={{ mb: 1 }}
            >
              {t("vercel.month", {
                deployments: vercel.month.deployments,
                today: vercel.month.deploymentsToday,
                perDay: VERCEL_HOBBY_DEPLOYMENTS_PER_DAY,
                minutes: Math.round(vercel.month.buildMinutes),
                of: VERCEL_HOBBY_BUILD_MINUTES_PER_MONTH,
                percent: Math.round((vercel.month.buildMinutes / VERCEL_HOBBY_BUILD_MINUTES_PER_MONTH) * 100),
                errored: vercel.month.errored,
              })}
            </Alert>
          ) : (
            <Alert severity={vercel.reason === "unconfigured" ? "info" : "warning"} sx={{ mb: 1 }}>
              {vercel.reason === "unconfigured" ? t("vercel.unavailable") : t("vercel.failed", { reason: vercel.reason })}
            </Alert>
          )}
          <Typography variant="body2" color="text.secondary">
            {t("vercel.notInApi")} {t("neon.vercel")}{" "}
            <MuiLink href="https://vercel.com/dashboard/usage" target="_blank" rel="noopener noreferrer">
              {t("vercel.usageLink")}
            </MuiLink>
          </Typography>
          <Typography variant="body2" sx={{ mt: 2 }}>
            <Link href="/devs/theme">{t("theme.link")}</Link>
          </Typography>
          {/* The repository's documents, readable here (§88): the runbook, the setup, the decisions. */}
          <Typography variant="body2" sx={{ mt: 1 }}>
            {t("docs.title")}:{" "}
            {REPO_DOCS.map((doc, index) => (
              <span key={doc.name}>
                {index > 0 ? " · " : ""}
                <Link href={{ pathname: "/devs/docs/[name]", params: { name: doc.name } }}>{doc.name}</Link>
              </span>
            ))}
          </Typography>
        </Box>

        <Divider />

        {/*
          What each plan limit does when it is met, and who enforces it — the operational half of
          the platform inventory. The money half (what a plan costs, what the next one costs, what
          the club has not decided) lives on `/admin/tasks`, for the people who pay for it, and is
          deliberately absent here: one figure rendered in two places is one figure that will
          disagree with itself.
        */}
        <Box component="section">
          <Typography variant="h2" sx={{ fontSize: "1.25rem", mb: 1 }}>
            {t("operationalTitle")}
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            {t("operationalIntro")}
          </Typography>
          <Stack spacing={2} component="ul" sx={{ listStyle: "none", m: 0, p: 0 }}>
            {OPERATIONAL_LIMITS.map((limit) => (
              <Box
                component="li"
                key={limit.id}
                sx={{ border: 1, borderColor: "divider", borderRadius: 1, p: 2 }}
              >
                <Stack direction="row" spacing={1} sx={{ mb: 1, flexWrap: "wrap", gap: 1 }}>
                  {/* Who stops you decides what you can do about it: a provider limit is bought
                      or waited out, an application limit is a line of code with an owner. */}
                  <Chip size="small" variant="outlined" label={t(`enforcedBy.${limit.enforcedBy}`)} />
                  {limit.variable && (
                    <Chip
                      size="small"
                      variant="outlined"
                      label={limit.variable}
                      sx={{ fontFamily: "monospace" }}
                    />
                  )}
                </Stack>
                <Typography variant="subtitle2" sx={{ mb: 0.5 }}>
                  {t(`operational.${limit.id}.title`)}
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  {t(`operational.${limit.id}.body`)}
                </Typography>
              </Box>
            ))}
          </Stack>
        </Box>

        <Divider />
        </>
      )}

      {panel === "general" && (
        <>
        {/* Who can see and do what, from the one place the hierarchy is written. */}
        <Box component="section">
          <Typography variant="h2" sx={{ fontSize: "1.25rem", mb: 1 }}>
            {t("roles")}
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            {t("rolesIntro")}
          </Typography>
          <Stack spacing={0.5}>
            {STAFF_ROLES.map((role) => (
              <Typography variant="body2" key={role}>
                <strong>{STAFF_ROLE_LABEL[role]}</strong> · {t(`roleSummary.${role}`)}
                {role === actor.role ? ` — ${t("youAre")}` : ""}
              </Typography>
            ))}
          </Stack>
        </Box>

        <Divider />
        </>
      )}

      {panel === "status" && (
        <>
        <Box component="section">
          <Typography variant="h2" sx={{ fontSize: "1.25rem", mb: 1 }}>
            {t("runtime")}
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            {t("runtimeIntro")}
          </Typography>

          <Stack spacing={1}>
            <Typography variant="body2">
              {t("schema")}: <strong>{schema.status}</strong>
            </Typography>
            {jobs.map((job, index) => {
              const schedule = jobSchedules[index];
              const at = (value: Date) => format.dateTime(value, { dateStyle: "medium", timeStyle: "short", hourCycle: "h23" });
              return (
                <Typography variant="body2" key={job.jobName} data-testid={`job-schedule-${job.jobName}`}>
                  {job.jobName}: <strong>{t(`jobStatus.${job.status}`)}</strong>
                  {job.lastFinishedAt ? ` · ${at(new Date(job.lastFinishedAt))}` : ""}
                  {" · "}
                  {schedule.nextCheckAt
                    ? t(schedule.waitingFor === "cadence" ? "jobSchedule.floor" : "jobSchedule.quiet", {
                        when: at(schedule.nextCheckAt),
                        source: t(schedule.source === "cache" ? "jobSchedule.fromCache" : "jobSchedule.fromDatabase"),
                      })
                    : t("jobSchedule.nextPing")}
                  {schedule.lastPingAt
                    ? ` · ${t(schedule.lastPingRan ? "jobSchedule.pingRan" : "jobSchedule.pingSkipped", { when: at(schedule.lastPingAt) })}`
                    : ""}
                </Typography>
              );
            })}
            <Typography variant="body2" color="text.secondary">
              {jobCadence.minutes === 0
                ? t("jobSchedule.cadenceOnDemand", { cap: NEXT_DUE_CAP_MINUTES })
                : t("jobSchedule.cadenceEvery", { minutes: jobCadence.minutes })}
            </Typography>
            {/* The orphan sweep's own figure (`DECISIONS.md` §73): what it left. "Sweepable" is
                what the next run takes, and after a run it reads zero. */}
            <Typography variant="body2" color={pictures.sweepable > 0 ? "warning.main" : "text.primary"}>
              {t("pictures", {
                total: pictures.total,
                unreferenced: pictures.unreferenced,
                sweepable: pictures.sweepable,
                days: ORPHAN_ASSET_DAYS,
              })}
            </Typography>
          </Stack>
        </Box>
        </>
      )}
    </Stack>
  );
}
