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
import { checkJobHealth } from "@/modules/jobs/health";
import { RATE_LIMITS } from "@/modules/rate-limit/service";
import { canSeeDiagnostics, STAFF_ROLES } from "@/modules/staff-identity/domain/roles";
import { STAFF_ROLE_LABEL } from "@/modules/staff-identity/domain/staff-labels";
import { requireStaff } from "@/modules/staff-identity/session";
import { buildInfo, formatLastUpdated, formatVersion } from "@/shared/config/build-info";
import { env } from "@/shared/config/env";

type Props = { params: Promise<{ locale: string }> };

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
export default async function DevsPage({ params }: Props) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);

  const actor = await requireStaff();
  if (!canSeeDiagnostics(actor.role)) notFound();

  const t = await getTranslations("Devs");
  const format = await getFormatter();
  const now = new Date();

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
      MAP_LINK_BASE_URL: Boolean(env.MAP_LINK_BASE_URL),
      DATABASE_URL: Boolean(env.DATABASE_URL),
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

  const severity = (status: string) =>
    status === "blocked" ? "error" : status === "limited" ? "warning" : "success";

  return (
    <Stack spacing={4} sx={{ py: { xs: 3, sm: 5 }, px: { xs: 2, sm: 3 }, maxWidth: 900, mx: "auto" }}>
      <Box>
        <Typography variant="h1" sx={{ fontSize: { xs: "1.5rem", sm: "2rem" } }}>
          {t("title")}
        </Typography>
        <Typography variant="body2" color="text.secondary">
          {t("intro")}
        </Typography>
      </Box>

      {/* Which deployment, and which build. The commonest confusion is not "what is wrong" but
          "which of these two identical-looking systems am I even looking at". */}
      <Stack direction="row" spacing={1} sx={{ flexWrap: "wrap", gap: 1 }}>
        <Chip color="primary" label={`${t("environment")}: ${env.APP_ENV}`} />
        <Chip variant="outlined" label={formatVersion()} />
        <Chip variant="outlined" label={formatLastUpdated(locale) ?? t("buildUnknown")} />
        {buildInfo.commit && <Chip variant="outlined" label={buildInfo.commit} />}
      </Stack>

      <Alert severity={severity(overall)}>{t(`overall.${overall}`)}</Alert>

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
          {jobs.map((job) => (
            <Typography variant="body2" key={job.jobName}>
              {job.jobName}: <strong>{t(`jobStatus.${job.status}`)}</strong>
              {job.lastFinishedAt
                ? ` · ${format.dateTime(new Date(job.lastFinishedAt), {
                    dateStyle: "medium",
                    timeStyle: "short",
                  })}`
                : ""}
            </Typography>
          ))}
        </Stack>
      </Box>
    </Stack>
  );
}
