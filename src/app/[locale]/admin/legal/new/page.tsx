import Alert from "@mui/material/Alert";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import type { Metadata } from "next";
import { hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { getDb } from "@/db/client";
import { Link } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";
import type { LegalDocumentBody } from "@/modules/legal-documents/domain/content-hash";
import { findVersionWithTranslations } from "@/modules/legal-documents/repository";
import { isLegalDocumentKey, LEGAL_TEMPLATES } from "@/modules/legal-documents/templates/catalogue";
import { CLUB_LEGAL_NAME, fillClubFacts, remainingPlaceholders } from "@/modules/legal-documents/templates/club-facts";
import { env } from "@/shared/config/env";
import LegalDocumentForm, {
  type LegalDocumentFormValues,
} from "@/modules/legal-documents/ui/LegalDocumentForm";
import { requireStaffRole } from "@/modules/staff-identity/session";
import { createLegalVersionAction } from "../actions";

type Props = {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ error?: string; from?: string; template?: string }>;
};

export const dynamic = "force-dynamic";

export const metadata: Metadata = { robots: { index: false, follow: false } };

function pick(
  translations: readonly { locale: string; title: string; body: unknown }[],
  locale: "ro" | "en",
) {
  const found = translations.find((entry) => entry.locale === locale);
  return {
    title: found?.title ?? "",
    body: (found?.body as LegalDocumentBody | undefined) ?? { sections: [] },
  };
}

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

  const { error, from, template } = await searchParams;
  const t = await getTranslations("Admin");

  /**
   * "Editing" an approved version means starting the next one from it (`DECISIONS.md` §46,
   * §53, §57): approved words are fixed because participants relied on them, so the correction
   * is version n+1 — and until this existed, version n+1 began as an empty form and the whole
   * text had to be pasted back in. `?from=<id>` prefills the key, titles and bodies from that
   * version; the key is then locked, because a privacy notice's successor is a privacy notice.
   * A `from` that resolves to nothing — deleted, mistyped — is the empty form, not an error.
   */
  const source = from ? await findVersionWithTranslations(getDb(), from) : undefined;
  // `?template=<key>` starts from the platform's own text (§95): the club reads, fills its
  // four facts and approves, rather than drafting a privacy notice from nothing.
  const fromTemplate = template && isLegalDocumentKey(template) ? LEGAL_TEMPLATES[template] : undefined;
  // The facts the platform knows are written in before the club reads (§132): the legal name
  // from the club's own paper declaration, the contact address every email already names.
  const facts = { legalName: CLUB_LEGAL_NAME, contactEmail: env.EMAIL_REPLY_TO ?? null };
  const values: LegalDocumentFormValues | undefined = source
    ? { key: source.key, ro: pick(source.translations, "ro"), en: pick(source.translations, "en") }
    : fromTemplate && template && isLegalDocumentKey(template)
      ? {
          key: template,
          ro: { title: fromTemplate.ro.title, body: fillClubFacts(fromTemplate.ro.body, facts) },
          en: { title: fromTemplate.en.title, body: fillClubFacts(fromTemplate.en.body, facts) },
        }
      : undefined;
  // What is still a blank, named, so the Administrator types two things and not a search.
  const blanks = values && fromTemplate ? remainingPlaceholders(values.ro.body) : [];

  return (
    <Stack spacing={3}>
      <Stack spacing={1}>
        <Link href="/admin/legal">{t("legal.backToList")}</Link>
        <Typography variant="h2" sx={{ fontSize: "1.25rem" }}>
          {t("legal.newTitle")}
        </Typography>
        <Typography variant="body2" color="text.secondary">
          {source
            ? t("legal.newFromIntro", { version: source.version })
            : fromTemplate
              ? blanks.length > 0
                ? t("legal.newFromTemplateIntro", { blanks: blanks.join(", ") })
                : t("legal.newFromTemplateComplete")
              : t("legal.newIntro")}
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
        values={values}
        keyLocked={Boolean(source || fromTemplate)}
        submitLabel={t("legal.saveDraft")}
      />
    </Stack>
  );
}
