import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Stack from "@mui/material/Stack";
import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableHead from "@mui/material/TableHead";
import TableRow from "@mui/material/TableRow";
import Typography from "@mui/material/Typography";
import type { Metadata } from "next";
import { hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { getDb } from "@/db/client";
import { Link } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";
import { readEmergencySheet } from "@/modules/registrations/admin-service";
import { findEventForBibs } from "@/modules/registrations/bibs";
import { raceNumberOf } from "@/modules/registrations/domain/race-number";
import { canReadRegistrations } from "@/modules/staff-identity/domain/roles";
import { requireStaff } from "@/modules/staff-identity/session";
import { isDomainError } from "@/shared/errors/domain-error";
import PrintButton from "@/shared/ui/PrintButton";

type Props = { params: Promise<{ locale: string; id: string }> };

export const dynamic = "force-dynamic";

export const metadata: Metadata = { robots: { index: false, follow: false } };

/**
 * The emergency sheet (§322): one page, printed and carried by whoever is on the course — every
 * confirmed runner's race number, name, phone, emergency contact and health note.
 *
 * The form asked for all of it "for race day" and the club had no way to read it on race day.
 * This is that way, for the people it is for: whoever may read the registrations (§289, the
 * Organizer who organizes the race), and never the desk, which every staff role works and which
 * shows a name, a state and a number (`AGENTS.md` §15.11). A Voluntar or a Tehnic gets the same
 * 404 as a typed URL to a page that does not exist (BR-REQ-060-01), and the service refuses them
 * again. Each render is recorded — `event.emergency_sheet_viewed`, the row count and no value —
 * because the paper leaves the building and the trail is the only record that it was made; the
 * heading says to destroy it after the event.
 *
 * The health column empties itself: seven days after the event the sweep clears the notes
 * (`jobs/retention.ts`), and a sheet printed afterwards simply has none.
 */
export default async function EmergencySheetPage({ params }: Props) {
  const { locale, id } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);

  const actor = await requireStaff();
  if (!canReadRegistrations(actor.role)) notFound();

  const db = getDb();
  let rows;
  try {
    rows = await readEmergencySheet(db, actor, id, new Date());
  } catch (error) {
    if (isDomainError(error) && (error.code === "NOT_FOUND" || error.code === "FORBIDDEN")) notFound();
    throw error;
  }
  const event = await findEventForBibs(db, id, locale);
  const t = await getTranslations("Admin");
  const when = event
    ? new Intl.DateTimeFormat(locale === "ro" ? "ro-RO" : "en-GB", { dateStyle: "long", timeZone: event.timezone }).format(event.startsAt)
    : "";

  return (
    <Stack spacing={2}>
      <Typography variant="body2" sx={{ "@media print": { display: "none" } }}>
        <Link href={{ pathname: "/admin/events/[id]", params: { id } }}>{t("emergency.backToEvent")}</Link>
      </Typography>

      <Typography variant="h2" sx={{ fontSize: "1.25rem", color: "error.main" }}>
        {t("emergency.title")}
      </Typography>
      {event && (
        <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
          {t("emergency.event", { event: event.title, date: when })}
        </Typography>
      )}
      <Typography variant="body2" color="text.secondary">
        {t("emergency.help")}
      </Typography>
      <Box>
        <PrintButton label={t("emergency.print")} />
      </Box>

      {rows.length === 0 ? (
        <Alert severity="info">{t("emergency.empty")}</Alert>
      ) : (
        <>
          <Typography variant="body2">{t("emergency.count", { count: rows.length })}</Typography>
          {/* Scrolls sideways on a phone rather than squeezing five columns into 320px; on paper
              it is the full width of the sheet. */}
          <Box sx={{ overflowX: "auto" }}>
            <Table size="small" aria-label={t("emergency.title")}>
              <TableHead>
                <TableRow>
                  <TableCell>{t("emergency.columnBib")}</TableCell>
                  <TableCell>{t("emergency.columnName")}</TableCell>
                  <TableCell>{t("emergency.columnPhone")}</TableCell>
                  <TableCell>{t("emergency.columnContact")}</TableCell>
                  <TableCell>{t("emergency.columnHealth")}</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {rows.map((row) => (
                  <TableRow key={row.id} data-testid="emergency-row">
                    <TableCell sx={{ fontWeight: 700, whiteSpace: "nowrap" }}>{raceNumberOf(row)?.value ?? ""}</TableCell>
                    <TableCell>
                      {row.registeredName}
                      {row.checkedInAt && (
                        <Typography component="span" variant="caption" color="text.secondary" sx={{ display: "block" }}>
                          {t("emergency.present")}
                        </Typography>
                      )}
                    </TableCell>
                    <TableCell sx={{ whiteSpace: "nowrap" }}>{row.phone ?? ""}</TableCell>
                    <TableCell>
                      {row.emergencyContactName ?? ""}
                      {row.emergencyContactPhone && (
                        <Typography component="span" variant="body2" sx={{ display: "block", whiteSpace: "nowrap" }}>
                          {row.emergencyContactPhone}
                        </Typography>
                      )}
                    </TableCell>
                    <TableCell sx={{ whiteSpace: "pre-wrap" }}>{row.healthNotes ?? ""}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Box>
        </>
      )}
    </Stack>
  );
}
