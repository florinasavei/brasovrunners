import { csvCell } from "@/modules/registrations/csv";

/**
 * «Descarcă CSV» on the newsletter's «Abonați» card (§NNN, amending §445): the table's columns, one
 * row per subscriber the filter shows, in the reader's language.
 *
 * The registrations export's rules (`registrations/csv.ts`): every cell through the one `csvCell`, so
 * an address or a word starting with `=`, `+`, `-` or `@` opens as text, never as a formula, and a
 * comma, a quote or a line break is quoted; CRLF between lines (RFC 4180). One thing more: a **BOM**
 * first, because the club opens the file in Excel on Windows, which reads a CSV without one as the
 * old Windows code page — «Toate noutățile» would arrive as «Toate noutÄƒÈ›ile».
 *
 * Dates are ISO 8601 with the offset, as the registrations export writes them: a spreadsheet sorts
 * them, and no weekday or month name in a cell has to be read back.
 */

export const CSV_BOM = "﻿";

export type SubscriberCsvRow = {
  email: string;
  /** "RO" / "EN": the language the subscriber's messages read in first. */
  language: string;
  /** The topics in the reader's words, «; »-joined. */
  topics: string;
  /** «Confirmat» / «În așteptare», in the reader's words. */
  state: string;
  subscribedAt: Date;
  confirmedAt: Date | null;
};

export type SubscriberCsvHeader = { email: string; language: string; topics: string; state: string; subscribed: string; confirmed: string };

export function buildSubscribersCsv(header: SubscriberCsvHeader, rows: readonly SubscriberCsvRow[]): string {
  const lines = [
    [header.email, header.language, header.topics, header.state, header.subscribed, header.confirmed].map(csvCell).join(","),
    ...rows.map((row) =>
      [row.email, row.language, row.topics, row.state, row.subscribedAt.toISOString(), row.confirmedAt?.toISOString() ?? ""].map(csvCell).join(","),
    ),
  ];
  return `${CSV_BOM}${lines.join("\r\n")}`;
}

/** The file's name, with the club's date: `newsletter-abonati-2026-09-28.csv`. */
export function subscribersCsvFileName(day: string): string {
  return `newsletter-abonati-${day}.csv`;
}
