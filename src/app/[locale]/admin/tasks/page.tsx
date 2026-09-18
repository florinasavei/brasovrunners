import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Chip from "@mui/material/Chip";
import Divider from "@mui/material/Divider";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { count } from "drizzle-orm";
import { getDb } from "@/db/client";
import { staffUsers } from "@/db/schema/staff-users";
import { routing } from "@/i18n/routing";
import { listPublishedEvents } from "@/modules/events/repository";
import { checkJobHealth } from "@/modules/jobs/health";
import { checkEmailHealth } from "@/modules/notifications/health";
import { findCurrentApprovedDocument } from "@/modules/legal-documents/repository";
import { ownerTasks, sortTasks, type TaskState } from "@/modules/diagnostics/owner-tasks";
import { isStorageConfigured } from "@/modules/media/storage";
import {
  annualCostToday,
  freeTierVerdict,
  moneyDecisions,
  nextSpend,
  oldestCheckDate,
  platformServices,
  priceFreshness,
  registrationsLeftToday,
  ROMANIAN_VAT_PERCENT,
  type ServiceRow,
  type ServiceSeverity,
} from "@/modules/diagnostics/platform-plans";
import { NEON_FREE_STORAGE_BYTES, readDatabaseSizeBytes } from "@/modules/diagnostics/database-size";
import { readNeonConsumption } from "@/modules/diagnostics/neon";
import { projectedNeonLaunchUsdPerMonth } from "@/modules/diagnostics/platform-plans";
import {
  MAILGUN_FREE_DAILY_MESSAGES,
  MESSAGES_PER_COMPLETED_REGISTRATION,
  readEmailVolumeToday,
} from "@/modules/notifications/volume";
import { canManageRegistrations } from "@/modules/staff-identity/domain/roles";
import { requireStaff } from "@/modules/staff-identity/session";
import { env } from "@/shared/config/env";

type Props = { params: Promise<{ locale: string }> };

export const dynamic = "force-dynamic";

/** The colour is the whole message for somebody scanning: red stops a registration today. */
const STATE_COLOR: Record<TaskState, "error" | "warning" | "success"> = {
  blocking: "error",
  open: "warning",
  done: "success",
};

/**
 * `unknown` is grey rather than green, deliberately. A ceiling nothing measures must not read
 * as headroom, and "we never checked" and "we are fine" are the same tick otherwise.
 */
const SERVICE_COLOR: Record<ServiceSeverity, "success" | "default" | "warning" | "error"> = {
  ok: "success",
  unknown: "default",
  watch: "warning",
  act: "error",
};

/** One labelled fact inside a service row. Two columns on a phone, four from `md`. */
function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <Box>
      <Typography variant="caption" color="text.secondary" component="div">
        {label}
      </Typography>
      <Typography variant="body2" component="div">
        {children}
      </Typography>
    </Box>
  );
}

/**
 * What is still owed, and what it costs — for the people who owe it and pay for it.
 *
 * `/devs` is for whoever reads a status enum; this is for the club. Two halves, in the order a
 * volunteer needs them: what is waiting on somebody, then the money.
 *
 * The money half used to be four sections — a verdict, a limit list, a plan table and a bump
 * table — every fact on it defensible and none of it adding up to an answer. It is one answer
 * now, one row per service, and only the questions nobody has answered yet beneath. The
 * alternatives-not-taken and the Cloudflare box left on 2026-09-17 (`DECISIONS.md` §61): they
 * were history, and the page is today's list.
 *
 * Every line on both halves is derived from what this deployment reports, never from a
 * checklist somebody has to remember to tick, and every price is quoted from
 * `docs/PLATFORM.md` with the date it was checked (`AGENTS.md` §1.2).
 */
export default async function AdminTasksPage({ params }: Props) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);

  const actor = await requireStaff();
  if (!canManageRegistrations(actor.role)) notFound();

  const db = getDb();
  const now = new Date();

  const privacyNotice = await findCurrentApprovedDocument(db, "PRIVACY_NOTICE", locale, now);
  const jobs = await Promise.all([
    checkJobHealth(db, "email-outbox", now),
    checkJobHealth(db, "registration-maintenance", now),
  ]);
  // The listing's own query, so "published" here means exactly what a visitor sees.
  const published = await listPublishedEvents(db, locale);
  const publishedEventCount = published.length;
  /**
   * Is any published event announcing a fee? `events.cost_type = 'PAID'`.
   *
   * Not "does this site take money" — it takes none and has no payment integration. Vercel's
   * fair-use list is wider than that: "advertising the sale of a product or service" is on it,
   * and an event page stating a mandatory entry fee is arguably exactly that, whoever collects
   * the money and wherever. Their explicit carve-out is donations, not non-profit status, so
   * the club being an NGO does not settle it (`DECISIONS.md` §50).
   */
  const hasPaidEvent = published.some((event) => event.costType === "PAID");
  const volume = await readEmailVolumeToday(db, now);
  // Whether email has stopped (§98): the same answer `/api/health` gives the monitors.
  const email = await checkEmailHealth(db, now);
  // One row is the Administrator inserted by hand; a second is somebody invited from
  // `/admin/staff`. The count is the whole of what "the team is invited" can mean here.
  const [{ staffCount }] = await db.select({ staffCount: count() }).from(staffUsers);

  /**
   * Is this deployment on the club's own domain, or still on somebody else's hostname?
   *
   * "Not a provider hostname" was the obvious test and it was wrong on the machine every
   * developer runs this on: `localhost` is not `*.vercel.app`, so the domain read as bound on
   * every laptop. A development hostname is not a bound domain, and saying so is one condition
   * rather than two. The `.ro` test is the same hostname's suffix (`DECISIONS.md` §55).
   */
  const hostname = new URL(env.APP_BASE_URL).hostname;
  const clubDomainBound =
    !/vercel\.app$/i.test(hostname) && !/^(localhost|127\.0\.0\.1|\[::1\])$/i.test(hostname);
  const roDomainBound = clubDomainBound && /\.ro$/i.test(hostname);

  /**
   * The values the step-by-step instructions under each task need, read from this deployment
   * so the page can print the exact address to paste rather than a placeholder to work out:
   * the club's apex domain (the mail subdomain hangs off it, whichever host QA answers on),
   * the two job endpoints, and the webhook. Never a secret: `JOB_SECRET` is named, not shown.
   */
  const apex = clubDomainBound ? hostname.split(".").slice(-2).join(".") : hostname;
  const howValues: Record<string, string> = {
    apex,
    mailDomain: `mail.${apex}`,
    outboxUrl: `${env.APP_BASE_URL}/api/internal/jobs/email-outbox`,
    maintenanceUrl: `${env.APP_BASE_URL}/api/internal/jobs/registration-maintenance`,
    webhookUrl: `${env.APP_BASE_URL}/api/webhooks/mailgun`,
    baseUrl: env.APP_BASE_URL,
  };
  /** `t.raw` returns the catalogue's array untouched, so the values are filled in here. */
  const fill = (step: string) =>
    step.replace(/\{(\w+)\}/g, (match, key: string) => howValues[key] ?? match);
  const jobsHealthy = jobs.every((job) => job.status === "ok");
  // Which ones, not how many: a single missing monitor and a stopped scheduler are the same
  // count and different problems.
  const staleJobNames = jobs.filter((job) => job.status !== "ok").map((job) => job.jobName);

  const tasks = sortTasks(
    ownerTasks({
      hasApprovedPrivacyNotice: Boolean(privacyNotice),
      // The sample documents say so in their own titles, in both languages — the same banner a
      // visitor reads on the public page. Nothing else distinguishes them from the real thing,
      // which is deliberate: a sample that could be mistaken for approved wording is the risk.
      legalTextIsSample: /EXEMPLU|SAMPLE/i.test(privacyNotice?.title ?? ""),
      emailDeliveryMode: env.EMAIL_DELIVERY_MODE,
      appEnv: env.APP_ENV,
      staleJobNames,
      staffCount,
      publishedEventCount,
      roDomainBound,
      storageConfigured: isStorageConfigured(),
      botCheckConfigured: Boolean(env.TURNSTILE_SITE_KEY && env.TURNSTILE_SECRET_KEY),
    }),
  );

  const t = await getTranslations("Admin.tasks");
  const blocking = tasks.filter((task) => task.state === "blocking").length;

  const databaseBytes = await readDatabaseSizeBytes(db);
  const neon = await readNeonConsumption(env);
  const facts = {
    databaseBytes,
    neonCuHoursThisMonth: neon.ok ? neon.consumption.cuHours : null,
    neonHoursElapsed: neon.ok ? (now.getTime() - neon.consumption.periodStart.getTime()) / 3_600_000 : null,
    databaseStorageAllowanceBytes: NEON_FREE_STORAGE_BYTES,
    emailAllowance: MAILGUN_FREE_DAILY_MESSAGES,
    emailSentToday: volume.sentMessages,
    messagesPerRegistration: MESSAGES_PER_COMPLETED_REGISTRATION,
    hasPaidEvent,
    clubDomainBound,
    jobsHealthy,
  };
  const services = platformServices(facts);
  const verdict = freeTierVerdict(facts);
  const registrationsLeft = registrationsLeftToday(facts);
  const paidToday = annualCostToday(services);
  const next = nextSpend(services);
  // Only what is still undecided: a settled question rendered "answered" for ever is a line to
  // scroll past, and the section disappears entirely when nothing is open.
  const decisions = moneyDecisions(facts).filter((decision) => decision.state === "open");
  const freshness = priceFreshness(oldestCheckDate(services), now);

  /** How close this service is to its ceiling, in that service's own words. */
  const neonMonthly = projectedNeonLaunchUsdPerMonth(facts);
  const howClose = (row: ServiceRow) => {
    if (row.headroom.kind === "measured") {
      const base = t(`services.${row.id}.closeMeasured`, {
        used: row.headroom.used,
        of: row.headroom.of,
        left: registrationsLeft,
      });
      // The monthly figure the owner asked for (§88): this month's pace on the next plan.
      if (row.id === "neon") {
        return neon.ok && neonMonthly !== null
          ? `${base} ${t("services.neon.monthly", { cu: Math.round(neon.consumption.cuHours), usd: neonMonthly.toFixed(2) })}`
          : `${base} ${t("services.neon.monthlyUnknown")}`;
      }
      return base;
    }
    if (row.headroom.kind === "derived") {
      return t(`services.${row.id}.${row.headroom.reached ? "closeYes" : "closeNo"}`);
    }
    return t(`services.${row.id}.closeUnknown`);
  };

  return (
    <Stack spacing={3} sx={{ py: { xs: 2, sm: 3 } }}>
      <Box>
        <Typography variant="h1" sx={{ fontSize: "1.5rem" }} gutterBottom>
          {t("title")}
        </Typography>
        <Typography variant="body2" color="text.secondary">
          {t("intro")}
        </Typography>
      </Box>

      <Alert severity={blocking > 0 ? "warning" : "success"}>
        {blocking > 0 ? t("blockingSummary", { count: blocking }) : t("nothingBlocking")}
      </Alert>

      {/* Email has stopped (§98). Red, above the list, because every row below assumes the
          confirmations are going out — and this page is the one the club opens. */}
      {email.status === "stalled" && (
        <Alert severity="error">
          <Typography variant="body2" sx={{ fontWeight: 500 }}>
            {t("emailStalled.title")}
          </Typography>
          {email.deferred > 0 && (
            <Typography variant="body2" sx={{ mt: 0.5 }}>
              {t("emailStalled.deferred", {
                count: email.deferred,
                allowance: MAILGUN_FREE_DAILY_MESSAGES,
                resumesAt: email.resumesAt
                  ? new Intl.DateTimeFormat(locale === "ro" ? "ro-RO" : "en-GB", {
                      dateStyle: "medium",
                      timeStyle: "short",
                      timeZone: "Europe/Bucharest",
                    }).format(new Date(email.resumesAt))
                  : "—",
              })}
            </Typography>
          )}
          {email.failed > 0 && (
            <Typography variant="body2" sx={{ mt: 0.5 }}>
              {t("emailStalled.failed", { count: email.failed, reason: email.lastError ?? "—" })}
            </Typography>
          )}
          {email.overdue > 0 && (
            <Typography variant="body2" sx={{ mt: 0.5 }}>
              {t("emailStalled.overdue", { count: email.overdue })}
            </Typography>
          )}
          <Typography variant="body2" sx={{ mt: 0.5 }}>
            {t("emailStalled.notify")}
          </Typography>
        </Alert>
      )}

      <Stack spacing={2} component="ul" sx={{ listStyle: "none", m: 0, p: 0 }}>
        {tasks.map((task) => (
          <Box
            component="li"
            key={task.id}
            sx={{ border: 1, borderColor: "divider", borderRadius: 1, p: 2 }}
          >
            <Stack direction="row" spacing={1} sx={{ mb: 1, flexWrap: "wrap", gap: 1 }}>
              <Chip size="small" color={STATE_COLOR[task.state]} label={t(`state.${task.state}`)} />
              {/* Who it is waiting on, because that is the difference between a list somebody
                  acts on and a list they scroll past. */}
              <Chip size="small" variant="outlined" label={t(`owner.${task.owner}`)} />
            </Stack>
            <Typography variant="h2" sx={{ fontSize: "1rem", mb: 0.5 }}>
              {t(`items.${task.id}.title`)}
            </Typography>
            <Typography variant="body2" color="text.secondary">
              {t(`items.${task.id}.${task.state === "done" ? "done" : "todo"}`, howValues)}
              {task.detail && ` — ${task.detail}`}
            </Typography>
            {/*
              How to do it, on the page, with this deployment's own values filled in — so the
              answer to "what do I click" is under the task and not in a runbook ("things
              should be self-explanatory in the admin console" — the owner, 2026-09-17). A
              native <details>, closed: the list stays scannable, and no client code. Hidden
              once the task is done; the steps are for doing it, not for reading about it.
            */}
            {task.state !== "done" && (
              <Box component="details" sx={{ mt: 1.5 }}>
                <Box component="summary" sx={{ cursor: "pointer", fontSize: "0.875rem", fontWeight: 500 }}>
                  {t("howTitle")}
                </Box>
                <Box component="ol" sx={{ m: 0, mt: 1, pl: 2.5, "& li": { mb: 0.75 } }}>
                  {(t.raw(`items.${task.id}.how`) as string[]).map((step, index) => (
                    <Typography component="li" variant="body2" key={index} sx={{ wordBreak: "break-word" }}>
                      {fill(step)}
                    </Typography>
                  ))}
                </Box>
              </Box>
            )}
          </Box>
        ))}
      </Stack>

      <Divider />

      {/*
        The money, and the answer before the table that justifies it: what the club pays today,
        then the next thing to cost anything. Two sentences and two numbers, because the
        complaint this replaced was that a treasurer had to assemble them from four sections.
      */}
      <Box component="section">
        <Typography variant="h2" sx={{ fontSize: "1.25rem", mb: 1 }}>
          {t("costTitle")}
        </Typography>

        <Alert severity={verdict === "freeExceptDomain" ? "success" : "warning"} sx={{ mb: 2 }}>
          <Typography variant="body2" sx={{ fontWeight: 500 }}>
            {paidToday.length === 0
              ? t("costToday.nothing")
              : t("costToday.total", {
                  total: paidToday
                    .map((total) =>
                      total.plusVat
                        ? t("costToday.amountPlusVat", {
                            amount: total.amount,
                            currency: total.currency,
                          })
                        : t("costToday.amount", {
                            amount: total.amount,
                            currency: total.currency,
                          }),
                    )
                    .join(", "),
                })}
          </Typography>
          {next && (
            <Typography variant="body2" sx={{ mt: 0.5 }}>
              {t(`nextSpend.${next.id}`, { cost: next.nextCost ?? "" })}
            </Typography>
          )}
        </Alert>

        {/* The verdict on the free plans, and the one figure that turns this page from reading
            into acting: how many more people can register today before the free allowance stops
            sending confirmations. Understated on purpose — a waitlisted entrant costs more. */}
        <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
          {t(`freeVerdict.${verdict}`)}
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
          {t("registrationsLeftToday", {
            count: registrationsLeft,
            sent: volume.sentMessages,
            allowance: MAILGUN_FREE_DAILY_MESSAGES,
          })}
        </Typography>
        <Typography variant="body2" color="text.secondary">
          {t("currencyNote", { vat: ROMANIAN_VAT_PERCENT })}
        </Typography>
      </Box>

      {/*
        A researched price is a fact with an expiry, so the page says how old these are instead
        of printing a date beside them and asserting them with equal confidence for ever.
      */}
      <Alert severity={freshness.state === "stale" ? "warning" : "info"}>
        {t(`freshness.${freshness.state}`, {
          checked: oldestCheckDate(services),
          days: Number.isFinite(freshness.days) ? freshness.days : 0,
        })}
      </Alert>

      {/*
        One row per service, carrying everything about that service: what it costs, what the
        free plan gives, the ceiling this club meets first, how close this deployment is to it
        right now, what happens when it is crossed, and what the next plan costs — including the
        way back down, which used to be a section of its own and belongs here.
      */}
      <Box component="section">
        <Typography variant="h2" sx={{ fontSize: "1.25rem", mb: 1 }}>
          {t("servicesTitle")}
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          {t("servicesIntro")}
        </Typography>

        <Stack spacing={2} component="ul" sx={{ listStyle: "none", m: 0, p: 0 }}>
          {services.map((row) => (
            <Box
              component="li"
              key={row.id}
              sx={{ border: 1, borderColor: "divider", borderRadius: 1, p: 2 }}
            >
              <Stack
                direction="row"
                spacing={1}
                sx={{ mb: 1, flexWrap: "wrap", gap: 1, alignItems: "center" }}
              >
                <Typography variant="h3" sx={{ fontSize: "1rem" }}>
                  {t(`services.${row.id}.name`)}
                </Typography>
                <Chip
                  size="small"
                  color={SERVICE_COLOR[row.severity]}
                  variant={row.severity === "unknown" ? "outlined" : "filled"}
                  label={t(`severity.${row.severity}`)}
                />
              </Stack>

              {/* Two columns at 320px, four from `md`. A table would scroll sideways on a
                  phone, which §18.5 refuses. */}
              <Box
                sx={{
                  display: "grid",
                  gridTemplateColumns: { xs: "repeat(2, minmax(0, 1fr))", md: "repeat(4, minmax(0, 1fr))" },
                  gap: 1.5,
                  mb: 1.5,
                }}
              >
                <Fact label={t("field.planToday")}>
                  {row.planToday ?? t("planNone")}
                </Fact>
                <Fact label={t("field.costToday")}>
                  <strong>
                    {row.costToday.kind === "free"
                      ? t("costToday.free")
                      : row.costToday.kind === "notTaken"
                        ? t("costToday.notTaken")
                        : row.costToday.plusVat
                          ? t("costToday.amountPlusVat", {
                              amount: row.costToday.amount,
                              currency: row.costToday.currency,
                            })
                          : t("costToday.amount", {
                              amount: row.costToday.amount,
                              currency: row.costToday.currency,
                            })}
                  </strong>
                </Fact>
                <Fact label={t("field.howClose")}>{howClose(row)}</Fact>
                <Fact label={t("field.nextPlan")}>
                  {row.nextPlan ? `${row.nextPlan} — ${row.nextCost}` : t("nextPlanNone")}
                </Fact>
              </Box>

              <Typography variant="body2" color="text.secondary" sx={{ mb: 0.5 }}>
                {t(`services.${row.id}.freeGives`)}
              </Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 0.5 }}>
                <strong>{t(`services.${row.id}.ceiling`)}</strong> {t(`services.${row.id}.whenCrossed`)}
              </Typography>

              {/* The one genuinely good idea in the table this replaced: a temporary upgrade
                  nobody reverses is the expensive failure, and no dashboard will remind the
                  club to come back down. It belongs on the service, not in a section. */}
              {row.bump && (
                <Stack direction="row" spacing={1} sx={{ mt: 1, flexWrap: "wrap", gap: 1 }}>
                  <Chip
                    size="small"
                    variant="outlined"
                    color={row.bump === "temporary" ? "info" : "default"}
                    label={t(`bump.${row.bump}`)}
                  />
                  <Typography variant="body2" color="text.secondary">
                    {t(`services.${row.id}.bumpBack`)}
                  </Typography>
                </Stack>
              )}

              <Typography variant="caption" color="text.secondary" component="div" sx={{ mt: 1 }}>
                {t("checkedOn", { checked: row.checkedOn })}
              </Typography>
            </Box>
          ))}
        </Stack>
      </Box>

      {/*
        A fact is something to read; a decision is a question with somebody's name on it. Only
        the open ones — a question that has been answered is a fact, and lives above.
      */}
      {decisions.length > 0 && (
        <Box component="section">
          <Typography variant="h2" sx={{ fontSize: "1.25rem", mb: 1 }}>
            {t("decisionsTitle")}
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            {t("decisionsIntro")}
          </Typography>
          <Stack spacing={2} component="ul" sx={{ listStyle: "none", m: 0, p: 0 }}>
            {decisions.map((decision) => (
              <Box
                component="li"
                key={decision.id}
                sx={{ border: 1, borderColor: "divider", borderRadius: 1, p: 2 }}
              >
                <Stack direction="row" spacing={1} sx={{ mb: 1, flexWrap: "wrap", gap: 1 }}>
                  <Chip size="small" color="warning" label={t("decisionState.open")} />
                  <Chip size="small" variant="outlined" label={t(`owner.${decision.owner}`)} />
                </Stack>
                <Typography variant="h3" sx={{ fontSize: "1rem", mb: 0.5 }}>
                  {t(`decisions.${decision.id}.question`)}
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  {t(`decisions.${decision.id}.open`)}
                </Typography>
              </Box>
            ))}
          </Stack>
        </Box>
      )}
    </Stack>
  );
}
