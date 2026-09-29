import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { refusalMessages } from "@/shared/forms/refusal-messages";
import ActionForm from "@/shared/forms/ActionForm";
import RecallField, { NeverKeptField } from "@/shared/forms/recall";
import GlyphSubmitButton from "@/shared/ui/GlyphSubmitButton";
import type { Metadata } from "next";
import { hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { CLUB_TIME_ZONE, formatDateInWords, formatDay, formatDayRange } from "@/i18n/dates";
import { notFound } from "next/navigation";
import { getDb } from "@/db/client";
import { Link } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";
import { confirmationPhrase } from "@/modules/legal-documents/domain/confirmation";
import { removalPlan } from "@/modules/legal-documents/domain/deletability";
import { reliancePhrases } from "@/modules/legal-documents/domain/retire-steps";
import { listVersionsForBackoffice } from "@/modules/legal-documents/repository";
import { readDeletionFacts } from "@/modules/legal-documents/service";
import LegalRetireSteps from "@/modules/legal-documents/ui/LegalRetireSteps";
import { canWriteLegalTexts } from "@/modules/staff-identity/domain/roles";
import { requireStaff } from "@/modules/staff-identity/session";
import { isUuid } from "@/shared/ids";
import { deleteApprovedLegalVersionAction, deleteReliedOnLegalVersionAction } from "../../actions";

type Props = {
  params: Promise<{ locale: string; id: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
};

export const dynamic = "force-dynamic";

export const metadata: Metadata = { robots: { index: false, follow: false } };

/**
 * «Șterge» on one approved version (BR-REQ-053-02, `DECISIONS.md` §151, §NNN).
 *
 * ## Two kinds of deletion, one screen
 *
 * What the service would do with this version is asked of the service's own rule (`removalPlan`,
 * fed by `readDeletionFacts`), so the screen and the server cannot name different things:
 *
 * - **nothing depends on it** — §151's real delete: the row, both texts and the number go, behind
 *   a typed phrase (`GDPR 2`) and a reason;
 * - **a signature, an event or a registration depends on it** (§NNN) — retire-and-hide, in two
 *   steps (`LegalRetireSteps`): what happens, with the counts in words, and the reason; then the
 *   version's number typed by hand. The text stays, because a signed version is the club's proof of
 *   what a person accepted (AGENTS.md §10.8, §556);
 * - **a draft, or the version in force** — refused, with what to do instead.
 *
 * ## Why a page rather than the dialog withdrawal uses
 *
 * The same three reasons `/admin/events/[id]/erase` gives, and they apply harder here. The
 * consequence is not one sentence; the confirmation is typed, so a refusal has to land somewhere
 * that still shows what to type; and a dialog is JavaScript, while the standing rule is that a form
 * works without it — the two steps are drawn together then, and the server checks both answers.
 *
 * ## What actually protects the text
 *
 * Not this page. `deleteApprovedVersion` and `deleteReliedOnVersion` assert the role, re-read the
 * counts inside their own transaction, compare what was typed, require the reason and write the
 * audit row first — a request that never rendered this page is refused in exactly the same way
 * (BR-REQ-060-01 criterion 4). The `notFound()` below is a courtesy: a role that may not do this
 * is not shown a screen explaining how.
 */
export default async function DeleteLegalVersionPage({ params, searchParams }: Props) {
  const { locale, id } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);

  const staffUser = await requireStaff();
  // The same gate as writing a version (`assertMayEdit`): the role that may publish the club's
  // word is the role that may unpublish it. Everyone else is not shown the screen at all.
  if (!canWriteLegalTexts(staffUser.role)) notFound();
  // A malformed id is the same 404 an unknown one gets, not the query Postgres refuses (§376).
  if (!isUuid(id)) notFound();

  const db = getDb();
  const versions = await listVersionsForBackoffice(db);
  const version = versions.find((row) => row.id === id);
  if (!version) notFound();

  const { error } = await searchParams;
  const t = await getTranslations("Admin");

  const now = new Date();
  const [facts] = await readDeletionFacts(db, [version], versions, now);
  const plan = removalPlan(facts);
  // "4–20 sept. 2026": the stretch the version was the text in force, up to now if it still is.
  const whenInForce = facts.terms
    ? formatDayRange(facts.terms.window.from, facts.terms.window.until ?? now, { locale, timeZone: CLUB_TIME_ZONE, style: "short", position: "inline" })
    : null;

  const document = t(`legal.keys.${version.key}`);
  const back = (
    <Typography variant="body2">
      <Link href={{ pathname: "/admin/legal/[id]", params: { id } }}>{t("legal.erase.backToVersion")}</Link>
    </Typography>
  );
  const alert = (
    <Box id="admin-alert" tabIndex={-1} sx={{ scrollMarginTop: 16 }}>
      {error && <Alert severity="error">{t(`errors.${error}`)}</Alert>}
    </Box>
  );

  if (plan.kind === "retire") {
    const counts = reliancePhrases((key, values) => t(key, values), plan.reliance, locale);
    const consequences = [
      t("legal.retire.consequence", counts),
      ...(plan.reliance.termsRegistrations > 0 ? [t("legal.retire.termsKept", { count: plan.reliance.termsRegistrations })] : []),
      t("legal.retire.stillShown"),
    ];
    return (
      <Stack spacing={3} sx={{ maxWidth: 640 }}>
        {back}
        {alert}
        <Typography variant="h2" sx={{ fontSize: "1.25rem" }}>
          {t("legal.retire.title", { document, version: version.version })}
        </Typography>
        <ActionForm
          action={deleteReliedOnLegalVersionAction}
          messages={await refusalMessages(
            { typedConfirmation: t("legal.retire.numberLabel"), reason: t("legal.retire.reasonLabel") },
            { confirmation: true },
          )}
          data-testid="legal-retire-form"
        >
          <input type="hidden" name="uiLocale" value={locale} />
          <input type="hidden" name="versionId" value={version.id} />
          <LegalRetireSteps
            version={version.version}
            words={{
              stepOne: t("legal.retire.stepOne"),
              consequences,
              reasonLabel: t("legal.retire.reasonLabel"),
              reasonHelp: t("legal.retire.reasonHelp"),
              continueLabel: t("legal.retire.continue"),
              stepTwo: t("legal.retire.stepTwo"),
              numberLabel: t("legal.retire.numberLabel"),
              numberHelp: t("legal.retire.numberHelp", { version: version.version }),
              action: t("legal.retire.action", { version: version.version }),
              back: t("legal.retire.back"),
              incompleteHint: t.raw("forms.incompleteFirst") as string,
            }}
          />
        </ActionForm>
      </Stack>
    );
  }

  const blocked =
    plan.kind === "refused"
      ? plan.reason === "draft"
        ? t("legal.erase.blockedDraft")
        : plan.reason === "inForce"
          ? t("legal.erase.blockedCurrent")
          : t("legal.retire.alreadyDeleted", {
              date: formatDay(version.deletedAt ?? now, { locale, timeZone: CLUB_TIME_ZONE, style: "long", position: "inline" }),
            })
      : null;

  /*
    Why it may go, in the terms that apply to this key. The three counts say nothing about a terms
    version, so "no signature, no event, no registration" would be a vacuous reassurance there;
    what is true is when it was in force and that nobody submitted a registration or signed a
    declaration in that time — or that it was never the text in force at all.
  */
  const whyItMayGo = whenInForce
    ? t("legal.erase.termsNobodyAccepted", { window: whenInForce })
    : version.key === "TERMS"
      ? t("legal.erase.termsNeverInForce")
      : t("legal.erase.nothingDepends");

  const phrase = confirmationPhrase(version.key, version.version);

  return (
    <Stack spacing={3} sx={{ maxWidth: 640 }}>
      {back}
      {alert}

      <Typography variant="h2" sx={{ fontSize: "1.25rem" }}>
        {t("legal.erase.title", { document, version: version.version })}
      </Typography>

      {blocked ? (
        <Alert severity="info">{blocked}</Alert>
      ) : (
        <>
          <Alert severity="error" icon={false}>
            <Stack spacing={1}>
              <Typography variant="body2">
                {t("legal.erase.whatGoes", {
                  document,
                  version: version.version,
                  date: formatDateInWords(version.effectiveAt, { locale, timeZone: CLUB_TIME_ZONE }),
                })}
              </Typography>
              {/*
                The number, stated as its own consequence. It is the one part of this that is
                not obvious from the word "delete", and it is the whole reason deleting an
                approved version is allowed at all (§151).
              */}
              <Typography variant="body2">{t("legal.erase.numberRetired", { version: version.version })}</Typography>
              <Typography variant="body2">{t("legal.erase.auditOnly")}</Typography>
            </Stack>
          </Alert>

          <Typography variant="body2" color="text.secondary">
            {whyItMayGo}
          </Typography>

          {/*
            Whether step one is already done. Somebody who withdrew this version last week
            should not have to wonder whether that is what this screen is asking for again —
            and somebody who has not withdrawn it is told that withdrawal exists and keeps
            everything, which is the cheaper decision of the two to get wrong.
          */}
          <Typography variant="body2" color="text.secondary">
            {version.withdrawnAt
              ? t("legal.erase.alreadyWithdrawn", {
                  date: formatDay(version.withdrawnAt, { locale, timeZone: CLUB_TIME_ZONE, style: "long", position: "inline" }),
                })
              : t("legal.erase.notWithdrawn")}
          </Typography>

          {/*
            No dialog and no tick: the confirmation *is* the typed phrase, checked on the server.
            The phrase carries the version number because every version of this document has the
            same title. A refusal keeps the reason and asks for the phrase again (§315).
          */}
          <ActionForm
            action={deleteApprovedLegalVersionAction}
            messages={await refusalMessages(
              { typedConfirmation: t("legal.erase.phraseLabel"), reason: t("legal.erase.reasonLabel") },
              { confirmation: true },
            )}
            data-testid="legal-erase-form"
          >
            <input type="hidden" name="uiLocale" value={locale} />
            <input type="hidden" name="versionId" value={version.id} />
            <Stack spacing={2}>
              <NeverKeptField
                name="typedConfirmation"
                label={t("legal.erase.phraseLabel")}
                helperText={t("legal.erase.phraseHelp", { phrase })}
                required
                autoComplete="off"
                slotProps={{ htmlInput: { maxLength: 100 } }}
              />
              <RecallField
                name="reason"
                label={t("legal.erase.reasonLabel")}
                helperText={t("legal.erase.reasonHelp")}
                required
                slotProps={{ htmlInput: { minLength: 3, maxLength: 500 } }}
              />
              <Box>
                <GlyphSubmitButton
                  icon="erase"
                  label={t("legal.erase.action")}
                  pendingLabel={t("legal.erase.action")}
                  incompleteHintNamed={t.raw("forms.incompleteFirst") as string}
                  color="error"
                  size="medium"
                />
              </Box>
            </Stack>
          </ActionForm>
        </>
      )}
    </Stack>
  );
}
