import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Chip from "@mui/material/Chip";
import Divider from "@mui/material/Divider";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { getDb } from "@/db/client";
import { routing } from "@/i18n/routing";
import { listPublishedEvents } from "@/modules/events/repository";
import { checkJobHealth } from "@/modules/jobs/health";
import { findCurrentApprovedDocument } from "@/modules/legal-documents/repository";
import {
  ownerTasks,
  sortTasks,
  type TaskState,
} from "@/modules/diagnostics/owner-tasks";
import {
  BUMP_LINES,
  freeTierVerdict,
  PLAN_LINES,
  PLANS_CHECKED_ON,
  platformLimits,
  registrationsLeftToday,
} from "@/modules/diagnostics/platform-plans";
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
 * What is still owed, for the people who owe it.
 *
 * `/devs` is for whoever reads a status enum; this is for the club. The outstanding work on this
 * platform is mostly not a developer's — approving legal wording, buying a domain, deciding what
 * to charge — and until now the only record of it was prose spread across `CLAUDE.md`,
 * `SETUP.md` and three runbooks, none of which a volunteer organizer will ever open.
 *
 * Every line is derived from what this deployment actually reports, never from a checklist
 * somebody has to remember to tick. A task marked done is done because the system says so.
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
   *
   * Derived rather than asked, so the caution cannot go stale — and it is a caution, not a
   * verdict, because `cost_type` today says only *whether* an event costs money and there is
   * no column yet for how it is framed.
   */
  const hasPaidEvent = published.some((event) => event.costType === "PAID");
  const volume = await readEmailVolumeToday(db, now);

  /**
   * Is the club's own domain bound, or is this still somebody else's hostname?
   *
   * "Not a provider hostname" was the obvious test and it was wrong on the machine every
   * developer runs this on: `localhost` is not `*.vercel.app`, so the domain task read as done
   * and the identity limit read as reached, on every laptop. A development hostname is not a
   * bound domain, and saying so is one condition rather than two.
   */
  const hostname = new URL(env.APP_BASE_URL).hostname;
  const clubDomainBound =
    !/vercel\.app$/i.test(hostname) && !/^(localhost|127\.0\.0\.1|\[::1\])$/i.test(hostname);
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
      clubDomainBound,
      emailDeliveryMode: env.EMAIL_DELIVERY_MODE,
      staleJobNames,
      publishedEventCount,
    }),
  );

  const t = await getTranslations("Admin.tasks");
  const blocking = tasks.filter((task) => task.state === "blocking").length;

  const limitInputs = {
    emailAllowance: MAILGUN_FREE_DAILY_MESSAGES,
    emailSentToday: volume.sentMessages,
    messagesPerRegistration: MESSAGES_PER_COMPLETED_REGISTRATION,
    hasPaidEvent,
    clubDomainBound,
    jobsHealthy,
  };
  const limits = platformLimits(limitInputs);
  const verdict = freeTierVerdict(limitInputs);
  const registrationsLeft = registrationsLeftToday(limitInputs);

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
              {t(`items.${task.id}.${task.state === "done" ? "done" : "todo"}`)}
              {task.detail && ` — ${task.detail}`}
            </Typography>
          </Box>
        ))}
      </Stack>

      <Divider />

      {/*
        The question the club actually asks about this platform, answered before the tables that
        justify the answer. Three outcomes rather than yes and no: everything is free except the
        domain, which never is, and there are named events that end it.
      */}
      <Box component="section">
        <Typography variant="h2" sx={{ fontSize: "1.25rem", mb: 1 }}>
          {t("freeTitle")}
        </Typography>
        <Alert severity={verdict === "freeExceptDomain" ? "success" : "warning"} sx={{ mb: 2 }}>
          {t(`freeVerdict.${verdict}`)}
        </Alert>
        {/*
          The one number that turns this page from reading into acting: how many more people can
          register today before the free allowance stops sending confirmations. Understated on
          purpose — a waitlisted entrant costs more than three messages.
        */}
        <Typography variant="body2" color="text.secondary">
          {t("registrationsLeftToday", {
            count: registrationsLeft,
            sent: volume.sentMessages,
            allowance: MAILGUN_FREE_DAILY_MESSAGES,
          })}
        </Typography>
      </Box>

      <Box component="section">
        <Typography variant="h2" sx={{ fontSize: "1.25rem", mb: 1 }}>
          {t("limitsTitle")}
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          {t("limitsIntro")}
        </Typography>
        <Stack spacing={2} component="ul" sx={{ listStyle: "none", m: 0, p: 0 }}>
          {limits.map((limit) => (
            <Box
              component="li"
              key={limit.id}
              sx={{ border: 1, borderColor: "divider", borderRadius: 1, p: 2 }}
            >
              <Stack direction="row" spacing={1} sx={{ mb: 1, flexWrap: "wrap", gap: 1 }}>
                {/* Reached is a fact about today, not a severity someone assigned. */}
                <Chip
                  size="small"
                  color={limit.reached ? "error" : "default"}
                  variant={limit.reached ? "filled" : "outlined"}
                  label={t(limit.reached ? "limitReached" : "limitApplies")}
                />
              </Stack>
              <Typography variant="h3" sx={{ fontSize: "1rem", mb: 0.5 }}>
                {t(`limits.${limit.id}.title`)}
              </Typography>
              <Typography variant="body2" color="text.secondary">
                {t(`limits.${limit.id}.body`)}
              </Typography>
            </Box>
          ))}
        </Stack>
      </Box>

      <Box component="section">
        <Typography variant="h2" sx={{ fontSize: "1.25rem", mb: 1 }}>
          {t("plansTitle")}
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          {t("plansIntro", { checked: PLANS_CHECKED_ON })}
        </Typography>
        <Stack spacing={1.5}>
          {PLAN_LINES.map((line) => (
            <Box key={line.id}>
              <Typography variant="body2" sx={{ fontWeight: 500 }}>
                {t(`plans.${line.id}.name`)} — {line.currentPlan === "—" ? t("planNone") : line.currentPlan}{" "}
                <strong>{line.currentCost === "?" ? t("costUnknown") : line.currentCost}</strong>
              </Typography>
              <Typography variant="body2" color="text.secondary">
                {t(`plans.${line.id}.freeGives`)}
                {line.firstPaidPlan && (
                  <>
                    {" "}
                    {t("firstPaid", { plan: line.firstPaidPlan, cost: line.firstPaidCost ?? "" })}
                  </>
                )}
              </Typography>
            </Box>
          ))}
        </Stack>
      </Box>

      <Box component="section">
        <Typography variant="h2" sx={{ fontSize: "1.25rem", mb: 1 }}>
          {t("bumpTitle")}
        </Typography>
        {/*
          The point of the whole section. A temporary upgrade nobody reverses is the expensive
          failure here, and no dashboard will ever remind the club to come back down.
        */}
        <Alert severity="info" sx={{ mb: 2 }}>
          {t("bumpIntro")}
        </Alert>
        <Stack spacing={1.5}>
          {BUMP_LINES.map((line) => (
            <Box key={line.id}>
              <Stack direction="row" spacing={1} sx={{ mb: 0.5, flexWrap: "wrap", gap: 1 }}>
                <Chip
                  size="small"
                  variant="outlined"
                  color={line.temporary ? "info" : "default"}
                  label={t(line.temporary ? "bumpTemporary" : "bumpPermanent")}
                />
              </Stack>
              <Typography variant="body2" sx={{ fontWeight: 500 }}>
                {t(`bumps.${line.id}.when`)}
              </Typography>
              <Typography variant="body2" color="text.secondary">
                {t(`bumps.${line.id}.what`)} {t(`bumps.${line.id}.back`)}
              </Typography>
            </Box>
          ))}
        </Stack>
      </Box>
    </Stack>
  );
}
