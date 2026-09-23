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
import {
  countTasks,
  filterTasks,
  isTaskKind,
  isTaskOwner,
  ownerTasks,
  sortTasks,
  TASK_KINDS,
  TASK_OWNERS,
  type TaskState,
} from "@/modules/diagnostics/owner-tasks";
import { checkInviteKey } from "@/modules/diagnostics/invite-key";
import { isStorageConfigured } from "@/modules/media/storage";
import { readBotCheck } from "@/modules/registrations/bot-check";
import BotCheckPanel from "@/modules/registrations/ui/BotCheckPanel";
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
import { EMAIL_PLANS, emailCeilings, nextEmailPlan } from "@/modules/notifications/domain/email-plan";
import { readEmailPlan } from "@/modules/notifications/email-plan";
import { readEmailVolumeToday } from "@/modules/notifications/volume";
import { contactFormReaches } from "@/modules/contact/delivery";
import { readContactRecipients } from "@/modules/contact/recipients";
import { canManageRegistrations, canSeeDiagnostics } from "@/modules/staff-identity/domain/roles";
import { requireStaff } from "@/modules/staff-identity/session";
import { env } from "@/shared/config/env";
import { getPathname } from "@/i18n/navigation";
import SubNav from "@/shared/ui/SubNav";
import { DISCLOSURE_SUMMARY_SX } from "@/shared/ui/disclosure";

type Props = {
  params: Promise<{ locale: string }>;
  /** `?owner=club&kind=account` — the two filters (§150); anything else reads as "all". */
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export const dynamic = "force-dynamic";

/**
 * The panels this screen is divided into (§265; the owner: "partea de configurare ar trebui să
 * aibă subtaburi, pt status, general, mailuri, captcha, etc").
 *
 * What was owed, the anti-bot switch and the cost table were one scroll of about seven hundred
 * lines, so "where do I turn the captcha off" meant passing the whole checklist and the price of
 * every service on the way. Three panels:
 *
 * - `todo` — what is still owed, with its filters, and the decisions still open.
 * - `botCheck` — the one setting that lives here rather than a row about one (§254), because the
 *   club must be able to switch it off on the day it refuses real people.
 * - `costs` — what the club pays today and what the next thing to cost anything would cost.
 *
 * A query parameter, not three routes: each panel needs the same session and the same reading of
 * the system (`describeTasks`), so three routes would be three copies of this page's head.
 */
const TASK_PANELS = ["todo", "botCheck", "costs"] as const;
type TaskPanel = (typeof TASK_PANELS)[number];

/** The colour is the whole message for somebody scanning: red stops a registration today. */
const STATE_COLOR: Record<TaskState, "error" | "warning" | "success"> = {
  blocking: "error",
  // Set up and not working (§288): red like blocking, because it needs a hand today.
  broken: "error",
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
export default async function AdminTasksPage({ params, searchParams }: Props) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);

  // The filters, checked against the closed sets: a typed value nobody offered is "all".
  const query = await searchParams;
  const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);
  const panelRaw = first(query.panel);
  const panel: TaskPanel = TASK_PANELS.includes(panelRaw as TaskPanel) ? (panelRaw as TaskPanel) : "todo";
  const ownerRaw = first(query.owner);
  const kindRaw = first(query.kind);
  const filter = {
    owner: isTaskOwner(ownerRaw) ? ownerRaw : undefined,
    kind: isTaskKind(kindRaw) ? kindRaw : undefined,
  };

  const actor = await requireStaff();
  if (!canManageRegistrations(actor.role)) notFound();

  const db = getDb();
  const now = new Date();

  // Strings, because that is what the sub-nav takes (§265), and `getPathname` is a server
  // function so this is the only side of the boundary that can build them.
  const tasksPath = getPathname({ locale, href: "/admin/tasks" });
  const devsPath = getPathname({ locale, href: "/devs" });

  // The anti-bot switch (§254): read straight through, because this page is where it is moved.
  const botCheck = await readBotCheck(db);
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
  // Who reads what "Scrie-ne" sends (§164): the club's list, or `CONTACT_FORM_TO` behind it.
  const contactRecipients = await readContactRecipients(db);
  // The plan the club says it is on (§100): its price is a row on the cost table below.
  const emailPlan = await readEmailPlan(db);
  const emailPlanCeilings = emailCeilings(emailPlan);
  const emailNext = nextEmailPlan(emailPlan.plan);
  // One row is the Administrator inserted by hand; a second is somebody invited from
  // `/admin/staff`. The count is the whole of what "the team is invited" can mean here.
  const [{ staffCount }] = await db.select({ staffCount: count() }).from(staffUsers);
  /**
   * Whether the invitation key can create an account, asked of Zitadel with a real search
   * (§288) — the reader is signed in through it, so a key that cannot find them is a key that
   * cannot see accounts. Bounded inside; a provider that hangs answers `unreachable`.
   */
  const inviteKey = await checkInviteKey({ authMode: env.STAFF_AUTH_MODE, readerEmail: actor.email });

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
      inviteKey: { kind: inviteKey.kind, reason: "reason" in inviteKey ? inviteKey.reason : undefined },
      publishedEventCount,
      roDomainBound,
      storageConfigured: isStorageConfigured(),
      // Configured *and* switched on (§254): a row that said "done" while the check was off
      // would be the task board lying about a defence.
      botCheckConfigured: Boolean(env.TURNSTILE_SITE_KEY && env.TURNSTILE_SECRET_KEY) && botCheck.enabled,
      // The club's own setting first, the deployment's variable as the fallback (§244).
      declarationArchiveConfigured: volume.archiveConfigured,
      vercelUsageConfigured: Boolean(env.VERCEL_API_TOKEN && env.VERCEL_PROJECT_ID),
      // Capture counts, like local storage does: on a laptop the form works and nothing is
      // owed. Since §164 the recipients are the club's own, so the row asks the same question
      // the page does: is there a way out, and is there anybody at the other end.
      contactFormConfigured: contactFormReaches(env, contactRecipients),
    }),
  );

  const t = await getTranslations("Admin.tasks");
  // Over every row, filter or not: what blocks a real registration is not a matter of view.
  const blocking = tasks.filter((task) => task.state === "blocking").length;

  /**
   * What the list shows and what the counter counts are the same rows (§150): "De făcut: 2 ·
   * Gata: 3" describes the list under it, whichever filter is on. Each chip row keeps the
   * other's choice, so the two combine; a string href from `getPathname`, since a component
   * reference cannot cross into MUI's client component from here (the events listing's pattern).
   */
  const shown = filterTasks(tasks, filter);
  const counts = countTasks(shown);
  const filterHref = (patch: Partial<typeof filter>) => {
    const next = { ...filter, ...patch };
    return getPathname({
      locale,
      href: {
        pathname: "/admin/tasks",
        query: { ...(next.owner ? { owner: next.owner } : {}), ...(next.kind ? { kind: next.kind } : {}) },
      },
    });
  };
  const chipLook = (active: boolean) => ({
    color: active ? ("primary" as const) : ("default" as const),
    variant: active ? ("filled" as const) : ("outlined" as const),
  });

  const databaseBytes = await readDatabaseSizeBytes(db);
  const neon = await readNeonConsumption(env);
  const facts = {
    databaseBytes,
    neonCuHoursThisMonth: neon.ok ? neon.consumption.cuHours : null,
    neonHoursElapsed: neon.ok ? (now.getTime() - neon.consumption.periodStart.getTime()) / 3_600_000 : null,
    databaseStorageAllowanceBytes: NEON_FREE_STORAGE_BYTES,
    emailAllowance: volume.allowance,
    // Over the period that binds: today on Free, this month on a paid plan.
    emailSentToday: volume.period === "month" ? volume.sentThisMonth : volume.sentMessages,
    emailPlanName: volume.planName,
    emailPlanUsdPerMonth: emailPlanCeilings.usdPerMonth,
    emailPeriod: volume.period,
    emailNextPlan: emailNext ? { name: EMAIL_PLANS[emailNext].name, usdPerMonth: EMAIL_PLANS[emailNext].usdPerMonth } : null,
    // The archive copy and the hidden copies of every participant message, priced once in
    // `volume.ts` so this board and `/admin/emails` cannot disagree about a registration's cost.
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
  // Only what is still undecided: a settled question rendered "answered" for ever is a line to
  // scroll past, and the section disappears entirely when nothing is open.
  const decisions = moneyDecisions(facts).filter((decision) => decision.state === "open");
  const freshness = priceFreshness(oldestCheckDate(services), now);

  /** How close this service is to its ceiling, in that service's own words. */
  const neonMonthly = projectedNeonLaunchUsdPerMonth(facts);
  const howClose = (row: ServiceRow) => {
    if (row.headroom.kind === "measured") {
      const base = t(row.id === "mailgun" && volume.period === "month" ? "services.mailgun.closeMeasuredMonth" : `services.${row.id}.closeMeasured`, {
        used: row.headroom.used,
        of: row.headroom.of,
        left: registrationsLeft ?? 0,
        plan: volume.planName,
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
      // Mailgun with no ceiling at all (§100): the plan's name is the whole of the answer.
      if (row.id === "mailgun") return t("services.mailgun.closeNone", { plan: volume.planName });
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
        {/* The counter (§150; the owner: "show a counter of how many items are pending"):
            the rows below it, counted — so the figure follows the filter. */}
        <Typography variant="body1" sx={{ mt: 1, fontWeight: 500 }}>
          {t("summary", { pending: counts.pending, done: counts.done })}
        </Typography>
        {shown.length > 0 && counts.pending === 0 && (
          <Typography variant="body2" color="text.secondary">
            {t("allDone")}
          </Typography>
        )}
      </Box>

      <Box id="admin-alert" tabIndex={-1} sx={{ scrollMarginTop: 16 }}>
        {query.saved === "botCheckOn" && <Alert severity="success">{t("botCheck.savedOn")}</Alert>}
        {query.saved === "botCheckOff" && <Alert severity="warning">{t("botCheck.savedOff")}</Alert>}
        {query.saved === "honeypotOn" && <Alert severity="success">{t("botCheck.savedHoneypotOn")}</Alert>}
        {query.saved === "honeypotOff" && <Alert severity="warning">{t("botCheck.savedHoneypotOff")}</Alert>}
        {typeof query.error === "string" && <Alert severity="error">{t(`errors.${query.error}`)}</Alert>}
      </Box>

      <Alert severity={blocking > 0 ? "warning" : "success"}>
        {blocking > 0 ? t("blockingSummary", { count: blocking }) : t("nothingBlocking")}
      </Alert>

      {/* The panels (§265), and the system's own screen beside them: `/devs` answers "is it
          working" and this one answers "what do we still owe", which are two halves of one
          question the club asks together. */}
      <SubNav
        items={[
          ...TASK_PANELS.map((name) => ({
            href: name === "todo" ? tasksPath : `${tasksPath}?panel=${name}`,
            label: t(`panel.${name}`),
            active: panel === name,
          })),
          ...(canSeeDiagnostics(actor.role) ? [{ href: devsPath, label: t("panel.system") }] : []),
        ]}
      />

      {panel === "botCheck" && (
        <>
        {/* The one setting on this page rather than a row about one (§254): the anti-bot check,
            which the club must be able to switch off on the day it refuses real people. */}
        <BotCheckPanel locale={locale} state={botCheck} keysPresent={Boolean(env.TURNSTILE_SITE_KEY && env.TURNSTILE_SECRET_KEY)} />
        </>
      )}

      {panel === "todo" && (
        <>
        {/* Who and what kind — two rows of links, no client code, each keeping the other's
            choice (§150). The link is 44 px tall; the chip inside it is small. */}
        <Stack spacing={0.5}>
          <Stack component="nav" aria-label={t("filter.who")} direction="row" sx={{ flexWrap: "wrap", alignItems: "center", columnGap: 0.5 }}>
            <Typography variant="body2" color="text.secondary" sx={{ mr: 0.5 }}>
              {t("filter.who")}:
            </Typography>
            {[undefined, ...TASK_OWNERS].map((candidate) => (
              <Box
                key={candidate ?? "all"}
                component="a"
                href={filterHref({ owner: candidate })}
                aria-current={candidate === filter.owner ? "page" : undefined}
                sx={{ display: "inline-flex", alignItems: "center", minHeight: 44, textDecoration: "none" }}
              >
                <Chip size="small" label={candidate ? t(`owner.${candidate}`) : t("filter.all")} {...chipLook(candidate === filter.owner)} />
              </Box>
            ))}
          </Stack>
          <Stack component="nav" aria-label={t("filter.kind")} direction="row" sx={{ flexWrap: "wrap", alignItems: "center", columnGap: 0.5 }}>
            <Typography variant="body2" color="text.secondary" sx={{ mr: 0.5 }}>
              {t("filter.kind")}:
            </Typography>
            {[undefined, ...TASK_KINDS].map((candidate) => (
              <Box
                key={candidate ?? "all"}
                component="a"
                href={filterHref({ kind: candidate })}
                aria-current={candidate === filter.kind ? "page" : undefined}
                sx={{ display: "inline-flex", alignItems: "center", minHeight: 44, textDecoration: "none" }}
              >
                <Chip size="small" label={candidate ? t(`kind.${candidate}`) : t("filter.all")} {...chipLook(candidate === filter.kind)} />
              </Box>
            ))}
          </Stack>
        </Stack>

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
                  allowance: volume.allowance ?? "—",
                  resumesAt: email.resumesAt
                    ? new Intl.DateTimeFormat(locale === "ro" ? "ro-RO" : "en-GB", {
                        dateStyle: "medium",
                        timeStyle: "short", hourCycle: "h23",
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

        {shown.length === 0 && (
          <Typography variant="body2" color="text.secondary">
            {t("noneMatch")}
          </Typography>
        )}

        <Stack spacing={2} component="ul" aria-label={t("listLabel")} sx={{ listStyle: "none", m: 0, p: 0 }}>
          {shown.map((task) => (
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
                {/* And what sort of work it is — the same word the filter above uses. */}
                <Chip size="small" variant="outlined" label={t(`kind.${task.kind}`)} />
              </Stack>
              <Typography variant="h2" sx={{ fontSize: "1rem", mb: 0.5 }}>
                {t(`items.${task.id}.title`)}
              </Typography>
              {/* The row's own sentence for its state when `todo`/`done` cannot say it — a key
                  that is set and does not work is neither (§288). */}
              <Typography variant="body2" color="text.secondary">
                {t(`items.${task.id}.${task.text ?? (task.state === "done" ? "done" : "todo")}`, howValues)}
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
                  <Box component="summary" sx={{ ...DISCLOSURE_SUMMARY_SX, minHeight: 36, py: 0.5, fontSize: "0.875rem", fontWeight: 500 }}>
                    {t("howTitle")}
                  </Box>
                  <Box component="ol" sx={{ m: 0, mt: 1, pl: 2.5, "& li": { mb: 0.75 } }}>
                    {(t.raw(`items.${task.id}.${task.steps ?? "how"}`) as string[]).map((step, index) => (
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
        </>
      )}

      {panel === "costs" && (
        <>
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
            {t(`registrationsLeft.${volume.period}`, {
              count: registrationsLeft ?? "",
              sent: volume.period === "month" ? volume.sentThisMonth : volume.sentMessages,
              allowance: volume.allowance ?? "",
              plan: volume.planName,
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
        </>
      )}

      {panel === "todo" && (
        <>
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
        </>
      )}
    </Stack>
  );
}
