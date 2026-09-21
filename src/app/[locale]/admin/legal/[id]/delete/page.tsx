import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import type { Metadata } from "next";
import { hasLocale } from "next-intl";
import { getFormatter, getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { getDb } from "@/db/client";
import { Link } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";
import { confirmationPhrase } from "@/modules/legal-documents/domain/confirmation";
import {
  findCurrentApprovedVersionId,
  listVersionsForBackoffice,
} from "@/modules/legal-documents/repository";
import { isReliedOn } from "@/modules/legal-documents/service";
import { canManageStaff } from "@/modules/staff-identity/domain/roles";
import { requireStaff } from "@/modules/staff-identity/session";
import { deleteApprovedLegalVersionAction } from "../../actions";

type Props = {
  params: Promise<{ locale: string; id: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
};

export const dynamic = "force-dynamic";

export const metadata: Metadata = { robots: { index: false, follow: false } };

/**
 * Deleting an approved legal version outright (BR-REQ-053-02, `DECISIONS.md` §151).
 *
 * ## Why a page rather than the dialog withdrawal uses
 *
 * The same three reasons `/admin/events/[id]/erase` gives, and they apply harder here. The
 * consequence is not one sentence — what goes, that nothing depends on it, that the number is
 * retired for ever, and that an audit line is all that will be left of a document the club
 * published. The confirmation is typed, so a refusal has to land somewhere that still shows the
 * phrase. And a dialog is JavaScript; the standing rule is that a form works without it.
 *
 * ## What actually protects the text
 *
 * Not this page. `deleteApprovedVersion` asserts the role, re-reads the dependant counts inside
 * its own transaction, compares the typed phrase, requires the reason, writes the audit row
 * first and retires the number — a request that never rendered this page is refused in exactly
 * the same way (BR-REQ-060-01 criterion 4). The `notFound()` below is a courtesy: a role that
 * may not do this is not shown a screen explaining how.
 *
 * What this page owes the reader is the paragraph above the form — precisely what is about to
 * stop existing — and, when it cannot be done, the reason, in the same words the list gives.
 */
export default async function DeleteLegalVersionPage({ params, searchParams }: Props) {
  const { locale, id } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);

  const staffUser = await requireStaff();
  // The same gate as writing a version (`assertMayEdit`): the role that may publish the club's
  // word is the role that may unpublish it. Everyone else is not shown the screen at all.
  if (!canManageStaff(staffUser.role)) notFound();

  const db = getDb();
  const version = (await listVersionsForBackoffice(db)).find((row) => row.id === id);
  if (!version) notFound();

  const { error } = await searchParams;
  const t = await getTranslations("Admin");
  const format = await getFormatter();

  const now = new Date();
  const reliance = {
    signatures: version.acceptanceCount,
    events: version.eventCount,
    acknowledgements: version.privacyAcknowledgementCount,
  };
  const relied = isReliedOn({
    acceptances: reliance.signatures,
    events: reliance.events,
    privacyAcknowledgements: reliance.acknowledgements,
  });
  const inForce = (await findCurrentApprovedVersionId(db, version.key, now)) === version.id;

  /*
    The obstacles in the service's own order — a draft first, then the three counts, then the
    version the site is serving — so the sentence this screen gives and the refusal the server
    would give name the same thing.
  */
  const blocked = !version.isApproved
    ? t("legal.erase.blockedDraft")
    : relied
      ? t("legal.erase.blockedReferenced", reliance)
      : inForce
        ? t("legal.erase.blockedCurrent")
        : null;

  const document = t(`legal.keys.${version.key}`);
  const phrase = confirmationPhrase(version.key, version.version);

  return (
    <Stack spacing={3} sx={{ maxWidth: 640 }}>
      <Typography variant="body2">
        <Link href={{ pathname: "/admin/legal/[id]", params: { id } }}>
          {t("legal.erase.backToVersion")}
        </Link>
      </Typography>

      <Box id="admin-alert" tabIndex={-1} sx={{ scrollMarginTop: 16 }}>
        {error && <Alert severity="error">{t(`errors.${error}`)}</Alert>}
      </Box>

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
                  date: format.dateTime(version.effectiveAt, { dateStyle: "long" }),
                })}
              </Typography>
              {/*
                The number, stated as its own consequence. It is the one part of this that is
                not obvious from the word "delete", and it is the whole reason deleting an
                approved version is allowed at all (§151).
              */}
              <Typography variant="body2">
                {t("legal.erase.numberRetired", { version: version.version })}
              </Typography>
              <Typography variant="body2">{t("legal.erase.auditOnly")}</Typography>
            </Stack>
          </Alert>

          <Typography variant="body2" color="text.secondary">
            {t("legal.erase.nothingDepends")}
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
                  date: format.dateTime(version.withdrawnAt, { dateStyle: "medium" }),
                })
              : t("legal.erase.notWithdrawn")}
          </Typography>

          {/*
            No dialog and no tick: the confirmation *is* the typed phrase, checked on the server.
            A tick the server does not read would be decoration (BR-REQ-060-01), and the phrase
            carries the version number because every version of this document has the same title.
          */}
          <Box component="form" action={deleteApprovedLegalVersionAction}>
            <input type="hidden" name="uiLocale" value={locale} />
            <input type="hidden" name="versionId" value={version.id} />
            <Stack spacing={2}>
              <TextField
                name="typedConfirmation"
                label={t("legal.erase.phraseLabel")}
                helperText={t("legal.erase.phraseHelp", { phrase })}
                required
                autoComplete="off"
                slotProps={{ htmlInput: { maxLength: 100 } }}
              />
              <TextField
                name="reason"
                label={t("legal.erase.reasonLabel")}
                helperText={t("legal.erase.reasonHelp")}
                required
                slotProps={{ htmlInput: { minLength: 3, maxLength: 500 } }}
              />
              <Box>
                <Button type="submit" color="error" variant="contained" sx={{ minHeight: 44 }}>
                  {t("legal.erase.action")}
                </Button>
              </Box>
            </Stack>
          </Box>
        </>
      )}
    </Stack>
  );
}
