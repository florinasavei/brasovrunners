import Alert from "@mui/material/Alert";
import Chip from "@mui/material/Chip";
import Stack from "@mui/material/Stack";
import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableHead from "@mui/material/TableHead";
import TableRow from "@mui/material/TableRow";
import Typography from "@mui/material/Typography";
import type { Metadata } from "next";
import { hasLocale } from "next-intl";
import { getFormatter, getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { getDb } from "@/db/client";
import { Link } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";
import { listVersionsForBackoffice } from "@/modules/legal-documents/repository";
import { requireStaffRole } from "@/modules/staff-identity/session";

type Props = { params: Promise<{ locale: string }> };

export const dynamic = "force-dynamic";

export const metadata: Metadata = { robots: { index: false, follow: false } };

/**
 * The legal documents, as the club can see them (BR-REQ-053-01, AGENTS.md §12.5).
 *
 * Reading, and only reading. §12.5 makes a version immutable once anything references it, and
 * the reason is what a declaration *is*: a participant signed version 3, and
 * `declaration_acceptances` records that they signed version 3. Editing the words of version 3
 * afterwards would leave every one of those signatures pointing at text nobody agreed to.
 *
 * So the two counts on each row are not decoration. They are the answer to "may this be
 * changed", stated on the page rather than in a document somebody has to remember: a version
 * with no acceptances and no event pointing at it is a draft; anything else is history.
 *
 * Administrator only, asserted here on the server (BR-REQ-060-01) — the same rule the staff
 * screen carries, because a legal document is exactly the kind of thing that must not be
 * editable by whoever happens to be signed in.
 */
export default async function LegalDocumentsPage({ params }: Props) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);

  await requireStaffRole("ADMIN");

  const t = await getTranslations("Admin");
  const format = await getFormatter();
  const versions = await listVersionsForBackoffice(getDb());

  return (
    <Stack spacing={3}>
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
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>{t("legal.document")}</TableCell>
              <TableCell>{t("legal.version")}</TableCell>
              <TableCell>{t("legal.state")}</TableCell>
              <TableCell>{t("legal.languages")}</TableCell>
              <TableCell>{t("legal.usage")}</TableCell>
              <TableCell>{t("legal.effectiveAt")}</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {versions.map((version) => {
              // "Frozen" is a fact about the data, not a setting: anything has referenced it.
              const referenced = version.acceptanceCount > 0 || version.eventCount > 0;

              return (
                <TableRow key={version.id}>
                  <TableCell>
                    <Link href={{ pathname: "/admin/legal/[id]", params: { id: version.id } }}>
                      {t(`legal.keys.${version.key}`)}
                    </Link>
                  </TableCell>
                  <TableCell>{version.version}</TableCell>
                  <TableCell>
                    <Chip
                      size="small"
                      color={version.isApproved ? "success" : "default"}
                      label={version.isApproved ? t("legal.approved") : t("legal.draft")}
                    />
                  </TableCell>
                  <TableCell>{version.locales.join(", ").toUpperCase() || "—"}</TableCell>
                  <TableCell>
                    {referenced
                      ? t("legal.referenced", {
                          signatures: version.acceptanceCount,
                          events: version.eventCount,
                        })
                      : t("legal.unreferenced")}
                  </TableCell>
                  <TableCell>{format.dateTime(version.effectiveAt, { dateStyle: "medium" })}</TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      )}

      <Alert severity="info">{t("legal.immutabilityNotice")}</Alert>
    </Stack>
  );
}
