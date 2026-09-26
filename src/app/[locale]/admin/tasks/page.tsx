import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Chip from "@mui/material/Chip";
import Divider from "@mui/material/Divider";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound, redirect } from "next/navigation";
import type { ReactNode } from "react";
import { and, count, eq, gte, lte } from "drizzle-orm";
import { getDb } from "@/db/client";
import { events, eventTranslations } from "@/db/schema/events";
import { registrations } from "@/db/schema/registrations";
import { staffUsers } from "@/db/schema/staff-users";
import { CLUB_TIME_ZONE, formatCalendarDay, formatDay } from "@/i18n/dates";
import { routing } from "@/i18n/routing";
import { listPublishedEvents } from "@/modules/events/repository";
import { checkJobHealth } from "@/modules/jobs/health";
import { checkEmailHealth } from "@/modules/notifications/health";
import { findCurrentApprovedDocument, noticeDescribesListStates } from "@/modules/legal-documents/repository";
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
import { defaultTaskPanel, resolveTaskPanel, type TaskPanel, visibleTaskPanels } from "@/modules/diagnostics/domain/task-panels";
import { readClubTodo } from "@/modules/club-todo/club-todo";
import { canEditClubTodo, openClubTodoCount, resolveClubTodoOwner } from "@/modules/club-todo/domain/club-todo";
import ClubTodoPanel from "@/modules/club-todo/ui/ClubTodoPanel";
import { dayIn } from "@/modules/registrations/domain/age";
import { renderRepoDoc } from "@/modules/diagnostics/repo-docs";
import RepoDocHtml from "@/modules/diagnostics/ui/RepoDocHtml";
import { checkInviteKey } from "@/modules/diagnostics/invite-key";
import { isStorageConfigured } from "@/modules/media/storage";
import { readBotCheck } from "@/modules/registrations/bot-check";
import { probeTurnstileSecret } from "@/modules/registrations/turnstile";
import BotCheckPanel from "@/modules/registrations/ui/BotCheckPanel";
import {
  annualCostToday,
  freeTierVerdict,
  moneyDecisions,
  NEON_LAUNCH_USD_PER_CU_HOUR,
  NEON_LAUNCH_USD_PER_GB_MONTH,
  nextSpend,
  oldestCheckDate,
  platformServices,
  priceFreshness,
  registrationsLeftToday,
  ROMANIAN_VAT_PERCENT,
  type ServiceRow,
  type ServiceSeverity,
} from "@/modules/diagnostics/platform-plans";
import { readDatabaseSizeBytes } from "@/modules/diagnostics/database-size";
import { readNeonConsumption, readNeonLimits } from "@/modules/diagnostics/neon";
import { readNeonPlan } from "@/modules/diagnostics/neon-plan";
import { describeNeonBlock, effectiveNeonPlan } from "@/modules/diagnostics/domain/neon-plan";
import NeonLimitsPanel from "@/modules/diagnostics/ui/NeonLimitsPanel";
import NeonPlanPanel from "@/modules/diagnostics/ui/NeonPlanPanel";
import { readJobCadence } from "@/modules/jobs/cadence";
import { describeJob } from "@/modules/jobs/overview";
import type { JobName } from "@/modules/jobs/schedule";
import JobCadencePanel from "@/modules/jobs/ui/JobCadencePanel";
import { neonCuHoursPerDay, projectedNeonLaunchUsdPerMonth } from "@/modules/diagnostics/platform-plans";
import { EMAIL_PLANS, emailCeilings, nextEmailPlan } from "@/modules/notifications/domain/email-plan";
import { readDeliveryTiming } from "@/modules/notifications/delivery-timing";
import { readEmailPlan } from "@/modules/notifications/email-plan";
import { readEmailVolumeToday } from "@/modules/notifications/volume";
import { contactFormReaches } from "@/modules/contact/delivery";
import { readContactRecipients } from "@/modules/contact/recipients";
import { canManageRegistrations } from "@/modules/staff-identity/domain/roles";
import { requireStaff } from "@/modules/staff-identity/session";
import { env } from "@/shared/config/env";
import { getPathname } from "@/i18n/navigation";
import SubNav from "@/shared/ui/SubNav";
import { BOXED_DISCLOSURE_SX } from "@/shared/ui/disclosure";
import { CLUB_NAME } from "@/theme/brand";

type Props = {
  params: Promise<{ locale: string }>;
  /** `?owner=club&kind=account` — the two filters (§150); anything else reads as "all". */
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export const dynamic = "force-dynamic";

/**
 * The panels this screen is divided into (§265; the owner: "partea de configurare ar trebui să
 * aibă subtaburi, pt status, general, mailuri, captcha, etc") — the set and the gate live in
 * `modules/diagnostics/domain/task-panels.ts` now, so the role boundary is one pure function
 * rather than something read off this page's markup.
 *
 * What was owed, the anti-bot switch and the cost table were one scroll of about seven hundred
 * lines, so "where do I turn the captcha off" meant passing the whole checklist and the price of
 * every service on the way. Five panels:
 *
 * - `club` — «Club»: what is still owed, read from the system, with its filters, and the
 *   decisions still open. It was `todo`, «De făcut», until §NNN, and it is still where a bare
 *   `/admin/tasks` lands for the Administrator and the Superadministrator.
 * - `todo` — «De făcut»: the club's own checklist, typed and ticked by hand (§NNN,
 *   `modules/club-todo`), for every role from the Redactor up.
 * - `botCheck` — the one setting that lives here rather than a row about one (§254), because the
 *   club must be able to switch it off on the day it refuses real people.
 * - `costs` — what the club pays today and what the next thing to cost anything would cost.
 * - `app` — `docs/QUEUE.md`, the dispatcher's own work queue, read-only (§368, §397).
 *
 * A query parameter, not five routes: each panel needs the same session and the same reading of
 * the system (`describeTasks`), so five routes would be five copies of this page's head.
 */

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
  const ownerRaw = first(query.owner);
  const kindRaw = first(query.kind);
  const filter = {
    owner: isTaskOwner(ownerRaw) ? ownerRaw : undefined,
    kind: isTaskKind(kindRaw) ? kindRaw : undefined,
  };

  const actor = await requireStaff();
  const isOps = canManageRegistrations(actor.role);

  // Strings, because that is what the sub-nav takes (§265), and `getPathname` is a server
  // function so this is the only side of the boundary that can build them.
  const tasksPath = getPathname({ locale, href: "/admin/tasks" });
  const devsPath = getPathname({ locale, href: "/devs" });

  /**
   * `resolveTaskPanel` (`modules/diagnostics/domain/task-panels.ts`) is the one gate: `null`
   * means a panel this role may not see. `layout.tsx` has already refused any role that may
   * open no panel here at all — a real 404, decided before `loading.tsx`'s Suspense boundary
   * can flush a 200 (see its own comment). This page can still be asked, by a typed address,
   * for a panel the *admitted* role may not see (Tehnic asking for `?panel=costs`), and a
   * `notFound()` thrown from here is exactly the 200-with-not-found-body that guard exists to
   * avoid — so a mismatch here lands on that role's own default panel instead.
   */
  // «Club» is the bare address (the owner, 2026-09-26: "by default I need to be on the «Club»
  // tab"); every other panel names itself, so a link to one keeps working as it always did.
  const panelHref = (name: TaskPanel) => (name === "club" ? tasksPath : `${tasksPath}?panel=${name}`);
  const landing = defaultTaskPanel(actor.role);
  // `layout.tsx` has already refused a role with no panel here; this is the type's own guard.
  if (landing === null) notFound();
  const requestedPanel = resolveTaskPanel(actor.role, panelRaw);
  const panel: TaskPanel = requestedPanel ?? landing;
  if (panelRaw !== undefined && requestedPanel === null) {
    redirect(panelHref(landing));
  }

  const t = await getTranslations("Admin.tasks");
  /*
    The club's checklist (§NNN), read on every panel: its open count is in the «De făcut» tab's
    label, which every panel's sub-navigation carries — one small row, the list itself.
  */
  const clubTodo = await readClubTodo(getDb());
  const openTodo = openClubTodoCount(clubTodo.items);
  // «Club», «De făcut», «Anti-robot», «Costuri», then «Sistem» (the link to `/devs`) and
  // «Aplicația» after it (§397). Each role sees the panels its own gates open (`task-panels.ts`).
  const subNavItems = visibleTaskPanels(actor.role).flatMap((name) => [
    ...(name === "app" ? [{ href: devsPath, label: t("panel.system") }] : []),
    {
      href: panelHref(name),
      label: name === "todo" && openTodo > 0 ? t("panel.todoCount", { count: openTodo }) : t(`panel.${name}`),
      active: panel === name,
    },
  ]);

  /**
   * «De făcut»: the club's own checklist (§NNN). Like «Aplicația», it needs none of the system
   * reading below, so it answers on its own — the whole of this page for a Redactor or an
   * Organizer, who may open nothing else here.
   */
  if (panel === "todo") {
    const tErrors = await getTranslations("Admin.errors");
    const errorCode = first(query.error);
    const errorKnown = typeof errorCode === "string" && /^[A-Z_]{1,64}$/.test(errorCode) && tErrors.has(errorCode);
    return (
      <Stack spacing={3} sx={{ py: { xs: 2, sm: 3 } }}>
        <Box>
          <Typography variant="h1" sx={{ fontSize: "1.5rem" }} gutterBottom>
            {t("title")}
          </Typography>
        </Box>
        <SubNav label={t("title")} items={subNavItems} />
        <ClubTodoPanel
          locale={locale}
          items={clubTodo.items}
          mayEdit={canEditClubTodo(actor.role)}
          owner={resolveClubTodoOwner(clubTodo.items, first(query.for))}
          today={dayIn(new Date(), CLUB_TIME_ZONE)}
          error={errorKnown ? tErrors(errorCode) : undefined}
        />
      </Stack>
    );
  }

  /**
   * The app tab: `docs/QUEUE.md`, rendered read-only through the same renderer `/devs/docs`
   * uses (`repo-docs.ts`, `DECISIONS.md` §88, §397). It needs none of the club's registration
   * or money data below, so it answers on its own — the only path a Tehnic-only session ever
   * reaches, and the lightest one for an Administrator who just wants to read the queue.
   *
   * The lead line is one sentence in the reader's own language — the "multi-lingual, always"
   * rule (§352) is about text the club types, not this screen's own words, and every other
   * lead line in the backoffice is one language. The document itself stays in the one language
   * it is written in (English, the dispatcher's own working language); the line above it says
   * so, in the reader's language, and never prints the other one beside it.
   */
  if (panel === "app") {
    const doc = await renderRepoDoc("QUEUE");
    return (
      <Stack spacing={3} sx={{ py: { xs: 2, sm: 3 } }}>
        <Box>
          <Typography variant="h1" sx={{ fontSize: "1.5rem" }} gutterBottom>
            {t("title")}
          </Typography>
        </Box>
        <SubNav label={t("title")} items={subNavItems} />
        {doc ? (
          <>
            <Typography variant="body2" color="text.secondary">
              {t("app.lead")}
            </Typography>
            <RepoDocHtml html={doc.html} />
          </>
        ) : (
          <Typography variant="body2" color="text.secondary">
            {t("app.missing")}
          </Typography>
        )}
      </Stack>
    );
  }

  if (!isOps) notFound();

  const db = getDb();
  const now = new Date();

  // The anti-bot switch (§254): read straight through, because this page is where it is moved.
  const botCheck = await readBotCheck(db);
  // Whether the configured secret works, not merely whether it is set (§420, finding (10)'s
  // health half) — cached fifteen minutes, same as `/api/health`.
  const botCheckHealth = await probeTurnstileSecret();
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
  /**
   * The events whose downloaded lists and printed sheets are due for the shredder (§323): seven
   * to thirty days after the start, and only those that took at least one real registration
   * here — an event with none (or only TEST rows, §30) left nothing on anybody's laptop. A title
   * once, however many dates of a series fall in the window (review finding).
   *
   * Whatever the event's publication state now (§324): a race unpublished or archived after
   * race day left its exports and sheets behind all the same.
   */
  const day = 24 * 60 * 60_000;
  const shredderRows = await db
    .selectDistinct({ eventId: events.id, title: eventTranslations.title })
    .from(events)
    .innerJoin(registrations, and(eq(registrations.eventId, events.id), eq(registrations.kind, "REAL")))
    .leftJoin(eventTranslations, and(eq(eventTranslations.eventId, events.id), eq(eventTranslations.locale, locale)))
    .where(
      and(
        eq(events.registrationMode, "INTERNAL"),
        gte(events.startsAt, new Date(now.getTime() - 30 * day)),
        lte(events.startsAt, new Date(now.getTime() - 7 * day)),
      ),
    );
  const raceDaySheetsDue = [...new Set(shredderRows.map((row) => row.title ?? row.eventId))];
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
   * The club's name from its one constant, and the sender's from the setting the From line
   * reads (§369): a step that names either says what this deployment actually uses.
   */
  const apex = clubDomainBound ? hostname.split(".").slice(-2).join(".") : hostname;
  const howValues: Record<string, string> = {
    club: CLUB_NAME,
    senderName: env.EMAIL_FROM_NAME,
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
  const staleJobNames = jobs.filter((job) => job.status === "stale" || job.status === "never_run").map((job) => job.jobName);
  // A job that runs on time and fails its retention sweep (§322) is not a missing monitor (§324).
  const failingJobNames = jobs.filter((job) => job.status === "failing").map((job) => job.jobName);

  // Read early, ahead of the task board: the derived `neonLimits` row (§335) needs this
  // period's quota and spend on every panel, not only Costuri, where the full endpoint detail
  // (`readNeonLimits`, the two extra requests) stays gated — the task board's own row only
  // needs the same project row `readNeonConsumption` already fetches.
  const [neon, neonLimits] = await Promise.all([
    readNeonConsumption(env),
    panel === "costs" ? readNeonLimits(env) : Promise.resolve(null),
  ]);

  const tasks = sortTasks(
    ownerTasks({
      hasApprovedPrivacyNotice: Boolean(privacyNotice),
      // §396: the text in force switches the public list's states on, in every language.
      listStatesDescribed: await noticeDescribesListStates(db, now),
      // The sample documents say so in their own titles, in both languages — the same banner a
      // visitor reads on the public page. Nothing else distinguishes them from the real thing,
      // which is deliberate: a sample that could be mistaken for approved wording is the risk.
      legalTextIsSample: /EXEMPLU|SAMPLE/i.test(privacyNotice?.title ?? ""),
      emailDeliveryMode: env.EMAIL_DELIVERY_MODE,
      appEnv: env.APP_ENV,
      staleJobNames,
      failingJobNames,
      staffCount,
      inviteKey: { kind: inviteKey.kind, reason: "reason" in inviteKey ? inviteKey.reason : undefined },
      publishedEventCount,
      raceDaySheetsDue,
      roDomainBound,
      storageConfigured: isStorageConfigured(),
      // Configured *and* switched on (§254): a row that said "done" while the check was off
      // would be the task board lying about a defence.
      botCheckConfigured: Boolean(env.TURNSTILE_SITE_KEY && env.TURNSTILE_SECRET_KEY) && botCheck.enabled,
      botCheckHealth,
      // The club's own setting first, the deployment's variable as the fallback (§244).
      declarationArchiveConfigured: volume.archiveConfigured,
      vercelUsageConfigured: Boolean(env.VERCEL_API_TOKEN && env.VERCEL_PROJECT_ID),
      // Capture counts, like local storage does: on a laptop the form works and nothing is
      // owed. Since §164 the recipients are the club's own, so the row asks the same question
      // the page does: is there a way out, and is there anybody at the other end.
      contactFormConfigured: contactFormReaches(env, contactRecipients),
      // The same reading the Costuri panel shows, never a second request (§335): null when
      // Neon could not be read at all, so "no quota" and "we could not check" both read `open`.
      neonQuota: neon.ok ? { quotaCuHours: neon.consumption.quotaCuHours, usedCuHours: neon.consumption.cuHours } : null,
    }),
  );

  // The refusal codes (`?error=FORBIDDEN|VALIDATION_ERROR`, from the Neon and Mailgun plan actions) are
  // `Admin.errors.*`, shared by every backoffice page — `Admin.tasks.errors` does not exist.
  const tErrors = await getTranslations("Admin.errors");
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
    runs, and what each job did with it — read only for the panel that shows it, since the
    overview asks the cache and, when the cache does not answer here, the database.
  */
  const [jobCadence, deliveryTiming] = await Promise.all([
    readJobCadence(db),
    // Whether the interval delays email too (§221): the panel's sentence about email follows it.
    readDeliveryTiming(db),
  ]);
  const jobOverviews =
    panel === "costs"
      ? await Promise.all(
          jobs.map((job) =>
            describeJob(db, {
              job: job.jobName as JobName,
              now,
              cadenceMinutes: jobCadence.minutes,
              lastFinishedAt: job.lastFinishedAt,
            }),
          ),
        )
      : [];
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
  const neonPerDay = neonCuHoursPerDay(facts);
  // The rates the projection was made at, from the one catalogue, so the sentence quotes what
  // the arithmetic used — and the catalogue is the only file that knows a price.
  const neonRates = {
    rate: neonBlock.rates?.usdPerCuHour ?? NEON_LAUNCH_USD_PER_CU_HOUR,
    storageRate: neonBlock.rates?.usdPerGbMonth ?? NEON_LAUNCH_USD_PER_GB_MONTH,
  };
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
          ? `${base} ${t("services.neon.monthly", { cu: Math.round(neon.consumption.cuHours), usd: neonMonthly.toFixed(2), ...neonRates })}`
          : `${base} ${t("services.neon.monthlyUnknown", neonRates)}`;
      }
      return base;
    }
    if (row.headroom.kind === "derived") {
      // Mailgun with no ceiling at all (§100): the plan's name is the whole of the answer.
      if (row.id === "mailgun") return t("services.mailgun.closeNone", { plan: volume.planName });
      // Neon on Launch: no ceiling, so "how close" is "what does this month cost" — the
      // projection at the current pace and the daily rate it was made from, named an estimate.
      if (row.id === "neon" && row.variant === "launch") {
        return neon.ok && neonMonthly !== null && neonPerDay !== null
          ? t("services.neon.launch.close", { cu: Math.round(neon.consumption.cuHours), perDay: neonPerDay, usd: neonMonthly.toFixed(2), ...neonRates })
          : t("services.neon.launch.closeUnknown", neonRates);
      }
      return t(`services.${row.id}.${row.headroom.reached ? "closeYes" : "closeNo"}`);
    }
    return t(`services.${row.id}.closeUnknown`);
  };
  /** The row's fixed sentences, read under the plan's own wording where the plan changes what is true. */
  const wording = (row: ServiceRow, key: "freeGives" | "ceiling" | "whenCrossed" | "bumpBack") =>
    t(row.variant ? `services.${row.id}.${row.variant}.${key}` : `services.${row.id}.${key}`);

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
        {query.saved === "neonPlan" && <Alert severity="success">{t("neonPlan.saved")}</Alert>}
        {query.saved === "jobCadence" && <Alert severity="success">{t("jobCadence.saved")}</Alert>}
        {query.saved === "neonLimits" && <Alert severity="success">{t("neonLimits.saved")}</Alert>}
        {query.saved === "neonLimitsSame" && <Alert severity="info">{t("neonLimits.savedSame")}</Alert>}
        {typeof query.error === "string" && <Alert severity="error">{tErrors(query.error)}</Alert>}
      </Box>

      <Alert severity={blocking > 0 ? "warning" : "success"}>
        {blocking > 0 ? t("blockingSummary", { count: blocking }) : t("nothingBlocking")}
      </Alert>

      {/* The panels (§265), and the system's own screen beside them: `/devs` answers "is it
          working" and this one answers "what do we still owe", which are two halves of one
          question the club asks together. */}
      <SubNav label={t("title")} items={subNavItems} />

      {panel === "botCheck" && (
        <>
        {/* The one setting on this page rather than a row about one (§254): the anti-bot check,
            which the club must be able to switch off on the day it refuses real people. */}
        <BotCheckPanel locale={locale} state={botCheck} keysPresent={Boolean(env.TURNSTILE_SITE_KEY && env.TURNSTILE_SECRET_KEY)} />
        </>
      )}

      {panel === "club" && (
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
                    ? formatDay(new Date(email.resumesAt), { locale, timeZone: CLUB_TIME_ZONE, style: "short", withTime: true, position: "inline" })
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
                <Box component="details" sx={{ ...BOXED_DISCLOSURE_SX, mt: 1.5 }}>
                  <Box component="summary" sx={{ fontSize: "0.875rem", fontWeight: 500 }}>
                    {t("howTitle")}
                  </Box>
                  <Box component="ol" sx={{ m: 0, pl: 2.5, "& li": { mb: 0.75 } }}>
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
          The one setting on this panel (§280's follow-up): which Neon plan the account is on.
          Above the figures that follow it, so a plan set wrong shows here before it shows on
          the invoice. This page is the Administrator's already (`canManageRegistrations` at the
          door), so `mayEdit` is true for every reader who gets this far; the prop stays for the
          same reason the Mailgun panel carries it (§291).
        */}
        <NeonPlanPanel locale={locale} plan={neonPlan} source={neonInForce.source} block={neonBlock} mayEdit={canManageRegistrations(actor.role)} />

        {/* How often the platform may wake the database for its scheduled work (§334) — the
            throttle the owner asked for, beside the plan that bills each wake. */}
        <JobCadencePanel
          locale={locale}
          cadence={jobCadence}
          jobs={jobOverviews}
          mayEdit={canManageRegistrations(actor.role)}
          emailTiming={deliveryTiming.timing}
        />

        {/*
          The database's brakes (§335), beside the plan they are priced against: the compute's size
          ceiling and the period's CU-hour limit, read from Neon and written to Neon. The same
          door and the same `mayEdit` as the plan; `updateNeonLimits` asserts the role again.
        */}
        {neonLimits && (
          <NeonLimitsPanel
            locale={locale}
            reading={neonLimits.ok ? { ok: true, limits: neonLimits.snapshot.limits } : { ok: false, failure: neonLimits.failure }}
            appEnv={env.APP_ENV}
            mayEdit={canManageRegistrations(actor.role)}
          />
        )}

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
              {/* A total with a projection in it is not an invoice, and the sentence says so beside the number. */}
              {paidToday.some((total) => total.estimated) && ` ${t("costToday.estimated")}`}
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
                  <Fact label={t("field.howClose")}>{howClose(row)}</Fact>
                  <Fact label={t("field.nextPlan")}>
                    {row.nextPlan ? `${row.nextPlan} — ${row.nextCost}` : t("nextPlanNone")}
                  </Fact>
                </Box>

                <Typography variant="body2" color="text.secondary" sx={{ mb: 0.5 }}>
                  {wording(row, "freeGives")}
                </Typography>
                <Typography variant="body2" color="text.secondary" sx={{ mb: 0.5 }}>
                  <strong>{wording(row, "ceiling")}</strong> {wording(row, "whenCrossed")}
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
        </>
      )}

      {panel === "club" && (
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
