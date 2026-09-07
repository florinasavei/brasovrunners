import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Chip from "@mui/material/Chip";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import type { Metadata } from "next";
import { hasLocale } from "next-intl";
import { getFormatter, getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { getDb } from "@/db/client";
import { getPathname, Link } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";
import {
  type LegalDocumentVersionRow,
  listVersionsForBackoffice,
} from "@/modules/legal-documents/repository";
import { isReliedOn } from "@/modules/legal-documents/service";
import { requireStaffRole } from "@/modules/staff-identity/session";
import { pageCount, parseListQuery } from "@/modules/staff-identity/domain/admin-list-query";
import AdminTable, { type AdminColumn } from "@/modules/staff-identity/ui/AdminTable";
import ConfirmSubmitButton from "@/shared/ui/ConfirmSubmitButton";
import { deleteLegalVersionAction } from "../actions";

type Props = {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
};

export const dynamic = "force-dynamic";

export const metadata: Metadata = { robots: { index: false, follow: false } };

/**
 * The legal documents, as the club can see them (BR-REQ-053-01, BR-REQ-053-02, AGENTS.md §12.5).
 *
 * §12.5 makes a version immutable once anything references it, and the reason is what a
 * declaration *is*: a participant signed version 3, and `declaration_acceptances` records that
 * they signed version 3. Editing the words of version 3 afterwards would leave every one of
 * those signatures pointing at text nobody agreed to.
 *
 * So the counts on each row are not decoration. They are the answer to "may this be changed",
 * stated on the page rather than in a document somebody has to remember.
 *
 * ## The third count
 *
 * There are three, not two, and the new one is the one that was missing. A privacy notice is
 * referenced from `registrations` by *version number* — `privacy_notice_version`,
 * `results_consent_version` and `health_consent_version` are plain integers with no foreign key
 * — so a notice hundreds of people acknowledged used to appear on this screen as "not used
 * yet". The row said a version was free when it was the most relied-upon document the club has
 * (`DECISIONS.md` §53).
 *
 * ## What may be deleted, and what the refusal says
 *
 * A draft that was never approved, and nothing else. Where a version cannot be deleted the row
 * says why, derived from the counts: "Approved — what the club published stays on the record",
 * or the three numbers that depend on it. A missing button explains nothing; a count is a
 * reason an organizer accepts. The server refuses regardless (BR-REQ-060-01) — this only
 * changes what the screen is able to explain before anything is pressed.
 *
 * Administrator only, asserted here on the server — the same rule the staff screen carries,
 * because a legal document is exactly the kind of thing that must not be editable by whoever
 * happens to be signed in.
 */
export default async function LegalDocumentsPage({ params, searchParams }: Props) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);

  await requireStaffRole("ADMIN");

  const current = await searchParams;
  const { saved, error } = current;

  const t = await getTranslations("Admin");
  const format = await getFormatter();
  const versions = await listVersionsForBackoffice(getDb());

  const query = parseListQuery(current, {
    // Grouped by document, newest version first — the order the repository already returns and
    // the only one that reads as a version history.
    sortable: [],
    defaultSort: "version",
    defaultPerPage: 100,
  });

  const relianceOf = (version: LegalDocumentVersionRow) => ({
    signatures: version.acceptanceCount,
    events: version.eventCount,
    acknowledgements: version.privacyAcknowledgementCount,
  });

  const columns: readonly AdminColumn<LegalDocumentVersionRow>[] = [
    {
      key: "document",
      label: t("legal.document"),
      primary: true,
      render: (version) => (
        <Link href={{ pathname: "/admin/legal/[id]", params: { id: version.id } }}>
          {t(`legal.keys.${version.key}`)} · {t("legal.version")} {version.version}
        </Link>
      ),
    },
    {
      key: "state",
      label: t("legal.state"),
      render: (version) => (
        <Chip
          size="small"
          color={version.isApproved ? "success" : "default"}
          label={version.isApproved ? t("legal.approved") : t("legal.draft")}
        />
      ),
    },
    {
      key: "languages",
      label: t("legal.languages"),
      hideBelow: "lg",
      render: (version) => version.locales.join(", ").toUpperCase() || "—",
    },
    {
      key: "usage",
      label: t("legal.usage"),
      render: (version) => {
        const reliance = relianceOf(version);
        return isReliedOn({
          acceptances: reliance.signatures,
          events: reliance.events,
          privacyAcknowledgements: reliance.acknowledgements,
        })
          ? t("legal.referencedFull", reliance)
          : t("legal.unreferenced");
      },
    },
    {
      key: "effectiveAt",
      label: t("legal.effectiveAt"),
      hideBelow: "lg",
      render: (version) => format.dateTime(version.effectiveAt, { dateStyle: "medium" }),
    },
  ];

  return (
    <Stack spacing={3}>
      <Box id="admin-alert" tabIndex={-1} sx={{ scrollMarginTop: 16 }}>
        {error && <Alert severity="error">{t(`errors.${error}`)}</Alert>}
        {saved === "legalVersionDeleted" && (
          <Alert severity="success">{t("legal.legalVersionDeleted")}</Alert>
        )}
        {saved && saved !== "legalVersionDeleted" && <Alert severity="success">{t("saved")}</Alert>}
      </Box>

      <Stack spacing={1}>
        <Typography variant="h2" sx={{ fontSize: "1.25rem" }}>
          {t("legal.title")}
        </Typography>
        <Typography variant="body2" color="text.secondary">
          {t("legal.intro")}
        </Typography>
      </Stack>

      {versions.length === 0 ? (
        <Alert severity="warning">{t("legal.empty")}</Alert>
      ) : (
        <AdminTable
          caption={t("legal.tableCaption")}
          columns={columns}
          rows={versions}
          rowKey={(version) => version.id}
          basePath={getPathname({ locale, href: "/admin/legal" })}
          currentParams={{}}
          query={query}
          total={versions.length}
          labels={{
            results: t("list.results", { count: versions.length }),
            page: t("list.page", {
              page: query.page,
              pages: pageCount(versions.length, query.perPage),
            }),
            previous: t("list.previous"),
            next: t("list.next"),
            perPage: t("list.perPage"),
            actions: t("list.actions"),
            sortBy: (column) => t("list.sortBy", { column }),
          }}
          empty={<Alert severity="warning">{t("legal.empty")}</Alert>}
          rowActions={(version) => {
            const reliance = relianceOf(version);
            const relied = isReliedOn({
              acceptances: reliance.signatures,
              events: reliance.events,
              privacyAcknowledgements: reliance.acknowledgements,
            });

            /*
              Three outcomes, and each says which it is. Approval is checked before reliance
              because it is the stronger reason: an approved version stays whether or not
              anybody happened to act on it, so reporting "nobody has signed this" about one
              would be true and beside the point.
            */
            if (version.isApproved) {
              return (
                <Typography
                  variant="body2"
                  color="text.secondary"
                  sx={{ maxWidth: 280, textAlign: "right" }}
                >
                  {t("legal.deleteBlockedApproved")}
                </Typography>
              );
            }

            if (relied) {
              return (
                <Typography
                  variant="body2"
                  color="text.secondary"
                  sx={{ maxWidth: 280, textAlign: "right" }}
                >
                  {t("legal.deleteBlockedReferenced", reliance)}
                </Typography>
              );
            }

            return (
              <Box component="form" action={deleteLegalVersionAction}>
                <input type="hidden" name="uiLocale" value={locale} />
                <input type="hidden" name="versionId" value={version.id} />
                <ConfirmSubmitButton
                  label={t("legal.delete")}
                  title={t("legal.deleteTitle")}
                  body={t("legal.deleteBody")}
                  confirmLabel={t("legal.delete")}
                  cancelLabel={t("confirm.cancel")}
                  color="error"
                />
              </Box>
            );
          }}
        />
      )}

      <Alert severity="info">{t("legal.immutabilityNotice")}</Alert>
    </Stack>
  );
}
