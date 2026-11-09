import SpeedIcon from "@mui/icons-material/Speed";
import Box from "@mui/material/Box";
import Container from "@mui/material/Container";
import Typography from "@mui/material/Typography";
import type { Metadata } from "next";
import { hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound, unstable_rethrow } from "next/navigation";
import { routing } from "@/i18n/routing";
import { cachedToolsPage } from "@/modules/public-cache/reads";
import { pageAlternates, staticRouteUrl, staticRouteUrls } from "@/modules/seo/alternates";
import { shownTools, TOOLS, type ToolsPageSettings, toolsPageOnSite } from "@/modules/tools/page-settings";
import PaceCalculator from "@/modules/tools/ui/PaceCalculator";
import { env } from "@/shared/config/env";
import { PAGE_WIDTH } from "@/theme/brand";
import { DENSITY } from "@/theme/density";
import { headingRule } from "@/theme/surfaces";

type Props = { params: Promise<{ locale: string }> };

/**
 * Static and kept by the CDN like every public page (§549): the one thing read is the page's switch, from the public cache under
 * `pages`, which the switch's every save expires (§NNN); the day is only the public pages' common ceiling. A literal, as Next
 * requires: it equals `PUBLIC_PAGE_CEILING_SECONDS` (a test holds them together).
 */
export const revalidate = 86400;

/**
 * The page's switch and its tools, or null when the database cannot say — «Întrebări frecvente»'s rule for a read that may not
 * answer (§281): the page needs nothing else, so it stands with every tool rather than become an error.
 */
async function toolsOrNull(): Promise<ToolsPageSettings | null> {
  try {
    return await cachedToolsPage();
  } catch (error) {
    unstable_rethrow(error);
    console.error("[tools] the page's switch did not answer; it stands with every tool", error);
    return null;
  }
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) return {};
  const t = await getTranslations({ locale, namespace: "Tools" });
  const settings = await toolsOrNull();
  return {
    title: t("title"),
    description: t("description"),
    // Off the site (§NNN): the address answers 404, and says so to a crawler that still has it.
    ...(settings && !toolsPageOnSite(settings) ? { robots: { index: false, follow: true } } : {}),
    alternates: pageAlternates(locale, staticRouteUrls(env.APP_BASE_URL, "/tools")),
    openGraph: {
      title: t("title"),
      description: t("description"),
      url: staticRouteUrl(env.APP_BASE_URL, "/tools", locale),
      locale: locale === "en" ? "en_GB" : "ro_RO",
      type: "website",
    },
  };
}

/**
 * «Unelte» / "Tools" (§922): small helpers for a runner, one calm card each. The first is the pace
 * calculator — two of distance, time and pace give the third. A standard page like «Întrebări frecvente»
 * (§NNN): its address and its tools are the platform's, and the club puts it on the site or takes it off and
 * chooses which tools it shows (`/admin/pages/tools`); off, or with no tool shown, it is a 404. A Server
 * Component; each tool is its own client island, since it answers as the visitor types.
 */
export default async function ToolsPage({ params }: Props) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);
  const settings = await toolsOrNull();
  if (settings && !toolsPageOnSite(settings)) notFound();
  const shown = settings ? shownTools(settings) : [...TOOLS];
  const t = await getTranslations("Tools");

  return (
    <Container id="main" component="main" maxWidth={PAGE_WIDTH} sx={{ py: { xs: DENSITY.pagePadY, sm: 3 } }}>
      <Typography variant="h1" gutterBottom sx={headingRule}>
        {t("title")}
      </Typography>
      <Typography variant="body1" color="text.secondary" sx={{ mb: { xs: DENSITY.sectionGap, sm: 3 } }}>
        {t("description")}
      </Typography>

      {shown.includes("pace") && (
      <Box
        component="section"
        aria-labelledby="tool-pace"
        sx={{ border: 1, borderColor: "divider", borderRadius: 2, bgcolor: "background.paper", p: { xs: DENSITY.sectionGap, sm: 3 } }}
        data-testid="tool-pace"
      >
        <Typography variant="h2" id="tool-pace" sx={{ display: "flex", alignItems: "center", gap: 1, fontSize: { xs: "1.25rem", sm: "1.5rem" }, fontWeight: 700, mb: 0.5 }}>
          <SpeedIcon aria-hidden color="primary" />
          {t("pace.title")}
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2.5 }}>
          {t("pace.intro")}
        </Typography>
        <PaceCalculator />
      </Box>
      )}
    </Container>
  );
}
