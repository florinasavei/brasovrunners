"use client";

import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import { useRouter } from "next/navigation";
import { DENSITY } from "@/theme/density";
import type { YearMonth } from "../domain/calendar";
import { calendarAddress, type CalendarLayoutName, type CalendarPeriod } from "../domain/calendar-path";

/*
  On a phone the two selects share one row with ‹ Azi › (§487): they take what the row leaves
  and may shrink below their words' width rather than wrap the row, in a smaller type with a
  narrower caret gutter; the height stays the 44-pixel target (BR-REQ-041-01 criterion 6). The
  year, four digits, has a fixed narrow width and the month takes the rest, so its name stays
  whole at 320 pixels. From `sm` nothing changes: every key names its `sm` value, because an
  xs-only object is a `min-width: 0px` rule that would reach the desktop too — `inherit` is the
  input's own type size, 14px / 32px MUI's small outlined select padding.
*/
export const PHONE_SELECT_SX = {
  fontSize: { xs: "0.8125rem", sm: "inherit" },
  pl: { xs: 1, sm: "14px" },
  pr: { xs: "24px !important", sm: "32px !important" },
} as const;

/**
 * "Select per month, or per year" (`DECISIONS.md` §116): two native selects that go straight
 * to the chosen month or year. A client island for the one thing a select cannot do on its
 * own — navigate on change without a "Go" button. The addresses are built here from a base
 * path the server resolved and the query it keeps (the type filter), never from a hostname.
 *
 * In the year view the month select is not shown: the year is the whole question there.
 *
 * `useRouter().push` rather than `location.assign`: a soft navigation, so the header, the
 * hero and these two selects stay exactly where they are and only the calendar's body is
 * replaced, instead of the browser throwing the document away and painting white. The
 * comment that stood here since §116 promised "the listing's `loading.tsx`" instead. There
 * has never been one, and §167 records why there still is not.
 */
export default function CalendarPicker({
  basePath,
  query,
  view,
  layout = "grid",
  thisMonth,
  year,
  month,
  years,
  monthNames,
  labels,
}: {
  /** The calendar's own localized path, such as `/ro/calendar`. */
  basePath: string;
  /** The other query parameters the address keeps — the filters (a group ticked twice is an array, §413). */
  query: Record<string, string | string[]>;
  view: "month" | "year";
  /** The month's layout, kept by a change of month (§137). */
  layout?: CalendarLayoutName;
  /** This month in Brașov, as the server read it: the one month whose grid is the bare calendar. */
  thisMonth: YearMonth;
  year: number;
  /** 1–12. */
  month: number;
  years: number[];
  /** Twelve, in the reader's language, January first. */
  monthNames: string[];
  labels: { month: string; year: string };
}) {
  const router = useRouter();
  // The period is the path's (§NNN): the same address the arrows build, from the same function.
  const go = (next: { year: number; month: number }) => {
    const period: CalendarPeriod = view === "year" ? { kind: "year", year: next.year } : { kind: "month", month: next };
    router.push(`${calendarAddress(basePath, { view: period, layout, query, thisMonth })}#calendar`);
  };

  const select = { select: { native: true }, inputLabel: { shrink: true } } as const;

  return (
    <Stack direction="row" spacing={{ xs: DENSITY.gapXs, sm: 1 }} sx={{ alignItems: "center", flex: { xs: "1 1 auto", sm: "0 0 auto" }, minWidth: 0 }}>
      {view === "month" && (
        <TextField
          select
          size="small"
          label={labels.month}
          value={month}
          onChange={(event) => go({ year, month: Number(event.target.value) })}
          slotProps={select}
          sx={{ flex: { xs: "1 1 0", sm: "0 0 auto" }, minWidth: { xs: 0, sm: 118 }, "& select": { ...PHONE_SELECT_SX, minHeight: { xs: 44, sm: 34 }, py: { sm: 0.5 }, boxSizing: "border-box", textTransform: "capitalize" } }}
        >
          {monthNames.map((name, index) => (
            <option key={name} value={index + 1}>
              {name}
            </option>
          ))}
        </TextField>
      )}
      <TextField
        select
        size="small"
        label={labels.year}
        value={year}
        onChange={(event) => go({ year: Number(event.target.value), month })}
        slotProps={select}
        sx={{ flex: { xs: "0 0 66px", sm: "0 0 auto" }, minWidth: { xs: 0, sm: 88 }, "& select": { ...PHONE_SELECT_SX, minHeight: { xs: 44, sm: 34 }, py: { sm: 0.5 }, boxSizing: "border-box" } }}
      >
        {years.map((candidate) => (
          <option key={candidate} value={candidate}>
            {candidate}
          </option>
        ))}
      </TextField>
    </Stack>
  );
}
