import HelpOutlineIcon from "@mui/icons-material/HelpOutlineOutlined";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Chip from "@mui/material/Chip";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound, redirect } from "next/navigation";
import { and, eq, gte, lte } from "drizzle-orm";
import { getDb } from "@/db/client";
import { events, eventTranslations } from "@/db/schema/events";
import { registrations } from "@/db/schema/registrations";
import { countBackofficeStaff } from "@/modules/staff-identity/repository";
import { CLUB_TIME_ZONE, formatCalendarDay, formatDay } from "@/i18n/dates";
import { routing } from "@/i18n/routing";
import { listPublishedEvents } from "@/modules/events/repository";
import { checkJobHealth } from "@/modules/jobs/health";
import { checkEmailHealth } from "@/modules/notifications/health";
import {
  findCurrentApprovedDocument,
  noticeDescribesListSocials,
  noticeDescribesListStates,
  noticeDescribesNewsletter,
  noticeDescribesTeamPage,
  raceDeclarationsCurrent,
  groupRunDeclarationsSeriesCurrent,
} from "@/modules/legal-documents/repository";
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
import { countOlderPictures } from "@/modules/media/older-pictures";
import { isStorageConfigured } from "@/modules/media/storage";
import OlderPicturesPanel from "@/modules/media/ui/OlderPicturesPanel";
import { readBotCheck } from "@/modules/registrations/bot-check";
import { probeTurnstileSecret } from "@/modules/registrations/turnstile";
import { moneyDecisions } from "@/modules/diagnostics/platform-plans";
import { TASK_TARGETS } from "@/modules/diagnostics/domain/task-targets";
import TaskTargetLink from "@/modules/diagnostics/ui/TaskTargetLink";
import { readNeonConsumption } from "@/modules/diagnostics/neon";
import { domainRenewal } from "@/modules/diagnostics/domain/domain-renewal";
import { readNeonBudget } from "@/modules/diagnostics/neon-budget";
import { isTranslationConfigured } from "@/infrastructure/translate/translator";
import { readTranslationCredit } from "@/modules/translate/credit";
import { readEmailVolumeToday } from "@/modules/notifications/volume";
import { contactFormReaches } from "@/modules/contact/delivery";
import { readContactRecipients } from "@/modules/contact/recipients";
import { canManageClubSettings, canManageRegistrations } from "@/modules/staff-identity/domain/roles";
import { requireStaff } from "@/modules/staff-identity/session";
import { env } from "@/shared/config/env";
import { getPathname } from "@/i18n/navigation";
import SubNav from "@/shared/ui/SubNav";
import { BOXED_DISCLOSURE_SX, FOLD_GLYPH_SX } from "@/shared/ui/disclosure";
import { CLUB_NAME } from "@/theme/brand";

type Props = {
  params: Promise<{ locale: string }>;
  /** `?owner=club&kind=account` — the two filters (§150); anything else reads as "all". */
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export const dynamic = "force-dynamic";

/**
 * A Server Action runs in the function of the page it is posted from, so this is also the older
 * pictures' button's ceiling (§430): a press starts no new picture after twelve seconds
 * (`OLDER_PICTURES_BUDGET_MS`) and ends within about twenty; the upload routes' own sixty is the
 * room a slow last picture finishes in.
 */
export const maxDuration = 60;

/**
 * The panels this screen is divided into (§265; the owner: "partea de configurare ar trebui să
 * aibă subtaburi, pt status, general, mailuri, captcha, etc") — the set and the gate live in
 * `modules/diagnostics/domain/task-panels.ts` now, so the role boundary is one pure function
 * rather than something read off this page's markup.
 *
 * What was owed, the anti-bot switch and the cost table were one scroll of about seven hundred
 * lines, so "where do I turn the captcha off" meant passing the whole checklist and the price of
 * every service on the way. Five panels, then three since §516, which moved «Anti-robot» and
 * «Costuri» to «Setări» → «Anti-robot» and «Costuri» (their old `?panel=` answers 308 there):
 *
 * - `club` — «Club»: what is still owed, read from the system, with its filters, and the
 *   decisions still open. It was `todo`, «De făcut», until §438, and it is still where a bare
 *   `/admin/tasks` lands for the Administrator and the Superadministrator. A row whose work is a
 *   screen of this backoffice links to it, the card opened by the `#` (`task-targets.ts`, §516).
 * - `todo` — «De făcut»: the club's own checklist, typed and ticked by hand (§438,
 *   `modules/club-todo`), for every role from the Redactor up.
 * - `app` — `docs/QUEUE.md`, the dispatcher's own work queue, read-only (§368, §397).
 *
 * A query parameter, not three routes: each panel needs the same session and the same reading of
 * the system (`describeTasks`), so three routes would be three copies of this page's head.
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
 * What is still owed — for the people who owe it.
 *
 * `/devs` is for whoever reads a status enum; this is for the club. What it costs was the second
 * half of this page until §516 moved it, whole, to «Setări» → «Costuri» (§479): a setting and its
 * price are not something owed. Here stay the rows, the open money questions beneath them, and a
 * link from each row to the screen where it is done.
 *
 * Every line is derived from what this deployment reports, never from a checklist somebody has to
 * remember to tick (`AGENTS.md` §1.2).
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
   * for a panel the *admitted* role may not see (Tehnic asking for `?panel=club`), and a
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
    The club's checklist (§438), read on every panel: its open count is in the «De făcut» tab's
    label, which every panel's sub-navigation carries — one small row, the list itself.
  */
  const clubTodo = await readClubTodo(getDb());
  const openTodo = openClubTodoCount(clubTodo.items);
  // «Club», «De făcut», then «Sistem» (the link to `/devs`) and «Aplicația» after it (§397);
  // «Anti-robot» and «Costuri» are «Setări» tabs since §516. Each role sees the panels its own
  // gates open (`task-panels.ts`).
  const subNavItems = visibleTaskPanels(actor.role).flatMap((name) => [
    ...(name === "app" ? [{ href: devsPath, label: t("panel.system") }] : []),
    {
      href: panelHref(name),
      label: name === "todo" && openTodo > 0 ? t("panel.todoCount", { count: openTodo }) : t(`panel.${name}`),
      active: panel === name,
    },
  ]);

  /**
   * «De făcut»: the club's own checklist (§438). Like «Aplicația», it needs none of the system
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

  // The anti-bot switch (§254), for its row: switched on «Setări» → «Anti-robot» since §516.
  const botCheck = await readBotCheck(db);
  // Whether the configured secret works, not merely whether it is set (§420, finding (10)'s
  // health half) — cached fifteen minutes, same as `/api/health`.
  const botCheckHealth = await probeTurnstileSecret();
  const privacyNotice = await findCurrentApprovedDocument(db, "PRIVACY_NOTICE", locale, now);
  // The month's budget as the governor reads it (§447) — Neon's API through the shared reading,
  // never the database — for the health checks' thresholds and the "Bugetul lunii" card.
  const budget = await readNeonBudget(now);
  const jobs = await Promise.all([
    checkJobHealth(db, "email-outbox", now, budget.effects.jobFloorMinutes),
    checkJobHealth(db, "registration-maintenance", now, budget.effects.jobFloorMinutes),
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
  const email = await checkEmailHealth(db, now, budget.effects.jobFloorMinutes);
  // Who reads what "Scrie-ne" sends (§164): the club's list, or `CONTACT_FORM_TO` behind it.
  const contactRecipients = await readContactRecipients(db);
  // One row is the Administrator inserted by hand; a second is somebody invited from
  // `/admin/staff`. The count is the whole of what "the team is invited" can mean here — the team,
  // so a club member's account (§524) is not a colleague and is not counted.
  const staffCount = await countBackofficeStaff(db);
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
   * rather than two.
   */
  const hostname = new URL(env.APP_BASE_URL).hostname;
  const clubDomainBound =
    !/vercel\.app$/i.test(hostname) && !/^(localhost|127\.0\.0\.1|\[::1\])$/i.test(hostname);
  // When the domain expires (§435): the two dates from the environment, the arithmetic pure.
  const domain = domainRenewal(env.DOMAIN_REGISTERED_ON, env.DOMAIN_RENEWAL_YEARS, now);

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
    // The renewal row's sentence (§435): the expiry as a day a person reads, and the years paid.
    domainExpiresOn:
      domain.status === "unknown" ? "" : formatCalendarDay(domain.expiresOn, { locale, style: "long", position: "inline" }),
    renewalYears: String(env.DOMAIN_RENEWAL_YEARS),
  };
  /** `t.raw` returns the catalogue's array untouched, so the values are filled in here. */
  const fill = (step: string) =>
    step.replace(/\{(\w+)\}/g, (match, key: string) => howValues[key] ?? match);
  // Which ones, not how many: a single missing monitor and a stopped scheduler are the same
  // count and different problems.
  const staleJobNames = jobs.filter((job) => job.status === "stale" || job.status === "never_run").map((job) => job.jobName);
  // A job that runs on time and fails its retention sweep (§322) is not a missing monitor (§324).
  const failingJobNames = jobs.filter((job) => job.status === "failing").map((job) => job.jobName);

  // Read early, ahead of the task board: the derived `neonLimits` row (§335) needs this
  // period's quota and spend — the same project row `readNeonConsumption` fetches; the brakes'
  // full reading (`readNeonLimits`) is «Setări» → «Costuri»'s alone (§516).
  // DeepL's credit from its own meter (§497), cached an hour and a failure remembered a minute,
  // asked beside Neon rather than after it: the translation row reads it here, and «Costuri»
  // reads the same cached answer. No key, no request.
  const [neon, deeplCredit] = await Promise.all([readNeonConsumption(env), readTranslationCredit(env)]);
  // The credit's own figures for the translation row's sentence (§497), in the reader's numbers;
  // an unread credit gives the row its reason instead.
  if (deeplCredit.ok) {
    const figure = new Intl.NumberFormat(locale === "ro" ? "ro-RO" : "en-GB");
    Object.assign(howValues, {
      creditUsed: figure.format(deeplCredit.credit.used),
      creditLimit: figure.format(deeplCredit.credit.limit),
      creditRemaining: figure.format(deeplCredit.credit.remaining),
      creditPercent: new Intl.NumberFormat(locale === "ro" ? "ro-RO" : "en-GB", { style: "percent", maximumFractionDigits: 0 }).format(deeplCredit.credit.share),
    });
  } else if (deeplCredit.reason !== "unconfigured") {
    howValues.creditReason = t(`translationBudget.credit.unread.${deeplCredit.reason}`);
  }

  const tasks = sortTasks(
    ownerTasks({
      hasApprovedPrivacyNotice: Boolean(privacyNotice),
      // §396: the text in force switches the public list's states on, in every language.
      listStatesDescribed: await noticeDescribesListStates(db, now),
      // §500: the same switch for Strava and Instagram beside a name on the public list.
      listSocialsDescribed: await noticeDescribesListSocials(db, now),
      // §445: the same switch for the newsletter's pop-up on the contact page.
      newsletterDescribed: await noticeDescribesNewsletter(db, now),
      // §459: the team page's names and photographs, described by the notice in force.
      teamPageDescribed: await noticeDescribesTeamPage(db, now),
      // §515: both race declarations, trail and road or park, from the platform's shared body.
      raceDeclarationsCurrent: await raceDeclarationsCurrent(db, now),
      // §523: the group-run declarations written for one signature per series; null while none is in force.
      groupRunSeriesTextsCurrent: await groupRunDeclarationsSeriesCurrent(db, now),
      // The sample documents say so in their own titles, in both languages — the same banner a
      // visitor reads on the public page. Nothing else distinguishes them from the real thing,
      // which is deliberate: a sample that could be mistaken for approved wording is the risk.
      legalTextIsSample: /EXEMPLU|SAMPLE/i.test(privacyNotice?.title ?? ""),
      emailDeliveryMode: env.EMAIL_DELIVERY_MODE,
      appEnv: env.APP_ENV,
      staleJobNames,
      failingJobNames,
      staffCount,
      inviteKey: {
        kind: inviteKey.kind,
        reason: "reason" in inviteKey ? inviteKey.reason : undefined,
        capped: inviteKey.kind === "capped" || (inviteKey.kind === "ok" && !inviteKey.complete),
      },
      publishedEventCount,
      raceDaySheetsDue,
      domainRenewal: domain,
      storageConfigured: isStorageConfigured(),
      // Configured *and* switched on (§254): a row that said "done" while the check was off
      // would be the task board lying about a defence.
      botCheckConfigured: Boolean(env.TURNSTILE_SITE_KEY && env.TURNSTILE_SECRET_KEY) && botCheck.enabled,
      botCheckHealth,
      // The club's own setting first, the deployment's variable as the fallback (§244).
      declarationArchiveConfigured: volume.archiveConfigured,
      vercelUsageConfigured: Boolean(env.VERCEL_API_TOKEN && env.VERCEL_PROJECT_ID),
      // «Tradu din română» (§464): DeepL chosen and its key set; `off` reads as done — nothing owed.
      translationConfigured: isTranslationConfigured(env) || env.TRANSLATE_PROVIDER === "off",
      translationCredit: deeplCredit,
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
  /*
    The older pictures' button (§430), on the list of what is owed while anything is left to
    convert — one count, only for this panel, and nothing where there is no store to convert in.
  */
  const olderPictures = panel === "club" && isStorageConfigured() ? await countOlderPictures(db) : 0;
  /*
    How many the press just made failed, from the address the action lands on — said on the card
    with what to do, not only in the toast that fades (§430). A number and nothing else; any other
    value reads as none.
  */
  const failedRaw = query.saved === "picturesLadderedFailed" ? Number(first(query.failed)) : 0;
  const lastPressFailed = Number.isSafeInteger(failedRaw) && failedRaw > 0 ? failedRaw : 0;
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

  // Only what is still undecided: a settled question rendered "answered" for ever is a line to
  // scroll past, and the section disappears entirely when nothing is open. It reads one fact since
  // the cost table moved to «Setări» → «Costuri» (§516).
  const decisions = moneyDecisions({ hasPaidEvent }).filter((decision) => decision.state === "open");

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
        {typeof query.error === "string" && <Alert severity="error">{tErrors(query.error)}</Alert>}
      </Box>

      <Alert severity={blocking > 0 ? "warning" : "success"}>
        {blocking > 0 ? t("blockingSummary", { count: blocking }) : t("nothingBlocking")}
      </Alert>

      {/* The panels (§265), and the system's own screen beside them: `/devs` answers "is it
          working" and this one answers "what do we still owe", which are two halves of one
          question the club asks together. */}
      <SubNav label={t("title")} items={subNavItems} />

      {panel === "club" && (
        <>
        {/* A thing owed once (§430): the pictures from before §414 get their phone sizes. Gone at zero. */}
        {olderPictures > 0 && canManageClubSettings(actor.role) && <OlderPicturesPanel locale={locale} left={olderPictures} lastFailed={lastPressFailed} />}

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
              // An address for the row: the editors' grey «Copiază și tradu tot» links `#task-translation` (§482).
              id={`task-${task.id}`}
              sx={{ border: 1, borderColor: "divider", borderRadius: 1, p: 2, scrollMarginTop: 16 }}
            >
              <Stack direction="row" spacing={1} sx={{ mb: 1, flexWrap: "wrap", gap: 1 }}>
                <Chip size="small" color={STATE_COLOR[task.state]} label={task.label ? t(`stateLabel.${task.label}`) : t(`state.${task.state}`)}
                />
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
              {/* Where it is done, when that is a screen of this backoffice (§516): gone once the row is. */}
              {task.state !== "done" && <TaskTargetLink locale={locale} role={actor.role} target={TASK_TARGETS[task.id]} />}
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
                    <HelpOutlineIcon aria-hidden sx={FOLD_GLYPH_SX} />
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
