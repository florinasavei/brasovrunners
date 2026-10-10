import { CSV_BOM } from "@/modules/newsletter/subscribers-csv";
import { csvCell } from "@/modules/registrations/csv";
import { formatPrice, orderTotalBani } from "./domain";
import type { AdminOrder } from "./repository";

/**
 * «Descarcă CSV» of the shop's orders (§683): the list's columns, the filter's rows, in the reader's
 * language — the registrations export's rules (`registrations/csv.ts`): every cell through the one
 * `csvCell` (no formula, quotes doubled), CRLF between lines, a BOM first for Excel on Windows (§550),
 * dates ISO 8601. The member's address only for a reader who already sees members' addresses (§550's
 * rule, `canSeeShopMemberAddresses`): otherwise the column is not in the file at all. The unit price
 * and the total are written in the order's own currency, named in the column after the unit price
 * (§686) — an order placed in euro stays in euro whatever the product says now. After the member's
 * name (and the address, when it is there), who placed the order: the member, or the club (§NNN).
 */

export type OrdersCsvHeader = {
  number: string;
  date: string;
  member: string;
  email: string;
  placedBy: string;
  product: string;
  variant: string;
  quantity: string;
  unitPrice: string;
  currency: string;
  total: string;
  status: string;
  note: string;
};

export function buildOrdersCsv(
  header: OrdersCsvHeader,
  rows: readonly AdminOrder[],
  options: {
    locale: string;
    withEmail: boolean;
    statusWord: (status: AdminOrder["status"]) => string;
    /** «membru» / «club» — the words of the column «Adăugată de» (§NNN). */
    placedByWord: (placedBy: AdminOrder["placedBy"]) => string;
  },
): string {
  const columns = (row: Record<keyof OrdersCsvHeader, string>) =>
    [
      row.number,
      row.date,
      row.member,
      ...(options.withEmail ? [row.email] : []),
      row.placedBy,
      row.product,
      row.variant,
      row.quantity,
      row.unitPrice,
      row.currency,
      row.total,
      row.status,
      row.note,
    ]
      .map(csvCell)
      .join(",");
  const lines = [
    columns(header),
    ...rows.map((row) =>
      columns({
        number: String(row.number),
        date: row.createdAt.toISOString(),
        member: row.memberName,
        email: row.memberEmail ?? "",
        placedBy: options.placedByWord(row.placedBy),
        product: options.locale === "en" ? row.productTitleEn : row.productTitleRo,
        variant: row.variantLabel ?? "",
        quantity: String(row.quantity),
        unitPrice: formatPrice(row.unitPriceBani, row.currency, options.locale),
        currency: row.currency,
        total: formatPrice(orderTotalBani(row), row.currency, options.locale),
        status: options.statusWord(row.status),
        note: row.note ?? "",
      }),
    ),
  ];
  return `${CSV_BOM}${lines.join("\r\n")}`;
}

/** The file's name, with the club's date: `magazin-comenzi-2026-10-10.csv`. */
export function ordersCsvFileName(day: string): string {
  return `magazin-comenzi-${day}.csv`;
}
