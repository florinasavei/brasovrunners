import { onClubClock, type SheetColumn, STAMP_FORMAT, writeSheet } from "@/modules/registrations/workbook";
import type { VolunteerCsvHeader, VolunteerCsvRow } from "./csv";

/**
 * «Descarcă Excel» for an event's volunteers (§NNN; the owner, 2026-10-21: «I wanna be able to export volunteers in excel
 * as well»): the CSV's rows (`csv.ts`), the same words in the same language, as a spreadsheet through the one writer every
 * backoffice sheet goes through (`registrations/workbook.ts#writeSheet`) — a bold header kept on screen, widths that read,
 * the sign-up's moment on the club's clock in the club's format rather than the CSV's ISO instant, the age a number.
 * The columns a reader looks for first come first: the name, the state, the roles given and offered, then the contact,
 * then what the person said about themselves, the guardian and the two free texts last. The CSV keeps its order (§761):
 * nothing that reads it moves.
 */
export async function buildVolunteersWorkbook(header: VolunteerCsvHeader, rows: readonly VolunteerCsvRow[], sheetName: string): Promise<Buffer> {
  const text = (value: string | null) => ({ value: value ?? "", type: String });
  const columns: readonly SheetColumn<VolunteerCsvRow>[] = [
    { header: header.name, width: 28, cell: (row) => text(row.name) },
    { header: header.state, width: 12, cell: (row) => text(row.state) },
    { header: header.role, width: 30, cell: (row) => text(row.role) },
    { header: header.choices, width: 30, cell: (row) => text(row.choices) },
    { header: header.email, width: 30, cell: (row) => text(row.email) },
    { header: header.phone, width: 16, cell: (row) => text(row.phone) },
    { header: header.source, width: 24, cell: (row) => text(row.source) },
    { header: header.signedUpAt, width: 17, cell: (row) => ({ value: onClubClock(row.signedUpAt), type: Date, format: STAMP_FORMAT }) },
    { header: header.age, width: 8, cell: (row) => ({ value: row.age, type: Number }) },
    { header: header.dateOfBirth, width: 12, cell: (row) => text(row.dateOfBirth) },
    { header: header.sex, width: 8, cell: (row) => text(row.sex) },
    { header: header.city, width: 16, cell: (row) => text(row.city) },
    { header: header.volunteeredBefore, width: 14, cell: (row) => text(row.volunteeredBefore) },
    { header: header.clubMember, width: 14, cell: (row) => text(row.clubMember) },
    { header: header.shirtSize, width: 10, cell: (row) => text(row.shirtSize) },
    { header: header.guardianName, width: 24, cell: (row) => text(row.guardianName) },
    { header: header.guardianEmail, width: 30, cell: (row) => text(row.guardianEmail) },
    { header: header.guardianConsent, width: 12, cell: (row) => text(row.guardianConsent) },
    { header: header.message, width: 40, cell: (row) => text(row.message) },
    { header: header.note, width: 40, cell: (row) => text(row.note) },
  ];
  return writeSheet(columns, rows, sheetName, "Volunteers");
}

/** The file's name, with the club's date, like the CSV's: `voluntari-2026-11-21.xlsx`. */
export function volunteersWorkbookFileName(day: string): string {
  return `voluntari-${day}.xlsx`;
}
