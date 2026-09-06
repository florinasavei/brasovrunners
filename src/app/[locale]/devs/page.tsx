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
import { readEmailVolumeToday } from "@/modules/notifications/volume";
import { RATE_LIMITS } from "@/modules/rate-limit/service";
import { canSeeDiagnostics, STAFF_ROLES } from "@/modules/staff-identity/domain/roles";
import { STAFF_ROLE_LABEL } from "@/modules/staff-identity/domain/staff-labels";
import { requireStaff } from "@/modules/staff-identity/session";
import { buildInfo, formatLastUpdated, formatVersion } from "@/shared/config/build-info";
import { CONFIGURATION_ENUMS } from "@/shared/config/env-enums";
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
  const volume = await readEmailVolumeToday(db, now);

  /** The value each configuration enum currently holds, for marking it in the list below. */
  const currentSetting: Record<string, string> = {
    APP_ENV: env.APP_ENV,
    EMAIL_DELIVERY_MODE: env.EMAIL_DELIVERY_MODE,
    STAFF_AUTH_MODE: env.STAFF_AUTH_MODE ?? "disabled",
  };

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

      {/*
        The arithmetic of `docs/PLATFORM.md` limit 1, done here so nobody has to do it by hand
        on the morning it matters: three messages per completed registration against a daily
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
              : volume.projectedMessages > volume.remaining
                ? "warning"
                : "success"
          }
          sx={{ mb: 2 }}
        >
          {t("emailVolumeHeadroom", {
            remaining: volume.remaining,
            allowance: volume.allowance,
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
            {t("sentMessages")}: <strong>{volume.sentMessages}</strong> / {volume.allowance}
          </Typography>
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
