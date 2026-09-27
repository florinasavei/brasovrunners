import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Chip from "@mui/material/Chip";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { getDb } from "@/db/client";
import { formatCalendarDay } from "@/i18n/dates";
import { routing } from "@/i18n/routing";
import { listPublishedEvents } from "@/modules/events/repository";
import { checkJobHealth } from "@/modules/jobs/health";
import { storedMediaBytes } from "@/modules/media/references";
import {
  annualCostToday,
  DOMAIN_PRICE_USD_PER_YEAR,
  freeTierVerdict,
  NEON_LAUNCH_USD_PER_CU_HOUR,
  NEON_LAUNCH_USD_PER_GB_MONTH,
  neonCuHoursPerDay,
  nextSpend,
  oldestCheckDate,
  platformServices,
  priceFreshness,
  projectedNeonLaunchUsdPerMonth,
  registrationsLeftToday,
  ROMANIAN_VAT_PERCENT,
  type ServiceRow,
  type ServiceSeverity,
} from "@/modules/diagnostics/platform-plans";
import { readDatabaseSizeBytes } from "@/modules/diagnostics/database-size";
import { readNeonConsumption, readNeonLimits, readNeonPreviousPeriod } from "@/modules/diagnostics/neon";
import { readNeonPlan } from "@/modules/diagnostics/neon-plan";
import { describeNeonBlock, effectiveNeonPlan } from "@/modules/diagnostics/domain/neon-plan";
import { domainRenewal } from "@/modules/diagnostics/domain/domain-renewal";
import { readNeonBudget } from "@/modules/diagnostics/neon-budget";
import { readMonthCosts } from "@/modules/diagnostics/month-costs-read";
import MonthCostsPanel from "@/modules/diagnostics/ui/MonthCostsPanel";
import NeonBudgetPanel from "@/modules/diagnostics/ui/NeonBudgetPanel";
import NeonLimitsPanel from "@/modules/diagnostics/ui/NeonLimitsPanel";
import NeonPlanPanel from "@/modules/diagnostics/ui/NeonPlanPanel";
import { readVercelMonthForCosts, VERCEL_HOBBY_BUILD_MINUTES_PER_MONTH } from "@/modules/diagnostics/vercel";
import Panel from "@/shared/ui/Panel";
import QuietHelp from "@/shared/ui/QuietHelp";
import { readJobCadence } from "@/modules/jobs/cadence";
import { describeJob } from "@/modules/jobs/overview";
import type { JobName } from "@/modules/jobs/schedule";
import JobCadencePanel from "@/modules/jobs/ui/JobCadencePanel";
import { isTranslationConfigured } from "@/infrastructure/translate/translator";
import { charactersTranslatedSince, charactersTranslatedToday, readTranslationBudget } from "@/modules/translate/budget";
import { readTranslationCredit } from "@/modules/translate/credit";
import TranslationBudgetPanel from "@/modules/translate/ui/TranslationBudgetPanel";
import { EMAIL_PLANS, emailCeilings, nextEmailPlan } from "@/modules/notifications/domain/email-plan";
import { readDeliveryTiming } from "@/modules/notifications/delivery-timing";
import { readEmailPlan } from "@/modules/notifications/email-plan";
import { mailgunMessagesSentBetween, readEmailVolumeToday } from "@/modules/notifications/volume";
import { canManageClubSettings, canManagePlatform } from "@/modules/staff-identity/domain/roles";
import { canOpenSettingsTab } from "@/modules/staff-identity/domain/settings-tabs";
import { requireStaff } from "@/modules/staff-identity/session";
import SettingsSubNav from "@/modules/staff-identity/ui/SettingsSubNav";
import { env } from "@/shared/config/env";

type Props = {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export const dynamic = "force-dynamic";

/**
 * A Server Action runs in the function of the page it is posted from, and the Neon limits' save
 * reads Neon, writes it and reads it back — the ceiling `/admin/tasks` gave the same forms (§430).
 */
export const maxDuration = 60;

/** `unknown` is grey rather than green: a ceiling nothing measures must not read as headroom. */
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
 * «Setări» → «Costuri» (§516): the club's money page (§479), moved whole from `/admin/tasks` →
 * «Costuri», which answers 308 here — the month so far per provider and projected to its end, the
 * database's configuration in one card (the plan, the month's budget, the brakes, the jobs'
 * interval), the translation allowance, then what the club pays a year and what the next thing to
 * cost anything would cost.
 *
 * It moved rather than «Sarcini» growing: every card here is a setting or the price of one, and the
 * database card keeps §479's reason for being one card — a brake's confirmation names its money, so
 * the brakes and the money are one place. What the club still *owes* stays on «Sarcini» → «Club»,
 * whose rows link here.
 *
 * The Administrator's and the Superadministrator's (`canManageRegistrations`, as the panel always
 * was); each card keeps its own `mayEdit` and each action asserts its own predicate (§450).
 * Every price is quoted from `docs/PLATFORM.md` with the date it was checked (`AGENTS.md` §1.2).
 */
export default async function AdminCostsPage({ params, searchParams }: Props) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);

  const actor = await requireStaff();
  if (!canOpenSettingsTab(actor.role, "costs")) notFound();

  const query = await searchParams;
  const t = await getTranslations("Admin.tasks");
  // The refusal codes (`?error=FORBIDDEN|VALIDATION_ERROR`) are `Admin.errors.*`, shared by every backoffice page.
  const tErrors = await getTranslations("Admin.errors");

  const db = getDb();
  const now = new Date();

  // The month's budget as the governor reads it (§447) — Neon's API through the shared reading,
  // never the database — for the jobs' thresholds and the "Bugetul lunii" card.
  const budget = await readNeonBudget(now);
  const jobs = await Promise.all([
    checkJobHealth(db, "email-outbox", now, budget.effects.jobFloorMinutes),
    checkJobHealth(db, "registration-maintenance", now, budget.effects.jobFloorMinutes),
  ]);
  const jobsHealthy = jobs.every((job) => job.status === "ok");
  // The listing's own query, so "published" here means exactly what a visitor sees; a fee
  // announced on one reopens a money question (§50).
  const published = await listPublishedEvents(db, locale);
  const hasPaidEvent = published.some((event) => event.costType === "PAID");
  const volume = await readEmailVolumeToday(db, now);
  // The plan the club says it is on (§100): its price is a row on the cost table below.
  const emailPlan = await readEmailPlan(db);
  const emailPlanCeilings = emailCeilings(emailPlan);
  const emailNext = nextEmailPlan(emailPlan.plan);

  // Is this deployment on the club's own domain (the cost table's domain row, §61)?
  const hostname = new URL(env.APP_BASE_URL).hostname;
  const clubDomainBound =
    !/vercel\.app$/i.test(hostname) && !/^(localhost|127\.0\.0\.1|\[::1\])$/i.test(hostname);
  // When the domain expires (§435): «Luna aceasta»'s domain line.
  const domain = domainRenewal(env.DOMAIN_REGISTERED_ON, env.DOMAIN_RENEWAL_YEARS, now);

  // Neon's meter and brakes (§335) and DeepL's credit (§497), asked together.
  const [neon, neonLimits, deeplCredit] = await Promise.all([readNeonConsumption(env), readNeonLimits(env), readTranslationCredit(env)]);

  const databaseBytes = await readDatabaseSizeBytes(db);
  // The Neon plan (§280's follow-up, §326): what Neon reports for the account when it answered,
  // the plan stated on this panel when it did not. Free's ceilings, or Launch's rates.
  const neonPlan = await readNeonPlan(db);
  const neonInForce = effectiveNeonPlan(neonPlan.plan, neon.ok ? neon.consumption.reportedPlan : null);
  const neonBlock = describeNeonBlock({
    plan: neonInForce.plan,
    databaseBytes,
    consumption: neon.ok ? neon.consumption : null,
    now,
  });
  /*
    The owner's throttle, beside the plan it pays (§334): the minimum interval between two real
    runs, and what each job did with it.
  */
  const [jobCadence, deliveryTiming] = await Promise.all([
    readJobCadence(db),
    // Whether the interval delays email too (§221): the panel's sentence about email follows it.
    readDeliveryTiming(db),
  ]);
  const jobOverviews = await Promise.all(
    jobs.map((job) =>
      describeJob(db, {
        job: job.jobName as JobName,
        now,
        cadenceMinutes: jobCadence.minutes,
        lastFinishedAt: job.lastFinishedAt,
      }),
    ),
  );
  // «Tradu din română»'s allowance and today's spend (§464).
  const translation = await Promise.all([readTranslationBudget(db), charactersTranslatedToday(db, now)]).then(([state, usedToday]) => ({ state, usedToday }));
  /*
    «Luna aceasta» (§479): each provider's month so far and projected to its end, from the readings
    this page already holds — Neon's meter (§447), the outbox's month (§100), the domain's expiry
    (§435) — plus the readers only this card needs: Vercel's month (§101, cached an hour here;
    `/devs` keeps its live read), the month's translated characters (§464), last month's outbox,
    Neon's previous period and the pictures' bytes on R2. `readMonthCosts` does the mapping, and
    is tested with a fake for every reader.
  */
  const month = await readMonthCosts(
    {
      now,
      neonPlan: neonInForce.plan,
      neon: neon.ok ? { ok: true, meter: neon.consumption.meter } : { ok: false, reason: neon.reason },
      databaseBytes,
      mailgun: {
        planName: volume.planName,
        planId: emailPlan.plan,
        usdPerMonth: emailPlanCeilings.usdPerMonth,
        sentThisMonth: volume.sentThisMonth,
        monthlyAllowance: emailPlanCeilings.monthlyAllowance,
        dailyAllowance: emailPlanCeilings.dailyAllowance,
      },
      vercelBuildMinutesPerMonth: VERCEL_HOBBY_BUILD_MINUTES_PER_MONTH,
      domain: { planName: ".com", usdPerYear: DOMAIN_PRICE_USD_PER_YEAR, expiresOn: domain.status === "unknown" ? null : domain.expiresOn },
    },
    {
      vercelMonth: () => readVercelMonthForCosts(env, now),
      charactersSince: (since) => charactersTranslatedSince(db, since),
      mailgunSentBetween: (start, end) => mailgunMessagesSentBetween(db, start, end),
      neonPreviousPeriod: (periodStart) => readNeonPreviousPeriod(env, periodStart),
      mediaBytes: () => storedMediaBytes(db),
      deeplCredit: async () => deeplCredit,
    },
  );
  const facts = {
    databaseBytes,
    neonPlan: neonInForce.plan,
    neonCuHoursThisMonth: neon.ok ? neon.consumption.cuHours : null,
    neonHoursElapsed: neon.ok ? (now.getTime() - neon.consumption.periodStart.getTime()) / 3_600_000 : null,
    emailAllowance: volume.allowance,
    // Over the period that binds: today on Free, this month on a paid plan.
    emailSentToday: volume.period === "month" ? volume.sentThisMonth : volume.sentMessages,
    emailPlanName: volume.planName,
    emailPlanUsdPerMonth: emailPlanCeilings.usdPerMonth,
    emailPeriod: volume.period,
    emailNextPlan: emailNext ? { name: EMAIL_PLANS[emailNext].name, usdPerMonth: EMAIL_PLANS[emailNext].usdPerMonth } : null,
    // The archive copy and the hidden copies of every participant message, priced once in
    // `volume.ts` so this page and «Emailuri» cannot disagree about a registration's cost.
    messagesPerRegistration: volume.messagesPerRegistration,
    hasPaidEvent,
    clubDomainBound,
    jobsHealthy,
  };
  const services = platformServices(facts);
  const verdict = freeTierVerdict(facts);
  const registrationsLeft = registrationsLeftToday(facts);
  const paidToday = annualCostToday(services);
  const next = nextSpend(services);
  const freshness = priceFreshness(oldestCheckDate(services), now);

  /**
   * How close this service is to its ceiling, in that service's own words: one sentence, and —
   * where the figure needs its arithmetic — the details for the «?» beside it (§NNN).
   */
  const neonMonthly = projectedNeonLaunchUsdPerMonth(facts);
  const neonPerDay = neonCuHoursPerDay(facts);
  // The rates the projection was made at, from the one catalogue, so the sentence quotes what
  // the arithmetic used — and the catalogue is the only file that knows a price.
  const neonRates = {
    rate: neonBlock.rates?.usdPerCuHour ?? NEON_LAUNCH_USD_PER_CU_HOUR,
    storageRate: neonBlock.rates?.usdPerGbMonth ?? NEON_LAUNCH_USD_PER_GB_MONTH,
  };
  const howClose = (row: ServiceRow): { text: string; more: string | null } => {
    if (row.headroom.kind === "measured") {
      const text = t(row.id === "mailgun" && volume.period === "month" ? "services.mailgun.closeMeasuredMonth" : `services.${row.id}.closeMeasured`, {
        used: row.headroom.used,
        of: row.headroom.of,
        left: registrationsLeft ?? 0,
        plan: volume.planName,
      });
      // The monthly figure the owner asked for (§88): this month's pace on the next plan, behind the «?».
      if (row.id === "neon") {
        return {
          text,
          more:
            neon.ok && neonMonthly !== null
              ? t("services.neon.monthly", { cu: Math.round(neon.consumption.cuHours), usd: neonMonthly.toFixed(2), ...neonRates })
              : t("services.neon.monthlyUnknown", neonRates),
        };
      }
      return { text, more: null };
    }
    if (row.headroom.kind === "derived") {
      // Mailgun with no ceiling at all (§100): the plan's name is the whole of the answer.
      if (row.id === "mailgun") return { text: t("services.mailgun.closeNone", { plan: volume.planName }), more: null };
      // Neon on Launch: no ceiling, so "how close" is "what does this month cost" — the
      // projection at the current pace and the daily rate it was made from, named an estimate.
      if (row.id === "neon" && row.variant === "launch") {
        return neon.ok && neonMonthly !== null && neonPerDay !== null
          ? {
              text: t("services.neon.launch.close", { cu: Math.round(neon.consumption.cuHours), perDay: neonPerDay, usd: neonMonthly.toFixed(2) }),
              more: t("services.neon.launch.closeMore", neonRates),
            }
          : { text: t("services.neon.launch.closeUnknown"), more: t("services.neon.launch.closeMore", neonRates) };
      }
      return { text: t(`services.${row.id}.${row.headroom.reached ? "closeYes" : "closeNo"}`), more: null };
    }
    return { text: t(`services.${row.id}.closeUnknown`), more: null };
  };
  /** The row's fixed sentences, read under the plan's own wording where the plan changes what is true. */
  const wording = (row: ServiceRow, key: "freeGives" | "ceiling" | "whenCrossed" | "bumpBack" | "more") =>
    t(row.variant ? `services.${row.id}.${row.variant}.${key}` : `services.${row.id}.${key}`);
  // The verdicts and the counts that carry a detail beyond their one sentence (§NNN): their «?».
  const verdictMore: Partial<Record<typeof verdict, string>> = {
    paysForUsage: t("freeVerdict.paysForUsageMore"),
    freeButAtALimit: t("freeVerdict.freeButAtALimitMore"),
    notFree: t("freeVerdict.notFreeMore"),
  };
  const registrationsLeftMore =
    volume.period === "day" ? t("registrationsLeft.dayMore") : volume.period === "month" ? t("registrationsLeft.monthMore") : null;

  return (
    <Stack spacing={3}>
      <SettingsSubNav locale={locale} role={actor.role} active="costs" />

      <Box id="admin-alert" tabIndex={-1} sx={{ scrollMarginTop: 16 }}>
        {query.saved === "neonPlan" && <Alert severity="success">{t("neonPlan.saved")}</Alert>}
        {query.saved === "jobCadence" && <Alert severity="success">{t("jobCadence.saved")}</Alert>}
        {query.saved === "budgetThresholds" && <Alert severity="success">{t("budgetThresholds.saved")}</Alert>}
        {query.saved === "neonLimits" && <Alert severity="success">{t("neonLimits.saved")}</Alert>}
        {query.saved === "neonLimitsSame" && <Alert severity="info">{t("neonLimits.savedSame")}</Alert>}
        {typeof query.error === "string" && <Alert severity="error">{tErrors(query.error)}</Alert>}
      </Box>

      {/*
        The club's money page (§479): the month's total first, straight under the tabs (§NNN) —
        one figure, what the month will have cost by its end — then each provider so far and
        projected, because that is what a treasurer opens Costuri for.
      */}
      <MonthCostsPanel
        locale={locale}
        lines={month.lines}
        totals={month.totals}
        reasons={month.reasons}
        deeplConfigured={isTranslationConfigured(env)}
      />

      {/*
        The database's configuration in one card (§479): the plan, the month's budget, the brakes
        and the jobs' interval, in the order a change is reasoned about — which plan, where the
        month stands, what Neon will allow, how often the platform wakes it — every door unchanged:
        each card keeps its own `mayEdit` and each action asserts it. A section rather than a fold:
        the forms inside must never sit in a shut box. The ids are the addresses «Sarcini»'s rows
        link to (§336, §516).
      */}
      <Panel glyph="database" id="database-config" title={t("database.title")} intro={t("database.intro")} data-testid="database-config">
        <Stack spacing={2}>
          {/*
            Which Neon plan the account is on (§280's follow-up, §326), above the figures that
            follow it, so a plan set wrong shows here before it shows on the invoice. A club
            setting (`canManageClubSettings`, the Administrator's).
          */}
          <NeonPlanPanel level={3} locale={locale} plan={neonPlan} source={neonInForce.source} block={neonBlock} mayEdit={canManageClubSettings(actor.role)} />

          {/* The month's budget and what the platform is doing about it (§447), above the brakes it is read against.
              Its thresholds are a platform setting since §450, the Superadministrator's like the brakes. */}
          <NeonBudgetPanel level={3} locale={locale} reading={budget} mayEdit={canManagePlatform(actor.role)} />

          {/*
            The database's brakes (§335): the compute's size ceiling and the period's CU-hour
            limit, read from Neon and written to Neon. A quota reached suspends the site, so
            writing it is the Superadministrator's (§450); `updateNeonLimits` asserts the role again.
          */}
          <NeonLimitsPanel
            level={3}
            locale={locale}
            reading={neonLimits.ok ? { ok: true, limits: neonLimits.snapshot.limits } : { ok: false, failure: neonLimits.failure }}
            appEnv={env.APP_ENV}
            mayEdit={canManagePlatform(actor.role)}
          />

          {/* How often the platform may wake the database for its scheduled work (§334) — the
              throttle the owner asked for, beside the plan that bills each wake. The
              Superadministrator's since §450; an Administrator reads the figures and no form. */}
          <JobCadencePanel
            level={3}
            locale={locale}
            cadence={jobCadence}
            jobs={jobOverviews}
            mayEdit={canManagePlatform(actor.role)}
            emailTiming={deliveryTiming.timing}
          />
        </Stack>
      </Panel>

      {/* «Tradu din română»'s daily allowance (§464): what DeepL Free may spend a day, and today's spend. */}
      <TranslationBudgetPanel
        locale={locale}
        state={translation.state}
        usedToday={translation.usedToday}
        configured={isTranslationConfigured(env)}
        credit={deeplCredit}
        mayEdit={canManageClubSettings(actor.role)}
      />

      {/*
        The money, and the answer before the table that justifies it: what the club pays today,
        then the next thing to cost anything. Two sentences and two numbers, because the
        complaint this replaced was that a treasurer had to assemble them from four sections.
      */}
      <Box component="section">
        <Typography variant="h2" sx={{ fontSize: "1.25rem", mb: 1 }}>
          {t("costTitle")}
        </Typography>

        {/* Green while nothing is paid monthly; blue for a plan the club chose to pay by the hour; amber for a limit met. */}
        <Alert severity={verdict === "freeExceptDomain" ? "success" : verdict === "paysForUsage" ? "info" : "warning"} sx={{ mb: 2 }}>
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
          {/* A total with a projection in it is not an invoice, and the line under it says so (one sentence a line, §NNN). */}
          {paidToday.some((total) => total.estimated) && (
            <Typography variant="body2" sx={{ mt: 0.5 }}>
              {t("costToday.estimated")}
            </Typography>
          )}
          {next && (
            <Typography variant="body2" sx={{ mt: 0.5 }}>
              {t(`nextSpend.${next.id}`, { cost: next.nextCost ?? "" })}
              <QuietHelp text={t(`nextSpend.${next.id}More`)} />
            </Typography>
          )}
        </Alert>

        {/* The verdict on the free plans, and the one figure that turns this page from reading
            into acting: how many more people can register today before the free allowance stops
            sending confirmations. Understated on purpose — a waitlisted entrant costs more. */}
        <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
          {t(`freeVerdict.${verdict}`)}
          {verdictMore[verdict] && <QuietHelp text={verdictMore[verdict]} />}
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
          {t(`registrationsLeft.${volume.period}`, {
            count: registrationsLeft ?? "",
            sent: volume.period === "month" ? volume.sentThisMonth : volume.sentMessages,
            allowance: volume.allowance ?? "",
            plan: volume.planName,
          })}
          {registrationsLeftMore && <QuietHelp text={registrationsLeftMore} />}
        </Typography>
        <Typography variant="body2" color="text.secondary">
          {t("currencyNote", { vat: ROMANIAN_VAT_PERCENT })}
          <QuietHelp text={t("currencyNoteMore")} />
        </Typography>
      </Box>

      {/*
        A researched price is a fact with an expiry, so the page says how old these are instead
        of printing a date beside them and asserting them with equal confidence for ever.
      */}
      <Alert severity={freshness.state === "stale" ? "warning" : "info"}>
        {t(`freshness.${freshness.state}`, {
          checked: formatCalendarDay(oldestCheckDate(services), { locale, style: "long", position: "inline" }),
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
          <QuietHelp text={t("servicesIntroMore")} />
        </Typography>

        <Stack spacing={2} component="ul" sx={{ listStyle: "none", m: 0, p: 0 }}>
          {services.map((row) => (
            <Box component="li" key={row.id} sx={{ border: 1, borderColor: "divider", borderRadius: 1, p: 2 }}>
              <Stack direction="row" spacing={1} sx={{ mb: 1, flexWrap: "wrap", gap: 1, alignItems: "center" }}>
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
                <Fact label={t("field.planToday")}>{row.planToday ?? t("planNone")}</Fact>
                <Fact label={t("field.costToday")}>
                  <strong>
                    {row.costToday.kind === "free"
                      ? t("costToday.free")
                      : row.costToday.kind === "notTaken"
                        ? t("costToday.notTaken")
                        : row.costToday.kind === "usage"
                          ? row.costToday.estimatedPerMonth === null
                            ? t("costToday.usageUnknown")
                            : t("costToday.usage", {
                                amount: row.costToday.estimatedPerMonth.toFixed(2),
                                currency: row.costToday.currency,
                              })
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
                <Fact label={t("field.howClose")}>
                  {(() => {
                    const close = howClose(row);
                    return (
                      <>
                        {close.text}
                        {close.more && <QuietHelp text={close.more} />}
                      </>
                    );
                  })()}
                </Fact>
                <Fact label={t("field.nextPlan")}>{row.nextPlan ? `${row.nextPlan} — ${row.nextCost}` : t("nextPlanNone")}</Fact>
              </Box>

              {/* One sentence a line (§NNN): what is free, the ceiling, what crossing it does — the
                  row's history, exceptions and arithmetic behind the «?» on the first line. */}
              <Typography variant="body2" color="text.secondary" sx={{ mb: 0.5 }}>
                {wording(row, "freeGives")}
                <QuietHelp text={wording(row, "more")} />
              </Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 0.5 }}>
                <strong>{wording(row, "ceiling")}</strong>
              </Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 0.5 }}>
                {wording(row, "whenCrossed")}
              </Typography>

              {/* A temporary upgrade nobody reverses is the expensive failure, and no dashboard
                  will remind the club to come back down. It belongs on the service. */}
              {row.bump && (
                <Stack direction="row" spacing={1} sx={{ mt: 1, flexWrap: "wrap", gap: 1 }}>
                  <Chip size="small" variant="outlined" color={row.bump === "temporary" ? "info" : "default"} label={t(`bump.${row.bump}`)} />
                  <Typography variant="body2" color="text.secondary">
                    {wording(row, "bumpBack")}
                  </Typography>
                </Stack>
              )}

              <Typography variant="caption" color="text.secondary" component="div" sx={{ mt: 1 }}>
                {t("checkedOn", { checked: formatCalendarDay(row.checkedOn, { locale, style: "short", position: "inline" }) })}
              </Typography>
            </Box>
          ))}
        </Stack>
      </Box>
    </Stack>
  );
}
