import Chip from "@mui/material/Chip";
import Stack from "@mui/material/Stack";
import type { ReactNode } from "react";
import type { RegistrationStatus } from "@/db/schema/registrations";
import ChipLink from "@/shared/ui/ChipLink";
import { outsidePillHref, summaryPillHref, type SummaryQuery } from "../domain/summary-filter-links";
import HiddenListChip from "./HiddenListChip";

/**
 * The registrations list's summary strip: how many there are, each state they are made of and the
 * test rows apart (§246) — and every pill a **filter** (§626; the owner, 2026-10-01: «Și aceste
 * pilluri trebuie să fie clickabile (filtre)»).
 *
 * A Server Component with no island of its own: each pill is a `ChipLink`, an ordinary `<a>` with
 * the whole query in its address (as the start list's paging is, §250), so the filter works with
 * JavaScript off and can be bookmarked. The state in force is drawn pressed and links to the list
 * without it, so a second press clears it; the total links there too. Which pill is pressed is read
 * from the address, never kept as state anywhere: the panel's own select reads the same `status`.
 *
 * The counts are blind to the status filter (§246) — they say how the event stands, and a strip that
 * collapsed to one number when somebody pressed «Confirmată» would answer a question nobody asked —
 * so the page hands in the numbers it grouped without it, and a pill's count never moves with the
 * pill pressed. A state with nobody in it is not drawn, as before — unless it is the one in force, so the filter that emptied the list can always be pressed off. The test rows' pill is a label, not a
 * filter: `kind` is no status.
 *
 * «Invitați speciali» (§643, named and given the incognito glyph by §647, renamed by §649) is a pill of its own after the
 * states, a filter like them (`outside=1`, kept beside the state in force): the real rows on the
 * hidden list, drawn while there are any or while it is pressed. They are inside the total and the state pills too — they are
 * registrations — and outside every count of places.
 */
export default function SummaryStrip({
  basePath,
  query,
  active,
  statuses,
  summary,
  totalLabel,
  testLabel,
  statusLabel,
  outsideLabel = null,
  outsideHint,
  children,
}: {
  basePath: string;
  /** The page's own query, resolved the way its other links resolve it (`listParams`). */
  query: SummaryQuery;
  /** The state the list is filtered to, as the page understood the address; `null` for none. */
  active: RegistrationStatus | null;
  /** Every state, in the order the pills show them. */
  statuses: readonly RegistrationStatus[];
  summary: { real: number; byStatus: Partial<Record<RegistrationStatus, number>>; test: number; outside?: number };
  totalLabel: string;
  /** The test rows' label, or `null` to leave them out. */
  testLabel: string | null;
  statusLabel: Record<RegistrationStatus, string>;
  /** «Invitați speciali: N» (§643, §647, §649), worded by the page; `null` leaves the pill out. */
  outsideLabel?: string | null;
  /** The pill's one-line explanation (§649): its `title`, and its link's name after the label. */
  outsideHint?: string;
  /** What comes before the pills — the event's «Doar pentru membri» chip. */
  children?: ReactNode;
}) {
  return (
    <Stack direction="row" spacing={1} sx={{ flexWrap: "wrap", gap: 1, alignItems: "center" }} data-testid="registrations-summary-pills">
      {children}
      <ChipLink
        href={summaryPillHref(basePath, query, null)}
        label={totalLabel}
        active={active === null}
        current={active === null ? "page" : undefined}
        keepScroll
        wrap
      />
      {statuses
        .filter((value) => (summary.byStatus[value] ?? 0) > 0 || value === active)
        .map((value) => (
          <ChipLink
            key={value}
            href={summaryPillHref(basePath, query, value)}
            label={`${statusLabel[value]}: ${summary.byStatus[value] ?? 0}`}
            active={active === value}
            current={active === value ? "page" : undefined}
            keepScroll
          />
        ))}
      {outsideLabel !== null && ((summary.outside ?? 0) > 0 || query.outside === "1") && (
        <HiddenListChip href={outsidePillHref(basePath, query)} label={outsideLabel} hint={outsideHint} active={query.outside === "1"} testId="hidden-list-pill" />
      )}
      {testLabel !== null && summary.test > 0 && <Chip size="small" variant="outlined" color="warning" label={testLabel} />}
    </Stack>
  );
}
