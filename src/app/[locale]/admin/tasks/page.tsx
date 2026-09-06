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
  COST_LINES,
  ownerTasks,
  sortTasks,
  type TaskState,
} from "@/modules/diagnostics/owner-tasks";
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
  const publishedEventCount = (await listPublishedEvents(db, locale)).length;

  const tasks = sortTasks(
    ownerTasks({
      hasApprovedPrivacyNotice: Boolean(privacyNotice),
      // The sample documents say so in their own titles, in both languages — the same banner a
      // visitor reads on the public page. Nothing else distinguishes them from the real thing,
      // which is deliberate: a sample that could be mistaken for approved wording is the risk.
      legalTextIsSample: /EXEMPLU|SAMPLE/i.test(privacyNotice?.title ?? ""),
      onProviderHostname: /vercel\.app$/i.test(new URL(env.APP_BASE_URL).hostname),
      emailDeliveryMode: env.EMAIL_DELIVERY_MODE,
      jobsHealthy: jobs.every((job) => job.status === "ok"),
      publishedEventCount,
    }),
  );

  const t = await getTranslations("Admin.tasks");
  const blocking = tasks.filter((task) => task.state === "blocking").length;

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
            </Typography>
          </Box>
        ))}
      </Stack>

      <Divider />

      <Box component="section">
        <Typography variant="h2" sx={{ fontSize: "1.25rem", mb: 1 }}>
          {t("costsTitle")}
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          {t("costsIntro")}
        </Typography>
        <Stack spacing={1}>
          {COST_LINES.map((line) => (
            <Stack
              key={line.id}
              direction={{ xs: "column", sm: "row" }}
              sx={{ gap: { xs: 0, sm: 2 }, alignItems: { sm: "baseline" } }}
            >
              <Typography variant="body2" sx={{ minWidth: 140, fontWeight: 500 }}>
                {t(`costs.${line.id}.name`)}
              </Typography>
              <Typography variant="body2">
                <strong>{line.amount === "?" ? t("costUnknown") : line.amount}</strong>
                {" — "}
                {t(`costs.${line.id}.note`)}
              </Typography>
            </Stack>
          ))}
        </Stack>
      </Box>
    </Stack>
  );
}
