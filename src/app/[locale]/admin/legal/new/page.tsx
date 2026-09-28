import Alert from "@mui/material/Alert";
import GlyphButton from "@/shared/ui/GlyphButton";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import type { Metadata } from "next";
import { hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { getDb } from "@/db/client";
import { getPathname, Link } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";
import type { LegalDocumentBody } from "@/modules/legal-documents/domain/content-hash";
import { findVersionWithTranslations } from "@/modules/legal-documents/repository";
import { isLegalDocumentKey, LEGAL_TEMPLATES, templatePrefill } from "@/modules/legal-documents/templates/catalogue";
import { clubFactsFromEnv, remainingPlaceholders } from "@/modules/legal-documents/templates/club-facts";
import { shownContactAddresses } from "@/modules/contact/shown-address";
import { env } from "@/shared/config/env";
import LegalDocumentForm, {
  type LegalDocumentFormValues,
} from "@/modules/legal-documents/ui/LegalDocumentForm";
import { requireStaffCapability } from "@/modules/staff-identity/session";
import { canWriteLegalTexts } from "@/modules/staff-identity/domain/roles";
import { isUuid } from "@/shared/ids";
import { createLegalVersionAction, regenerateLegalTemplatesAction } from "../actions";
import { LEGAL_DOCUMENT_KEYS } from "@/modules/legal-documents/domain/keys";
import { LEGAL_KIND_GROUPS } from "@/modules/legal-documents/domain/overview";
import { readLegalOverview } from "@/modules/legal-documents/service";
import { CLUB_TIME_ZONE, formatDateInWords } from "@/i18n/dates";
import { confirmWords } from "@/shared/feedback/confirm-words";
import ActionForm from "@/shared/forms/ActionForm";
import GlyphSubmitButton from "@/shared/ui/GlyphSubmitButton";
import Box from "@mui/material/Box";
import Chip from "@mui/material/Chip";

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

  // The Administrator writes the club's legal texts since §450 (`canWriteLegalTexts`).
  await requireStaffCapability(canWriteLegalTexts);

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
  const source = from && isUuid(from) ? await findVersionWithTranslations(getDb(), from) : undefined;
  // `?template=<key>` starts from the platform's own text (§95): the club reads, fills its
  // four facts and approves, rather than drafting a privacy notice from nothing.
  const fromTemplate = template && isLegalDocumentKey(template) ? LEGAL_TEMPLATES[template] : undefined;
  // The facts the deployment knows are written in before the club reads (§132): the legal
  // name, the CIF and the seat from the environment, the contact address every email names.
  // The contact address as the club chose to show it (§442), «a sau b» when both.
  const facts = clubFactsFromEnv(env, await shownContactAddresses(getDb()));
  const values: LegalDocumentFormValues | undefined = source
    ? { key: source.key, ro: pick(source.translations, "ro"), en: pick(source.translations, "en") }
    : fromTemplate && template && isLegalDocumentKey(template)
      ? // Every `{{field}}` stays a field and every unknown fact its placeholder (§357).
        { key: template, ...templatePrefill(template, facts) }
      : undefined;
  // What is still a blank, named, so the Administrator types two things and not a search.
  const blanks = values && fromTemplate ? remainingPlaceholders(values.ro.body) : [];
  // Each text's state under its template's button, read only while the choice is shown (§NNN).
  const overview = values ? null : await readLegalOverview(getDb(), facts, new Date());
  const toRegenerate = overview ? LEGAL_DOCUMENT_KEYS.filter((key) => overview[key].regeneration === "create") : [];
  const words = await confirmWords();

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

      {/*
        Start from the template, offered above the blank form rather than as small print
        under it (§190).

        The owner, having pressed "Versiune nouă" and been handed an empty textarea: "când fac
        versiune nouă dă-mi un template de la care să plec!" The three links existed — under the
        button, phrased as an alternative to the thing he had already pressed. Nobody writes a
        privacy notice from nothing, so the template is the path and the blank form is the
        exception, which is what this panel says by standing above it.

        Only while nothing has been chosen: once `?template=` or `?from=` has filled the form,
        the panel would be offering to discard what the reader is looking at.
      */}
      {/*
        The owner, 2026-09-28, on this card: «de aici aș vrea să pot regenera documentele» (§NNN).
        So it is where the regenerating is: the six templates in three labelled rows, each button
        with its text's state under it — in force, a draft waiting, none — and «Șablon nou» when
        the template changed after the text in force was made from it. A press keeps its meaning,
        the form below prefilled with that template (regenerating one text); «Regenerează toate»
        makes a draft of every text whose template is due, through §532's own press.
      */}
      {!values && overview && (
        <Paper variant="outlined" sx={{ p: { xs: 2, sm: 3 } }} data-testid="legal-start-from">
          <Typography variant="subtitle2" sx={{ mb: 0.5 }}>
            {t("legal.startFrom.title")}
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }} data-testid="legal-start-from-help">
            {t("legal.startFrom.help")}
          </Typography>
          <Stack spacing={2}>
            {LEGAL_KIND_GROUPS.map((group) => (
              <Box key={group.id} component="section" aria-labelledby={`legal-group-${group.id}`} data-testid={`legal-group-${group.id}`}>
                <Typography id={`legal-group-${group.id}`} component="h3" variant="body2" sx={{ fontWeight: 700, mb: 1 }}>
                  {t(`legal.groups.${group.id}`)}
                </Typography>
                <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", sm: "1fr 1fr" }, gap: 1.5 }}>
                  {group.keys.map((documentKey) => {
                    const kind = overview[documentKey];
                    const state = [
                      kind.summary.inForce
                        ? t("legal.kinds.inForce", {
                            version: kind.summary.inForce.version,
                            date: formatDateInWords(kind.summary.inForce.effectiveAt, { locale, timeZone: CLUB_TIME_ZONE }),
                          })
                        : t("legal.kinds.noneInForce"),
                      kind.summary.waitingDraft ? t("legal.kinds.draftPending", { version: kind.summary.waitingDraft.version }) : null,
                    ]
                      .filter((line) => line !== null)
                      .join(" · ");
                    return (
                      <Stack key={documentKey} spacing={0.5} sx={{ alignItems: "flex-start" }} data-testid={`legal-template-${documentKey}`}>
                        <GlyphButton
                          icon="template"
                          href={`${getPathname({ locale, href: "/admin/legal/new" })}?template=${documentKey}`}
                          variant="outlined"
                          sx={{ minHeight: 44, textAlign: "left", justifyContent: "flex-start" }}
                        >
                          {t(`legal.keys.${documentKey}`)}
                        </GlyphButton>
                        <Stack direction="row" sx={{ flexWrap: "wrap", alignItems: "center", gap: 0.75 }}>
                          <Typography variant="body2" color="text.secondary" data-testid="legal-template-state">
                            {state}
                          </Typography>
                          {kind.templateNewer && (
                            <Chip size="small" color="warning" variant="outlined" label={t("legal.kinds.templateNew")} title={t("legal.kinds.templateNewHint")} />
                          )}
                        </Stack>
                      </Stack>
                    );
                  })}
                </Box>
              </Box>
            ))}

            {toRegenerate.length > 0 ? (
              <ActionForm
                action={regenerateLegalTemplatesAction}
                confirm={{
                  title: t("legal.batch.regenerateTitle", { count: toRegenerate.length }),
                  body: t("legal.batch.regenerateBody", { texts: toRegenerate.map((key) => t(`legal.keys.${key}`)).join(", ") }),
                  confirmLabel: t("legal.startFrom.regenerateAll", { count: toRegenerate.length }),
                  cancelLabel: words.cancel,
                }}
                data-testid="legal-regenerate-all"
              >
                <input type="hidden" name="uiLocale" value={locale} />
                <input type="hidden" name="returnTo" value="new" />
                {toRegenerate.map((key) => (
                  <input key={key} type="hidden" name="key" value={key} />
                ))}
                <GlyphSubmitButton
                  label={t("legal.startFrom.regenerateAll", { count: toRegenerate.length })}
                  pendingLabel={t("legal.batch.regeneratePending")}
                  icon="template"
                  variant="contained"
                  size="medium"
                />
              </ActionForm>
            ) : (
              <Typography variant="body2" color="text.secondary" data-testid="legal-regenerate-all-none">
                {t("legal.batch.upToDate")}
              </Typography>
            )}
          </Stack>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 2 }}>
            {t("legal.startFrom.orBlank")}
          </Typography>
        </Paper>
      )}

      <LegalDocumentForm
        action={createLegalVersionAction}
        locale={locale}
        values={values}
        keyLocked={Boolean(source || fromTemplate)}
        submitLabel={t("legal.saveDraft")}
        pendingLabel={t("editor.saving")}
        incompleteHint={t.raw("forms.incompleteFirst") as string}
      />
    </Stack>
  );
}
