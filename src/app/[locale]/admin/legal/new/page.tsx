import Alert from "@mui/material/Alert";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import type { Metadata } from "next";
import { hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { Link } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";
import LegalDocumentForm from "@/modules/legal-documents/ui/LegalDocumentForm";
import { requireStaffRole } from "@/modules/staff-identity/session";
import { createLegalVersionAction } from "../actions";

type Props = {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ error?: string }>;
};

export const dynamic = "force-dynamic";

export const metadata: Metadata = { robots: { index: false, follow: false } };

/**
 * Write a new version of a legal document (BR-REQ-053-02).
 *
 * Always a new version, never an edit of an existing one: that is the whole design, and it is
 * why this page exists rather than an "edit" button on an approved document. A correction to
 * text somebody has already accepted is a *new* version, because their acceptance points at the
 * words they actually read (`DECISIONS.md` §46).
 *
 * It saves as a draft. Approving is a separate, deliberate act on the version's own page.
 */
export default async function NewLegalVersionPage({ params, searchParams }: Props) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);

  await requireStaffRole("SUPERADMIN");

  const { error } = await searchParams;
  const t = await getTranslations("Admin");

  return (
    <Stack spacing={3}>
      <Stack spacing={1}>
        <Link href="/admin/legal">{t("legal.backToList")}</Link>
        <Typography variant="h2" sx={{ fontSize: "1.25rem" }}>
          {t("legal.newTitle")}
        </Typography>
        <Typography variant="body2" color="text.secondary">
          {t("legal.newIntro")}
        </Typography>
      </Stack>

      {error && (
        <Alert id="admin-alert" severity="error">
          {t(`errors.${error}`)}
        </Alert>
      )}

      <LegalDocumentForm
        action={createLegalVersionAction}
        locale={locale}
        submitLabel={t("legal.saveDraft")}
      />
    </Stack>
  );
}
