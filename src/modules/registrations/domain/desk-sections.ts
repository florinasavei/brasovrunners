import type { RegistrationKind, RegistrationStatus } from "@/db/schema/registrations";
import type { FoldOpenWhen } from "@/shared/ui/fold";
import { isUuid } from "@/shared/ids";

/**
 * The desk's list in folding sections, one per state (§NNN; the owner, 2026-11-19: «Pe ziua cursei trebuie să fac secțiuni
 * collapsible în funcție de status»).
 *
 * The desk drew every row of the chosen event in one list, ordered by name: on race morning the people still to hand a number
 * to stood between the ones already here, the ones waiting for their address and the waiting list. The list is now one fold
 * per state, **in the table's working order** — what the volunteer does first comes first — each summary its words and the
 * count of its rows («De ridicat numărul (12)»), a section with no rows not drawn at all, and inside each section the rows in the
 * order the list always had them (`listDeskRegistrations`: by name, then id):
 *
 * 1. `toPickUp` — «De ridicat numărul»: confirmed, not yet here. Open on every arrival (`primary`): it is what the desk is for.
 * 2. `unsigned` — «Fără declarație semnată»: `PENDING_DECLARATION`, the rows the paper confirmation is pressed on. Open while it
 *    has rows (`attention`) — and a section without rows is not drawn, so it is open whenever it is there.
 * 3. `present` — «Prezenți»: confirmed and checked in. Closed.
 * 4. `addressUnconfirmed` — «Adresă neconfirmată»: `PENDING_EMAIL_CONFIRMATION`. Closed.
 * 5. `offered` — «Ofertă de loc deschisă»: `WAITLIST_OFFERED`. Closed.
 * 6. `waitlisted` — «Pe lista de așteptare»: `WAITLISTED`. Closed.
 * 7. `voided` — «Anulate sau expirate»: `CANCELLED` or `EXPIRED`, which the list holds only when a race number found them
 *    (BR-REQ-037-08 criterion 8, §311: the red rows). Open (`attention`: a printed bib may have to come out of the pile).
 *
 * Two more reasons open a section, whatever its default:
 *
 * - **a search** (a name fragment or a number, `inUse`): every section holding a match opens — and only those are drawn, since
 *   the others have no rows. A typed code is not a search here: it names one runner, whom the page draws alone, with no section.
 * - **the way back after a press** (`saved`, or `refused` when the press was refused): the section that now holds the row the
 *   press named — whatever moved it, a check-in moving a runner to «Prezenți» — so the row the page comes back to is in sight.
 *
 * The count is of the section's real rows (§30, §420, `AGENTS.md` §12.6): a test registration is drawn in its section, labelled
 * «Test», and left out of the number, as the desk's counters above the list leave it out — the section's number and the
 * counters agree.
 */
export const DESK_SECTION_KEYS = ["toPickUp", "unsigned", "present", "addressUnconfirmed", "offered", "waitlisted", "voided"] as const;

export type DeskSectionKey = (typeof DESK_SECTION_KEYS)[number];

/** What a row must say for the desk to place it: its state and whether it is here. */
type Placed = { status: RegistrationStatus; checkedInAt: Date | null };

/** The section a row stands in, by its state alone: a registration that is over is `voided` whatever else it carries. */
export function deskSectionOf(row: Placed): DeskSectionKey {
  switch (row.status) {
    case "CONFIRMED":
      return row.checkedInAt === null ? "toPickUp" : "present";
    case "PENDING_DECLARATION":
      return "unsigned";
    case "PENDING_EMAIL_CONFIRMATION":
      return "addressUnconfirmed";
    case "WAITLIST_OFFERED":
      return "offered";
    case "WAITLISTED":
      return "waitlisted";
    case "CANCELLED":
    case "EXPIRED":
      return "voided";
  }
}

/** Why each section opens by itself when nothing else asks it to (`shared/ui/fold.ts`, §336): the rest start closed. */
const OPENS_BY_DEFAULT: Readonly<Partial<Record<DeskSectionKey, FoldOpenWhen>>> = {
  toPickUp: { primary: true },
  unsigned: { attention: true },
  voided: { attention: true },
};

export type DeskSection<Row> = {
  key: DeskSectionKey;
  /** The section's rows, in the order the list gave them. */
  rows: readonly Row[];
  /** How many of them are real registrations: the summary's number (§30). */
  count: number;
  /** Why the section is drawn open, if it is (`opensByItself`). */
  openWhen: FoldOpenWhen;
};

/**
 * The row a press came back to (`row=` in the desk's address, written by the press's way back): a registration's id, read only
 * when it is shaped like one, in lower case as the database writes it.
 */
export function returnedRowOf(value: unknown): string | null {
  return typeof value === "string" && isUuid(value) ? value.toLowerCase() : null;
}

/**
 * The desk's rows in their sections, in the working order, the empty ones left out.
 *
 * `searching`: the desk's box holds a name fragment or a number — every section drawn holds a match, and opens.
 * `returned`: the row the last press named and whether that press was refused — its section opens.
 */
export function deskSections<Row extends Placed & { id: string; kind: RegistrationKind }>(
  rows: readonly Row[],
  { searching, returned = null }: { searching: boolean; returned?: { id: string; refused: boolean } | null },
): DeskSection<Row>[] {
  const byKey = new Map<DeskSectionKey, Row[]>(DESK_SECTION_KEYS.map((key) => [key, []]));
  for (const row of rows) byKey.get(deskSectionOf(row))?.push(row);
  return DESK_SECTION_KEYS.flatMap((key): DeskSection<Row>[] => {
    const inSection = byKey.get(key) ?? [];
    if (inSection.length === 0) return [];
    const holdsReturned = returned !== null && inSection.some((row) => row.id.toLowerCase() === returned.id);
    return [
      {
        key,
        rows: inSection,
        count: inSection.filter((row) => row.kind === "REAL").length,
        openWhen: {
          ...OPENS_BY_DEFAULT[key],
          ...(searching ? { inUse: true } : {}),
          ...(holdsReturned ? (returned.refused ? { refused: true } : { saved: true }) : {}),
        },
      },
    ];
  });
}
