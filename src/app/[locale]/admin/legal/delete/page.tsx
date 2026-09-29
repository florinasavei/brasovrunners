import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import type { Metadata } from "next";
import { hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { getDb } from "@/db/client";
import { CLUB_TIME_ZONE, formatDayRange } from "@/i18n/dates";
import { Link } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";
import { deletionOrder } from "@/modules/legal-documents/domain/batch";
import { batchConfirmationPhrase, confirmationPhrase } from "@/modules/legal-documents/domain/confirmation";
import { deletionObstacle, type InForceWindow, isReliedOn } from "@/modules/legal-documents/domain/deletability";
import { reliancePhrases } from "@/modules/legal-documents/domain/retire-steps";
import { type LegalDocumentVersionRow, listVersionsForBackoffice } from "@/modules/legal-documents/repository";
import { readDeletionFacts } from "@/modules/legal-documents/service";
import { canWriteLegalTexts } from "@/modules/staff-identity/domain/roles";
import { requireStaff } from "@/modules/staff-identity/session";
import { confirmWords } from "@/shared/feedback/confirm-words";
import ActionForm from "@/shared/forms/ActionForm";
import RecallField, { NeverKeptField } from "@/shared/forms/recall";
import { refusalMessages } from "@/shared/forms/refusal-messages";
import { isUuid } from "@/shared/ids";
import GlyphSubmitButton from "@/shared/ui/GlyphSubmitButton";
import { deleteLegalVersionsAction } from "../actions";

type Props = {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export const dynamic = "force-dynamic";

export const metadata: Metadata = { robots: { index: false, follow: false } };

/**
 * The versions ticked on `/admin/legal`, deleted in one press (§532).
 *
 * A screen and not only a dialog, for the reasons `/admin/legal/[id]/delete` gives: an approved
 * version's deletion is a typed phrase and a reason, a refusal must land where the phrase is
 * shown, and the form works without JavaScript. With only drafts ticked it is one press behind
 * the §384 confirm dialog, as one draft's delete is on the list.
 *
 * What it owes the reader is the list: every ticked version by its own phrase (`GDPR 2`), what
 * happens to it, and — for a version that cannot go — the reason, in the list's own words, from
 * the service's own verdict (`readDeletionFacts`, `deletionObstacle`). Only the versions that can
 * go are posted; `deleteVersionsInBatch` asks every one of them again, and refuses the whole
 * press if any answer changed (BR-REQ-060-01).
 */
export default async function DeleteLegalVersionsPage({ params, searchParams }: Props) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);

  const staffUser = await requireStaff();
  // The same gate as deleting one version: the role that writes the club's word unwrites it (§450).
  if (!canWriteLegalTexts(staffUser.role)) notFound();

  const query = await searchParams;
  const asked = new Set([query.id ?? []].flat().filter(isUuid));

  const db = getDb();
  const now = new Date();
  const t = await getTranslations("Admin");
  const words = await confirmWords();
  const versions = await listVersionsForBackoffice(db);
  const selected = deletionOrder(versions.filter((row) => asked.has(row.id)));
  const facts = await readDeletionFacts(db, selected, versions, now);

  const span = (window: InForceWindow) =>
    formatDayRange(window.from, window.until ?? now, { locale, timeZone: CLUB_TIME_ZONE, style: "short", position: "inline" });

  /** Why a ticked version stays, in the list's own sentences; null when it may go. */
  const blockedReason = (row: LegalDocumentVersionRow, index: number): string | null => {
    // The counts in words, «1 semnătură» (§NNN): the site's rule for counted nouns.
    const reliance = reliancePhrases(
      (key, values) => t(key, values),
      { signatures: row.acceptanceCount, events: row.eventCount, acknowledgements: row.privacyAcknowledgementCount },
      locale,
    );
    if (!row.isApproved) {
      return isReliedOn({ acceptances: row.acceptanceCount, events: row.eventCount, privacyAcknowledgements: row.privacyAcknowledgementCount })
        ? t("legal.deleteBlockedReferenced", reliance)
        : null;
    }
    const obstacle = deletionObstacle(facts[index]);
    switch (obstacle?.kind) {
      case undefined:
        return null;
      case "draft":
        return null;
      case "deleted":
        return t("errors.LEGAL_ALREADY_DELETED");
      case "referenced":
        return t("legal.removeBlockedReferenced", reliance);
      case "inForce":
        return t("legal.removeBlockedCurrent");
      case "termsAccepted":
        return t("legal.deleteBlockedTermsAccepted", { count: obstacle.registrations, window: span(obstacle.window) });
    }
  };

  const verdicts = selected.map((row, index) => ({ row, blocked: blockedReason(row, index) }));
  const deletable = verdicts.filter((verdict) => verdict.blocked === null).map((verdict) => verdict.row);
  const blocked = verdicts.filter((verdict) => verdict.blocked !== null);
  const approvedCount = deletable.filter((row) => row.isApproved).length;
  const phrase = batchConfirmationPhrase(approvedCount);
  const name = (row: LegalDocumentVersionRow) => `${t(`legal.keys.${row.key}`)} · ${t("legal.version")} ${row.version} (${confirmationPhrase(row.key, row.version)})`;

  return (
    <Stack spacing={3} sx={{ maxWidth: 640 }}>
      <Typography variant="body2">
        <Link href="/admin/legal">{t("legal.batch.backToList")}</Link>
      </Typography>

      <Typography variant="h2" sx={{ fontSize: "1.25rem" }}>
        {t("legal.batch.title")}
      </Typography>

      {selected.length === 0 && <Alert severity="info">{t("legal.batch.nothingSelected")}</Alert>}

      {deletable.length > 0 && (
        <Stack spacing={1} data-testid="legal-batch-goes">
          <Typography variant="h3" sx={{ fontSize: "1.05rem" }}>
            {t("legal.batch.goes", { count: deletable.length })}
          </Typography>
          <Box component="ul" sx={{ m: 0, pl: 3 }}>
            {deletable.map((row) => (
              <Typography component="li" variant="body2" key={row.id}>
                {name(row)} — {row.isApproved ? t("legal.batch.approvedGoes") : t("legal.batch.draftGoes")}
              </Typography>
            ))}
          </Box>
        </Stack>
      )}

      {blocked.length > 0 && (
        <Stack spacing={1} data-testid="legal-batch-stays">
          <Typography variant="h3" sx={{ fontSize: "1.05rem" }}>
            {t("legal.batch.stays", { count: blocked.length })}
          </Typography>
          <Box component="ul" sx={{ m: 0, pl: 3 }}>
            {blocked.map(({ row, blocked: reason }) => (
              <Typography component="li" variant="body2" key={row.id}>
                {name(row)} — {reason}
              </Typography>
            ))}
          </Box>
        </Stack>
      )}

      {deletable.length > 0 &&
        (approvedCount > 0 ? (
          <>
            <Alert severity="error" icon={false}>
              <Stack spacing={1}>
                <Typography variant="body2">{t("legal.batch.approvedConsequence", { count: approvedCount })}</Typography>
                <Typography variant="body2">{t("legal.erase.auditOnly")}</Typography>
              </Stack>
            </Alert>
            {/*
              The phrase is the confirmation, checked on the server, as on one version's screen:
              no dialog on top of it. It carries the count of approved versions listed above, so a
              selection that changed between this screen and the press no longer matches.
            */}
            <ActionForm
              action={deleteLegalVersionsAction}
              messages={await refusalMessages(
                { typedConfirmation: t("legal.erase.phraseLabel"), reason: t("legal.erase.reasonLabel") },
                { confirmation: true },
              )}
              data-testid="legal-batch-form"
            >
              <input type="hidden" name="uiLocale" value={locale} />
              {deletable.map((row) => (
                <input key={row.id} type="hidden" name="versionId" value={row.id} />
              ))}
              <Stack spacing={2}>
                <NeverKeptField
                  name="typedConfirmation"
                  label={t("legal.erase.phraseLabel")}
                  helperText={t("legal.batch.phraseHelp", { phrase })}
                  required
                  autoComplete="off"
                  slotProps={{ htmlInput: { maxLength: 100 } }}
                />
                <RecallField
                  name="reason"
                  label={t("legal.erase.reasonLabel")}
                  helperText={t("legal.batch.reasonHelp")}
                  required
                  slotProps={{ htmlInput: { minLength: 3, maxLength: 500 } }}
                />
                <Box>
                  <GlyphSubmitButton
                    icon="erase"
                    label={t("legal.batch.action", { count: deletable.length })}
                    pendingLabel={t("legal.batch.pending")}
                    incompleteHintNamed={t.raw("forms.incompleteFirst") as string}
                    color="error"
                    size="medium"
                  />
                </Box>
              </Stack>
            </ActionForm>
          </>
        ) : (
          <ActionForm
            action={deleteLegalVersionsAction}
            confirm={{
              title: t("legal.batch.draftsConfirmTitle", { count: deletable.length }),
              body: t("legal.batch.draftsConfirmBody", { versions: deletable.map((row) => confirmationPhrase(row.key, row.version)).join(", ") }),
              confirmLabel: t("legal.batch.deleteDrafts", { count: deletable.length }),
              cancelLabel: words.cancel,
              destructive: true,
            }}
            data-testid="legal-batch-form"
          >
            <input type="hidden" name="uiLocale" value={locale} />
            {deletable.map((row) => (
              <input key={row.id} type="hidden" name="versionId" value={row.id} />
            ))}
            <Stack spacing={1.5}>
              <Typography variant="body2" color="text.secondary">
                {t("legal.batch.draftsOnly")}
              </Typography>
              <Box>
                <GlyphSubmitButton
                  icon="delete"
                  label={t("legal.batch.deleteDrafts", { count: deletable.length })}
                  pendingLabel={t("legal.batch.pending")}
                  color="error"
                  size="medium"
                />
              </Box>
            </Stack>
          </ActionForm>
        ))}
    </Stack>
  );
}
