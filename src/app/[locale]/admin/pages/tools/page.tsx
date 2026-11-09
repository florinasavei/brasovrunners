import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import MuiLink from "@mui/material/Link";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { getDb } from "@/db/client";
import { getPathname } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";
import PagesSubNav from "@/modules/content/pages/ui/PagesSubNav";
import { canPublishToolsPage, canReadContent } from "@/modules/staff-identity/domain/roles";
import { requireStaff } from "@/modules/staff-identity/session";
import { readToolsPageSettings, shownTools, TOOLS, toolsPageOnSite } from "@/modules/tools/page-settings";
import { confirmWords } from "@/shared/feedback/confirm-words";
import type { ConfirmSpec } from "@/shared/feedback/notice";
import ActionForm from "@/shared/forms/ActionForm";
import CheckboxField from "@/shared/ui/CheckboxField";
import GlyphButton from "@/shared/ui/GlyphButton";
import GlyphSubmitButton from "@/shared/ui/GlyphSubmitButton";
import { HEADING_SX } from "@/shared/ui/heading-scale";
import StatusChip from "@/shared/ui/StatusChip";
import { saveShownToolsAction, setToolsPagePublishedAction } from "./actions";

type Props = {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ saved?: string; error?: string }>;
};

export const dynamic = "force-dynamic";

/**
 * «Unelte» in the backoffice (§926; the owner, 2026-11-09: «vreau ca pagina de "Unelte" să fie controlabilă ca și restul
 * paginilor, să pot să îi dau OFF»): a standard page like «Întrebări frecvente» (§525) — its address and its tools are the
 * platform's — so the screen is the page's switch, published or a draft, asked first (§384), and the page's tools, each with
 * «Pe site» and one save (each tool's card is the platform's; there is nothing of the club's to write). A page with no tool
 * ticked is off the site whatever its switch says, as an FAQ page with no question is.
 *
 * Read by whoever reads the club's content (§208); the switch and the ticks are offered to the Administrator alone
 * (`canPublishToolsPage`), which the service asserts again (BR-REQ-060-01).
 */
export default async function AdminToolsPage({ params, searchParams }: Props) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);

  const actor = await requireStaff();
  if (!canReadContent(actor.role)) notFound();

  const { saved, error } = await searchParams;
  const t = await getTranslations("Admin");
  const tTools = await getTranslations("Tools");
  const words = await confirmWords();
  const settings = await readToolsPageSettings(getDb());
  const mayPublish = canPublishToolsPage(actor.role);
  const published = settings.status === "PUBLISHED";
  const shown = shownTools(settings);
  const onSite = toolsPageOnSite(settings);
  const ro = getPathname({ locale: "ro", href: "/tools" });
  const en = getPathname({ locale: "en", href: "/tools" });
  // Each tool's name is the one its card wears on the public page.
  const toolName = (tool: (typeof TOOLS)[number]) => tTools(`${tool}.title`);

  // Ask first for what reaches the site (§384): a tool taken off the page, or one put on it.
  const confirm: ConfirmSpec[] = TOOLS.map((tool) =>
    shown.includes(tool)
      ? {
          title: t("toolsPage.hideTitle", { tool: toolName(tool) }),
          body: t("toolsPage.hideBody"),
          confirmLabel: t("toolsPage.hideConfirm"),
          cancelLabel: words.cancel,
          destructive: true,
          when: [{ field: `tool.${tool}`, notEquals: "on" }],
        }
      : {
          title: t("toolsPage.showTitle", { tool: toolName(tool) }),
          body: t("toolsPage.showBody"),
          confirmLabel: t("toolsPage.showConfirm"),
          cancelLabel: words.cancel,
          when: [{ field: `tool.${tool}`, equals: "on" }],
        },
  );

  return (
    <Stack spacing={3}>
      <PagesSubNav locale={locale} active="tools" />

      <Box id="admin-alert" tabIndex={-1} sx={{ scrollMarginTop: 16 }}>
        {saved && <Alert severity="success">{t("saved")}</Alert>}
        {error && <Alert severity="error">{t(`errors.${error}`)}</Alert>}
      </Box>

      <Stack spacing={1}>
        <Typography variant="h2" sx={HEADING_SX.title}>
          {t("toolsPage.title")}
        </Typography>
        <Typography variant="body2" color="text.secondary">
          {t("toolsPage.intro")}
        </Typography>
        {onSite && (
          <Typography variant="body2">
            <MuiLink href={getPathname({ locale, href: "/tools" })} sx={{ display: "inline-flex", alignItems: "center", minHeight: 44 }}>
              {t("toolsPage.viewPublic")}
            </MuiLink>
          </Typography>
        )}
        {!mayPublish && <Alert severity="info">{t("toolsPage.readOnly")}</Alert>}
      </Stack>

      {/* The page as a whole: whether it is on the site, and the switch that puts it there — «Întrebări frecvente»'s. */}
      <Paper variant="outlined" id="tools-page" sx={{ p: { xs: 1.5, sm: 2 }, scrollMarginTop: 16 }}>
        <Stack spacing={1.5}>
          <Stack direction="row" spacing={1} sx={{ alignItems: "center", flexWrap: "wrap", gap: 1 }}>
            <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
              {t("toolsPage.pageHeading")}
            </Typography>
            <StatusChip glyph={published ? "visible" : "hidden"} color={published ? "success" : "default"} label={published ? t("toolsPage.pagePublished") : t("toolsPage.pageDraft")} />
          </Stack>
          <Typography variant="body2" color="text.secondary">
            {published ? (shown.length > 0 ? t("toolsPage.pagePublishedHelp", { ro, en }) : t("toolsPage.pageNoTool")) : t("toolsPage.pageDraftHelp")}
          </Typography>
          {mayPublish && (
            <ActionForm
              action={setToolsPagePublishedAction}
              confirm={
                published
                  ? { title: t("toolsPage.unpublishTitle"), body: t("toolsPage.unpublishBody"), confirmLabel: t("toolsPage.unpublish"), cancelLabel: words.cancel, destructive: true }
                  : { title: t("toolsPage.publishTitle"), body: t("toolsPage.publishBody", { ro, en }), confirmLabel: t("toolsPage.publish"), cancelLabel: words.cancel }
              }
            >
              <input type="hidden" name="uiLocale" value={locale} />
              <input type="hidden" name="published" value={published ? "false" : "true"} />
              <GlyphButton
                icon={published ? "unpublish" : "publish"}
                type="submit"
                variant={published ? "outlined" : "contained"}
                color={published ? "warning" : "primary"}
                sx={{ minHeight: 44 }}
              >
                {published ? t("toolsPage.unpublish") : t("toolsPage.publish")}
              </GlyphButton>
            </ActionForm>
          )}
        </Stack>
      </Paper>

      {/* The page's tools: each the platform's card, «Pe site» the club's one choice about it. */}
      <Paper variant="outlined" id="tools-list" sx={{ p: { xs: 1.5, sm: 2 }, scrollMarginTop: 16 }}>
        <Stack spacing={1.5}>
          <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
            {t("toolsPage.listHeading")}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            {t("toolsPage.listHelp")}
          </Typography>
          {mayPublish ? (
            <ActionForm action={saveShownToolsAction} confirm={confirm} data-testid="tools-list-form">
              <input type="hidden" name="uiLocale" value={locale} />
              <Stack spacing={1}>
                {TOOLS.map((tool) => (
                  <Box key={tool} data-testid={`tools-row-${tool}`}>
                    <Typography sx={{ fontWeight: 600 }}>{toolName(tool)}</Typography>
                    <CheckboxField name={`tool.${tool}`} defaultChecked={shown.includes(tool)}>
                      {t("toolsPage.onSite")}
                    </CheckboxField>
                  </Box>
                ))}
                <Box>
                  <GlyphSubmitButton label={t("toolsPage.save")} pendingLabel={t("editor.saving")} icon="save" size="medium" />
                </Box>
              </Stack>
            </ActionForm>
          ) : (
            <Stack spacing={0.5}>
              {TOOLS.map((tool) => (
                <Typography key={tool} variant="body2" data-testid={`tools-row-${tool}`}>
                  {toolName(tool)} · {shown.includes(tool) ? t("toolsPage.onSite") : t("toolsPage.offSite")}
                </Typography>
              ))}
            </Stack>
          )}
        </Stack>
      </Paper>
    </Stack>
  );
}
