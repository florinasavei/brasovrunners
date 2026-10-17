import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import MuiLink from "@mui/material/Link";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { getFormatter, getTranslations } from "next-intl/server";
import { VERCEL_HOBBY_ACTIVE_CPU_HOURS_PER_MONTH } from "@/modules/diagnostics/vercel";
import type { VercelUsageRead } from "@/modules/diagnostics/vercel-usage";
import Panel from "@/shared/ui/Panel";
import QuietHelp from "@/shared/ui/QuietHelp";

type Props = {
  /** What `readVercelUsageCached` answered: the month's lines, or why there are none. */
  reading: VercelUsageRead;
  /** The usage credit the plan the club stated includes a month, in USD (`VERCEL_PLANS`): 20 on Pro, 0 on Hobby. */
  creditUsd: number;
};

/** Where the Usage page is, for the sentence that cannot say. */
const USAGE_URL = "https://vercel.com/dashboard/usage";

/** Past this share of Hobby's CPU allowance the line is amber: the figure that decides whether the club fits. */
const CPU_WARN_SHARE = 0.8;

/**
 * «Vercel: consumul lunii» on `/devs` (§803; the owner, 2026-10-16: «mă interesează să țin Vercel
 * free după decembrie»): the lines of Vercel's Usage page — build CPU minutes, function CPU,
 * observability events, ISR writes — and the builds by project, read from Vercel's billing API with
 * the token the page already holds. When Vercel refuses the token, or none is set, the card says
 * so in one sentence and links the Usage page: never a guessed figure.
 *
 * A Server Component over the house's closed `Panel`, one list of lines at any width. The service
 * names are Vercel's own, as the dashboard prints them.
 */
export default async function VercelUsagePanel({ reading, creditUsd }: Props) {
  const t = await getTranslations("Devs");
  const format = await getFormatter();
  const usd = (value: number) => format.number(value, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const amount = (value: number) => format.number(value, { maximumFractionDigits: value < 10 ? 1 : 0 });
  const usage = reading.ok ? reading.usage : null;
  // Null hours: Vercel gave the line in a unit that is not an hour, so nothing is compared with Hobby's four.
  const cpuHours = usage ? usage.activeCpuHours : 0;
  const cpuShare = cpuHours === null ? 0 : cpuHours / VERCEL_HOBBY_ACTIVE_CPU_HOURS_PER_MONTH;
  const cpuNearLimit = cpuShare >= CPU_WARN_SHARE;

  return (
    <Panel
      glyph="costs"
      level={3}
      collapsible
      id="vercel-usage"
      title={t("vercelUsage.title")}
      intro={t("vercelUsage.intro")}
      introMore={t("vercelUsage.introMore")}
      aside={usage ? t("vercelUsage.aside", { usd: usd(usage.usageUsd) }) : undefined}
      data-testid="vercel-usage"
    >
      {usage === null ? (
        <Alert severity="info" data-testid="vercel-usage-cannot">
          {reading.ok ? "" : reading.reason === "unconfigured" ? t("vercelUsage.unconfigured") : t("vercelUsage.cannot", { reason: reading.reason })}{" "}
          <MuiLink href={USAGE_URL} target="_blank" rel="noopener noreferrer" sx={{ display: "inline-flex", alignItems: "center", minHeight: 44 }}>
            {t("vercel.usageLink")}
          </MuiLink>
        </Alert>
      ) : (
        <Stack spacing={2}>
          <Typography variant="body1" sx={{ fontWeight: 600 }} data-testid="vercel-usage-total">
            {creditUsd > 0 ? t("vercelUsage.totalCredit", { usd: usd(usage.usageUsd), credit: usd(creditUsd) }) : t("vercelUsage.totalHobby", { usd: usd(usage.usageUsd) })}
            <QuietHelp text={t("vercelUsage.cycleMore")} />
          </Typography>
          {usage.subscriptionUsd > 0 && (
            <Typography variant="body2" color="text.secondary" data-testid="vercel-usage-subscription">
              {t("vercelUsage.subscription", { usd: usd(usage.subscriptionUsd) })}
            </Typography>
          )}

          {/* The figure that decides Hobby: its allowance is four CPU-hours, and a Hobby team past an allowance loses that feature for about thirty days. */}
          <Alert severity={cpuNearLimit ? "warning" : "info"} data-testid="vercel-usage-cpu" data-near={cpuNearLimit ? "true" : "false"}>
            {cpuHours === null
              ? t("vercelUsage.cpuUnknown", { unit: usage.activeCpuUnit ?? "?" })
              : t(cpuNearLimit ? "vercelUsage.cpuNear" : "vercelUsage.cpu", {
                  hours: format.number(cpuHours, { maximumFractionDigits: 1 }),
                  of: VERCEL_HOBBY_ACTIVE_CPU_HOURS_PER_MONTH,
                  percent: Math.round(cpuShare * 100),
                })}
          </Alert>

          <Box component="section">
            <Typography variant="h4" sx={{ fontSize: "0.9375rem", fontWeight: 600, mb: 0.5 }}>
              {t("vercelUsage.linesTitle")}
            </Typography>
            <Stack component="ul" spacing={0.75} sx={{ listStyle: "none", m: 0, p: 0 }} data-testid="vercel-usage-lines">
              {usage.lines.map((line) => (
                <Typography variant="body2" component="li" key={line.service} data-testid="vercel-usage-line">
                  <strong>{line.service}</strong>
                  {": "}
                  {t("vercelUsage.line", { quantity: amount(line.quantity), unit: line.unit ?? "", usd: usd(line.usd) })}
                </Typography>
              ))}
            </Stack>
          </Box>

          {usage.buildsByProject.length > 0 && (
            <Box component="section">
              <Typography variant="h4" sx={{ fontSize: "0.9375rem", fontWeight: 600, mb: 0.5 }}>
                {t("vercelUsage.buildsTitle")}
              </Typography>
              <Stack component="ul" spacing={0.75} sx={{ listStyle: "none", m: 0, p: 0 }} data-testid="vercel-usage-builds">
                {usage.buildsByProject.map((build) => (
                  <Typography variant="body2" component="li" key={build.project} data-testid="vercel-usage-build">
                    <strong>{build.project}</strong>
                    {": "}
                    {t("vercelUsage.buildLine", { minutes: amount(build.minutes), usd: usd(build.usd) })}
                  </Typography>
                ))}
              </Stack>
            </Box>
          )}

          <Typography variant="body2" sx={{ minHeight: 44, display: "flex", alignItems: "center" }}>
            <MuiLink href={USAGE_URL} target="_blank" rel="noopener noreferrer">
              {t("vercel.usageLink")}
            </MuiLink>
          </Typography>
        </Stack>
      )}
    </Panel>
  );
}
