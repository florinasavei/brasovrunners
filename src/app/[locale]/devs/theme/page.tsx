import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { getPathname, Link } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";
import { canSeeDiagnostics } from "@/modules/staff-identity/domain/roles";
import { requireStaff } from "@/modules/staff-identity/session";
import ThemeLabForm from "@/theme/ThemeLabForm";

type Props = { params: Promise<{ locale: string }> };

export const dynamic = "force-dynamic";

/**
 * The theme lab (BR-REQ-090-06): try the site with bigger type, other faces, other corners,
 * in this browser only. Beside `/devs` and behind the same gate — it changes nothing for
 * anybody else and publishes nothing, but it is a tool for whoever is deciding what the site
 * should look like, not a page for a visitor.
 */
export default async function ThemeLabPage({ params }: Props) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);

  const actor = await requireStaff();
  if (!canSeeDiagnostics(actor.role)) notFound();

  const t = await getTranslations("Devs");

  return (
    <Stack spacing={3}>
      <Typography variant="body2">
        <Link href="/devs">{t("theme.back")}</Link>
      </Typography>
      <Typography variant="h2" sx={{ fontSize: "1.25rem" }}>
        {t("theme.title")}
      </Typography>
        <Typography color="text.secondary">{t("theme.intro")}</Typography>
        <ThemeLabForm
          homeHref={getPathname({ locale, href: "/" })}
          labels={{
            scale: t("theme.scale"),
            display: t("theme.display"),
            body: t("theme.body"),
            radius: t("theme.radius"),
            apply: t("theme.apply"),
            reset: t("theme.reset"),
          }}
        />
    </Stack>
  );
}
