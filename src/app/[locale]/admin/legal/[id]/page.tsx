import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Checkbox from "@mui/material/Checkbox";
import FormControlLabel from "@mui/material/FormControlLabel";
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
import {
  findVersionWithTranslations,
  listVersionsForBackoffice,
} from "@/modules/legal-documents/repository";
import type { LegalDocumentBody as LegalBody } from "@/modules/legal-documents/domain/content-hash";
import LegalDocumentForm from "@/modules/legal-documents/ui/LegalDocumentForm";
import { approveLegalVersionAction, updateLegalVersionAction } from "../actions";
import { requireStaffRole } from "@/modules/staff-identity/session";

type Props = {
  params: Promise<{ locale: string; id: string }>;
  searchParams: Promise<{ saved?: string; error?: string }>;
};

/** An empty document is what a brand-new draft looks like before either language is typed. */
function translationValues(
  translations: readonly { locale: string; title: string; body: unknown }[],
  locale: "ro" | "en",
) {
  const found = translations.find((entry) => entry.locale === locale);
  return {
    title: found?.title ?? "",
    // `body_json` is `unknown` at the database boundary; the form only ever reads it back
    // through `bodyToText`, which tolerates an empty document.
    body: (found?.body ?? { sections: [] }) as LegalBody,
  };
}

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
export default async function LegalDocumentVersionPage({ params, searchParams }: Props) {
  const { locale, id } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);

  await requireStaffRole("ADMIN");

  const t = await getTranslations("Admin");
  const format = await getFormatter();
  const db = getDb();
  const document = await findVersionWithTranslations(db, id);
  if (!document) notFound();

  const { saved, error } = await searchParams;

  /**
   * Whether this version may still be written to — a fact about the data, not a permission.
   * Approved, accepted by a participant, or pointed at by an event: any one and it is history
   * (`DECISIONS.md` §46). The service asserts the same thing; this decides what to render.
   */
  const row = (await listVersionsForBackoffice(db)).find((candidate) => candidate.id === id);
  const isDraft = !document.isApproved && (row?.acceptanceCount ?? 0) === 0 && (row?.eventCount ?? 0) === 0;

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

      {saved && (
        <Alert id="admin-alert" severity="success">
          {t(`legal.${saved}`)}
        </Alert>
      )}
      {error && (
        <Alert id="admin-alert" severity="error">
          {t(`errors.${error}`)}
        </Alert>
      )}

      {isDraft ? (
        <>
          {/*
            A draft, so it can still be rewritten — and it is not on the public site until it is
            approved. Approving is its own act, below, because it is the one thing here that
            cannot be undone.
          */}
          <LegalDocumentForm
            action={updateLegalVersionAction}
            locale={locale}
            versionId={document.id}
            keyLocked
            values={{
              key: document.key,
              ro: translationValues(document.translations, "ro"),
              en: translationValues(document.translations, "en"),
            }}
            submitLabel={t("legal.saveDraft")}
          />

          <Paper variant="outlined" sx={{ p: { xs: 2, sm: 3 }, borderColor: "warning.light" }}>
            <Typography variant="h3" sx={{ fontSize: "1.125rem", mb: 1 }}>
              {t("legal.approveTitle")}
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
              {t("legal.approveHelp")}
            </Typography>
            <form action={approveLegalVersionAction}>
              <input type="hidden" name="uiLocale" value={locale} />
              <input type="hidden" name="versionId" value={document.id} />
              <Stack spacing={2}>
                <FormControlLabel
                  control={<Checkbox name="confirm" required />}
                  label={t("legal.approveConfirm")}
                />
                <Box>
                  <Button type="submit" color="warning" variant="contained">
                    {t("legal.approveAction")}
                  </Button>
                </Box>
              </Stack>
            </form>
          </Paper>
        </>
      ) : (
        <>
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
        </>
      )}
    </Stack>
  );
}
