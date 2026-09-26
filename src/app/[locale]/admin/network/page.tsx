import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { getDb } from "@/db/client";
import { routing } from "@/i18n/routing";
import type { NetworkProbe } from "@/modules/diagnostics/network-check";
import NetworkProbes, { type NetworkProbeRow } from "@/modules/diagnostics/ui/NetworkProbes";
import { newestThumbnailUrl } from "@/modules/media/service";
import { isStorageConfigured, publicPictureHost } from "@/modules/media/storage";
import { TURNSTILE_SCRIPT_URL, turnstileSiteKey } from "@/modules/registrations/turnstile";
import { requireStaff } from "@/modules/staff-identity/session";
import { env } from "@/shared/config/env";
import { CLUB_NAME } from "@/theme/brand";
import { probeSaveAction } from "./actions";

type Props = { params: Promise<{ locale: string }> };

export const dynamic = "force-dynamic";

/**
 * "Verificarea rețelei" (§NNN): what a staff member's network lets through, tried from their own
 * browser, and the line to hand the company's IT for whatever it does not.
 *
 * Every staff role — the person on a locked-down office laptop can be a volunteer as easily as the
 * Administrator — asserted here on the server as well as by the layout (BR-REQ-060-01). Reached
 * from the guide's troubleshooting line and from the notice a blocked save leaves; never in the
 * tabs, since most people never need it.
 *
 * Every host it names comes from configuration (AGENTS.md §8): this site's from `APP_BASE_URL`,
 * the pictures' from the store (`publicPictureHost`), Cloudflare's from the Turnstile island's own
 * script address. The page holds no hostname of its own.
 */
export default async function NetworkPage({ params }: Props) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);
  await requireStaff();

  const t = await getTranslations("Network");
  const site = new URL(env.APP_BASE_URL).host;
  const picturesConfigured = isStorageConfigured();
  const pictureUrl = picturesConfigured ? await newestThumbnailUrl(getDb()) : null;
  const botCheckConfigured = turnstileSiteKey() !== undefined;
  const botCheckHost = new URL(TURNSTILE_SCRIPT_URL).host;

  const row = (id: NetworkProbe, allow: string | null, skip: string | null): NetworkProbeRow => ({
    id,
    title: t(`page.${id}.title`),
    meaning: t(`page.${id}.meaning`),
    allow,
    skip,
  });
  const rows: NetworkProbeRow[] = [
    row("saves", t("page.saves.allow", { host: site }), null),
    row("post", t("page.post.allow", { host: site }), null),
    row(
      "pictures",
      picturesConfigured ? t("page.pictures.allow", { host: publicPictureHost() }) : null,
      !picturesConfigured ? t("page.pictures.unconfigured") : pictureUrl ? null : t("page.pictures.none"),
    ),
    row("botCheck", botCheckConfigured ? t("page.botCheck.allow", { host: botCheckHost }) : null, botCheckConfigured ? null : t("page.botCheck.unconfigured")),
  ];

  return (
    <Stack spacing={3}>
      <Typography variant="h2" sx={{ fontSize: "1.25rem" }}>
        {t("page.title")}
      </Typography>
      <Typography color="text.secondary">{t("page.intro")}</Typography>
      <NetworkProbes
        probe={probeSaveAction}
        rows={rows}
        pictureUrl={pictureUrl}
        turnstileScript={botCheckConfigured ? `${TURNSTILE_SCRIPT_URL}?render=explicit` : null}
        site={site}
        words={{
          checking: t("page.state.checking"),
          ok: t("page.state.ok"),
          blocked: t("page.state.blocked"),
          skipped: t("page.state.skipped"),
          again: t("page.again"),
          reportTitle: t("page.report.title"),
          reportIntro: t("page.report.intro"),
          copy: t("page.report.copy"),
          copied: t("page.report.copied"),
          copyFailed: t("page.report.copyFailed"),
          reportHeading: t("page.report.heading", { club: CLUB_NAME }),
          siteLabel: t("page.report.site"),
          browserLabel: t("page.report.browser"),
        }}
      />
    </Stack>
  );
}
