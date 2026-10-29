import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Stack from "@mui/material/Stack";
import { hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { getDb } from "@/db/client";
import { routing } from "@/i18n/routing";
import { readHomePage } from "@/modules/appearance/home-page";
import { listPagesForAdmin } from "@/modules/content/pages/repository";
import { readLiveStream } from "@/modules/appearance/live-stream";
import { readSiteFontSize } from "@/modules/appearance/site-font-size";
import { readSiteLook } from "@/modules/appearance/site-look";
import { readSiteTint } from "@/modules/appearance/site-tint";
import HomePagePanel from "@/modules/appearance/ui/HomePagePanel";
import LiveStreamPanel from "@/modules/appearance/ui/LiveStreamPanel";
import SiteFontSizePanel from "@/modules/appearance/ui/SiteFontSizePanel";
import SiteLookPanel from "@/modules/appearance/ui/SiteLookPanel";
import SiteTintPanel from "@/modules/appearance/ui/SiteTintPanel";
import { canManageClubSettings } from "@/modules/staff-identity/domain/roles";
import { canOpenSettingsTab } from "@/modules/staff-identity/domain/settings-tabs";
import { requireStaff } from "@/modules/staff-identity/session";
import SettingsSubNav from "@/modules/staff-identity/ui/SettingsSubNav";
import GlyphButtonLink from "@/shared/ui/GlyphButtonLink";
import Panel from "@/shared/ui/Panel";
import { TAP_TARGET } from "@/shared/ui/tap-target";

type Props = {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ saved?: string }>;
};

export const dynamic = "force-dynamic";

/**
 * «Setări» → «Aspect» (§488, moved from Pagini → «Aspect» by §516): how the public pages look.
 * Four settings: the site's light background tint, since §530 its text size, since §708 «Aspectul
 * nou», the facelift's look on or off, and since §714 «Pagina principală», the home page at the root. Read by whoever reads the club's content;
 * changed by the Administrator (`canManageClubSettings`, §450), which the action and the service
 * assert again (BR-REQ-060-01).
 */
export default async function AdminAppearancePage({ params, searchParams }: Props) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);

  const actor = await requireStaff();
  if (!canOpenSettingsTab(actor.role, "appearance")) notFound();

  const { saved } = await searchParams;
  const t = await getTranslations("Admin");
  const db = getDb();
  const state = await readSiteTint(db);
  const fontSize = await readSiteFontSize(db);
  const look = await readSiteLook(db);
  const home = await readHomePage(db);
  const live = await readLiveStream(db);
  // The club's own pages, for the two «Cum funcționează» buttons: by their Romanian title, a draft marked.
  const pages = (await listPagesForAdmin(db, "ro")).map((page) => ({ id: page.id, title: page.title ?? page.slug ?? page.id, published: page.editorialStatus === "PUBLISHED" }));

  return (
    <Stack spacing={3}>
      <SettingsSubNav locale={locale} role={actor.role} active="appearance" />

      <Box id="admin-alert" tabIndex={-1} sx={{ scrollMarginTop: 16 }}>
        {saved === "siteTint" && <Alert severity="success">{t("appearance.saved")}</Alert>}
        {saved === "siteFontSize" && <Alert severity="success">{t("fontSize.saved")}</Alert>}
        {saved === "siteLook" && <Alert severity="success">{t("look.saved")}</Alert>}
        {saved === "homePage" && <Alert severity="success">{t("homePage.saved")}</Alert>}
        {saved === "homeStrip" && <Alert severity="success">{t("homePage.strip.saved")}</Alert>}
        {saved === "liveStream" && <Alert severity="success">{t("liveStream.saved")}</Alert>}
      </Box>

      {/*
        The tab's cards are folds, closed on arrival with the value in force on each line (the owner,
        2026-10-21: the backoffice «from a different app»; until then they opened as `primary`, §516):
        the page reads as its settings and their values. A card opens by itself after its own save.
      */}
      <SiteTintPanel locale={locale} state={state} mayEdit={canManageClubSettings(actor.role)} openWhen={{ saved: saved === "siteTint" }} />
      <SiteFontSizePanel locale={locale} state={fontSize} mayEdit={canManageClubSettings(actor.role)} openWhen={{ saved: saved === "siteFontSize" }} />
      {/* «Tema» (§708): the facelift's look on the public pages, and its accent (§723). */}
      <SiteLookPanel locale={locale} state={look} mayEdit={canManageClubSettings(actor.role)} openWhen={{ saved: saved === "siteLook" }} />
      {/* «Pagina principală» (§714): the home page at the site's root, one switch, and a fold for each part of the page. */}
      <HomePagePanel locale={locale} state={home} mayEdit={canManageClubSettings(actor.role)} pages={pages} saved={saved} openWhen={{ primary: true }} />
      {/* «În direct pe YouTube» (§NNN): the live-broadcast notice on every public page, and its address. */}
      <LiveStreamPanel locale={locale} state={live} mayEdit={canManageClubSettings(actor.role)} openWhen={{ saved: saved === "liveStream" }} />

      {/* «Sistemul de design» (§692): the look as the code draws it, and the redesign plan — one card, one button, for whoever reads this tab. */}
      <Panel glyph="appearance" title={t("design.card.title")} intro={t("design.card.intro")} id="design-system" data-testid="design-system-card">
        <GlyphButtonLink icon="preview" href="/admin/design" variant="outlined" size="small" sx={TAP_TARGET}>
          {t("design.card.open")}
        </GlyphButtonLink>
      </Panel>
    </Stack>
  );
}
