"use client";

import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import { useRouter } from "next/navigation";

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
  year,
  month,
  years,
  monthNames,
  labels,
}: {
  /** The listing's own localized path, such as `/ro/evenimente`. */
  basePath: string;
  /** The other query parameters the address keeps — the filters (a group ticked twice is an array, §413). */
  query: Record<string, string | string[]>;
  view: "month" | "year";
  year: number;
  /** 1–12. */
  month: number;
  years: number[];
  /** Twelve, in the reader's language, January first. */
  monthNames: string[];
  labels: { month: string; year: string };
}) {
  const router = useRouter();
  const go = (next: { year: number; month: number }) => {
    const params = new URLSearchParams();
    for (const [name, value] of Object.entries(query)) for (const one of Array.isArray(value) ? value : [value]) params.append(name, one);
    if (view === "year") params.set("year", String(next.year));
    else params.set("month", `${next.year}-${String(next.month).padStart(2, "0")}`);
    router.push(`${basePath}?${params.toString()}#calendar`);
  };

  const select = { select: { native: true }, inputLabel: { shrink: true } } as const;

  return (
    <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
      {view === "month" && (
        <TextField
          select
          size="small"
          label={labels.month}
          value={month}
          onChange={(event) => go({ year, month: Number(event.target.value) })}
          slotProps={select}
          sx={{ minWidth: { xs: 130, sm: 118 }, "& select": { minHeight: { xs: 44, sm: 34 }, py: { sm: 0.5 }, boxSizing: "border-box", textTransform: "capitalize" } }}
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
        sx={{ minWidth: { xs: 100, sm: 88 }, "& select": { minHeight: { xs: 44, sm: 34 }, py: { sm: 0.5 }, boxSizing: "border-box" } }}
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
