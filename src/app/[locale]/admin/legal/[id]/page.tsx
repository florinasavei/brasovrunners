import Alert from "@mui/material/Alert";
import Divider from "@mui/material/Divider";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import type { Metadata } from "next";
import { hasLocale } from "next-intl";
import { getFormatter, getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { getDb } from "@/db/client";
import { Link } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";
import LegalDocumentBody from "@/modules/legal-documents/ui/LegalDocumentBody";
import { findVersionWithTranslations } from "@/modules/legal-documents/repository";
import { requireStaffRole } from "@/modules/staff-identity/session";

type Props = { params: Promise<{ locale: string; id: string }> };

export const dynamic = "force-dynamic";

export const metadata: Metadata = { robots: { index: false, follow: false } };

/**
 * One legal document version, both languages on one page (AGENTS.md §12.5).
 *
 * Both at once rather than a language tab, because a declaration is *one* document that happens
 * to be written twice: the club needs to see that the Romanian and the English say the same
 * thing, and a tabbed view hides exactly the discrepancy somebody is looking for. It is also
 * the shape the data already has — one `legal_documents` row, one translation per locale.
 *
 * Read-only. `repository.ts` has no update function at all, which is what makes "no screen
 * edits legal text" structural rather than a promise: there is no path from this request to a
 * write, so this page could not change a word if it tried.
 */
export default async function LegalDocumentVersionPage({ params }: Props) {
  const { locale, id } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);

  await requireStaffRole("ADMIN");

  const t = await getTranslations("Admin");
  const format = await getFormatter();
  const document = await findVersionWithTranslations(getDb(), id);
  if (!document) notFound();

  return (
    <Stack spacing={3}>
      <Stack spacing={1}>
        <Link href="/admin/legal">{t("legal.backToList")}</Link>
        <Typography variant="h2" sx={{ fontSize: "1.25rem" }}>
          {t(`legal.keys.${document.key}`)} · v{document.version}
        </Typography>
        <Typography variant="body2" color="text.secondary">
          {document.isApproved ? t("legal.approved") : t("legal.draft")} ·{" "}
          {t("legal.effectiveAt")}: {format.dateTime(document.effectiveAt, { dateStyle: "medium" })}
        </Typography>
        {/*
          The hash is what makes "immutable" checkable rather than asserted: two deployments
          claiming the same version are the same text only if this matches.
        */}
        <Typography variant="caption" color="text.secondary" sx={{ wordBreak: "break-all" }}>
          sha256 {document.contentSha256}
        </Typography>
      </Stack>

      <Alert severity="info">{t("legal.readOnlyNotice")}</Alert>

      {document.translations.length === 0 ? (
        <Alert severity="warning">{t("legal.noTranslations")}</Alert>
      ) : (
        document.translations.map((translation) => (
          <Paper key={translation.locale} variant="outlined" sx={{ p: { xs: 2, sm: 3 } }}>
            <Typography variant="overline" color="text.secondary">
              {translation.locale.toUpperCase()}
            </Typography>
            <Typography variant="h3" sx={{ fontSize: "1.125rem", mb: 1 }}>
              {translation.title}
            </Typography>
            <Divider sx={{ mb: 2 }} />
            <LegalDocumentBody body={translation.body} />
          </Paper>
        ))
      )}
    </Stack>
  );
}
