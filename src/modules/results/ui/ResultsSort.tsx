"use client";

import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import { useId, useState } from "react";
import { FILTER_OPTION_SX } from "@/modules/events/ui/filter-chip-sx";

/**
 * «Ordonează» (§1034 — the owner, race day 2026-11-21: «Pălici trebuie să fie primul după pace average, dar nu sortat implicit»): two radios
 * over one results table, «după timp» first and chosen, «după ritm mediu» the other. It only moves the `<tr>`s the server drew — by their
 * `data-pace` (seconds per kilometre; a row without one goes last, in its first order) or back to `data-order` — and never draws or
 * removes one. Without a script the table stays as the server ordered it, by time.
 */
export default function ResultsSort({ tableId, words }: { tableId: string; words: { label: string; time: string; pace: string } }) {
  const name = useId();
  const [by, setBy] = useState<"time" | "pace">("time");

  const sort = (next: "time" | "pace") => {
    setBy(next);
    const body = document.getElementById(tableId)?.querySelector("tbody");
    if (!body) return;
    const rows = [...body.querySelectorAll<HTMLTableRowElement>("tr[data-order]")];
    const pace = (row: HTMLTableRowElement) => (row.dataset.pace ? Number(row.dataset.pace) : Number.POSITIVE_INFINITY);
    const order = (row: HTMLTableRowElement) => Number(row.dataset.order);
    rows.sort((a, b) => (next === "pace" ? pace(a) - pace(b) || order(a) - order(b) : order(a) - order(b)));
    for (const row of rows) body.appendChild(row);
  };

  return (
    <Box component="fieldset" data-testid="results-sort" sx={{ border: 0, p: 0, m: 0, mb: 1.5, display: "flex", flexWrap: "wrap", alignItems: "center", gap: 1 }}>
      <Typography component="legend" variant="body2" sx={{ float: "left", mr: 1, fontWeight: 600 }}>
        {words.label}
      </Typography>
      {(["time", "pace"] as const).map((option) => (
        <Box component="label" key={option} data-testid="results-sort-option" sx={FILTER_OPTION_SX}>
          <input type="radio" name={name} value={option} checked={by === option} onChange={() => sort(option)} />
          {option === "time" ? words.time : words.pace}
        </Box>
      ))}
    </Box>
  );
}
