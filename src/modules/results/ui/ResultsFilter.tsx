"use client";

import FemaleIcon from "@mui/icons-material/Female";
import GroupsIcon from "@mui/icons-material/Groups";
import MaleIcon from "@mui/icons-material/Male";
import SearchIcon from "@mui/icons-material/Search";
import Box from "@mui/material/Box";
import InputAdornment from "@mui/material/InputAdornment";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { useId, useState } from "react";
import { FILTER_OPTION_SX } from "@/modules/events/ui/filter-chip-sx";
import { SR_ONLY_SX } from "@/shared/ui/sr-only";
import { type CategoryGlyph, rowMatches } from "./results-filter";

/** The chip glyphs by the names the server passes (§370): «Toate» a group, the two sexes their signs. */
const CATEGORY_GLYPH = { all: GroupsIcon, female: FemaleIcon, male: MaleIcon } as const satisfies Record<CategoryGlyph, unknown>;

/**
 * The «Clasament» section's filter: a chip per category present and a box for the race number (§NNN, race results part 2).
 *
 * **Why this is a client island, and the only one.** The table is a Server Component's, drawn whole, so it reads in full with no
 * script and a search engine or a phone on a bad connection gets every row. Narrowing it as someone types is the one thing a
 * server cannot do without a round trip — and the page is a cached, static page (§549), so the filter has no address to carry
 * (no `?categorie=`, which would also make the page a live twin for every tick). The island therefore only **hides** rows
 * (`hidden` on a `<tr>` that carries `data-category` and `data-bib`), never draws or removes one, and takes strings alone
 * (§370): the words, the chips' keys and labels, and the id of the table to narrow.
 *
 * The chips are native radios in the listing's chip shape (`FILTER_OPTION_SX`, §424, §789): the tick is visible, the label is
 * 44 pixels tall, «Toate» first. One category at a time — a runner is in one — so a radio, not a box.
 */
export default function ResultsFilter({
  tableId,
  categories,
  words,
}: {
  /** The `id` of the `<table>` whose rows this narrows; its rows carry `data-bib` and `data-category`. */
  tableId: string;
  /** The categories present, in reading order, each as its stored key and its words. Empty or one: no chips. */
  categories: readonly { key: string; label: string; glyph: CategoryGlyph }[];
  words: { label: string; category: string; all: string; search: string; none: string };
}) {
  const group = useId();
  const [category, setCategory] = useState<string | null>(null);
  const [bib, setBib] = useState("");
  const [visible, setVisible] = useState<number | null>(null);

  /** Hide the rows that do not match and say how many are left (for the «none» line and a screen reader). */
  const apply = (nextCategory: string | null, nextBib: string) => {
    const table = document.getElementById(tableId);
    if (!table) return;
    let shown = 0;
    for (const row of table.querySelectorAll<HTMLElement>("tbody tr[data-bib]")) {
      const matches = rowMatches({ category: row.dataset.category || null, bib: Number(row.dataset.bib) }, { category: nextCategory, bib: nextBib });
      row.hidden = !matches;
      if (matches) shown += 1;
    }
    setVisible(shown);
  };

  return (
    <Box
      data-testid="results-filter"
      role="group"
      aria-label={words.label}
      // Without a script the controls would tick and narrow nothing while every row stays: they are left out then (the house's script-only rows).
      sx={{ mb: 1, "@media (scripting: none)": { display: "none" } }}
    >
      {categories.length > 1 && (
        <Box component="fieldset" sx={{ border: 0, m: 0, mb: 0.5, p: 0, minInlineSize: 0, display: "flex", flexWrap: "wrap", columnGap: 1 }}>
          <Box component="legend" sx={SR_ONLY_SX}>
            {words.category}
          </Box>
          {[{ key: null, label: words.all, glyph: "all" as const }, ...categories].map((option) => {
            const Glyph = CATEGORY_GLYPH[option.glyph];
            return (
              <Box component="label" key={option.key ?? "all"} sx={FILTER_OPTION_SX} data-testid="results-category-chip">
                <span>
                  <input
                    type="radio"
                    name={group}
                    value={option.key ?? ""}
                    checked={category === option.key}
                    onChange={() => {
                      setCategory(option.key);
                      apply(option.key, bib);
                    }}
                  />
                  <Glyph aria-hidden="true" />
                  {option.label}
                </span>
              </Box>
            );
          })}
        </Box>
      )}
      <TextField
        type="search"
        size="small"
        label={words.search}
        value={bib}
        onChange={(event) => {
          setBib(event.target.value);
          apply(category, event.target.value);
        }}
        slotProps={{
          htmlInput: { inputMode: "numeric", pattern: "[0-9]*", enterKeyHint: "search", "data-testid": "results-bib-search" },
          input: {
            startAdornment: (
              <InputAdornment position="start">
                <SearchIcon aria-hidden fontSize="small" />
              </InputAdornment>
            ),
          },
        }}
        // 44 pixels is the native box itself, not only the frame around it (BR-REQ-041-01 criterion 6): the input is what a thumb lands on.
        sx={{ width: "100%", maxWidth: "16rem", mt: 0.5, "& .MuiInputBase-input": { height: 44, boxSizing: "border-box", py: 0 } }}
      />
      {/* Nothing matches: said in words, for the eye and — as a status — for a screen reader. */}
      <Typography role="status" variant="body2" color="text.secondary" data-testid="results-none" sx={{ mt: visible === 0 ? 1 : 0 }}>
        {visible === 0 ? words.none : ""}
      </Typography>
    </Box>
  );
}
