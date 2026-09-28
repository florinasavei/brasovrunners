"use client";

import FilterAltIcon from "@mui/icons-material/FilterAlt";
import SearchIcon from "@mui/icons-material/Search";
import SortIcon from "@mui/icons-material/Sort";
import InputAdornment from "@mui/material/InputAdornment";
import TextField from "@mui/material/TextField";
import type { ComponentType } from "react";

type Option = { value: string; label: string };

const GLYPH_SX = { fontSize: 20, color: "text.secondary" } as const;

/** The glyph before a field's words (the owner, 2026-09-27: a glyph on every control). */
function startGlyph(Glyph: ComponentType<{ "aria-hidden"?: "true"; sx?: object }>) {
  return (
    <InputAdornment position="start">
      <Glyph aria-hidden="true" sx={GLYPH_SX} />
    </InputAdornment>
  );
}

/**
 * The backoffice events list's three controls (§527) — the search, the state and the order — as
 * one row inside the page's GET form. A client component only because each field wears its glyph
 * as an adornment, and an icon element may not be handed across the server/client boundary
 * (§370); every prop here is a string. What posts is plain: a search box and two **native**
 * selects, drawn on the server, so the form works before hydration and with JavaScript off.
 */
export default function EventListFields({
  search,
  state,
  sort,
}: {
  search: { label: string; placeholder: string; value: string; maxLength: number };
  state: { label: string; value: string; options: readonly Option[] };
  sort: { label: string; value: string; options: readonly Option[] };
}) {
  const select = (field: { label: string; value: string; options: readonly Option[] }, name: string, glyph: ReturnType<typeof startGlyph>) => (
    <TextField
      select
      size="small"
      name={name}
      id={`events-list-${name}`}
      label={field.label}
      defaultValue={field.value}
      slotProps={{ select: { native: true }, inputLabel: { shrink: true }, input: { startAdornment: glyph } }}
      sx={{ minWidth: 190, flex: "1 1 190px", maxWidth: { sm: 260 } }}
    >
      {field.options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </TextField>
  );

  return (
    <>
      <TextField
        size="small"
        name="q"
        id="events-list-q"
        type="search"
        label={search.label}
        placeholder={search.placeholder}
        defaultValue={search.value}
        autoComplete="off"
        slotProps={{ htmlInput: { maxLength: search.maxLength }, inputLabel: { shrink: true }, input: { startAdornment: startGlyph(SearchIcon) } }}
        sx={{ minWidth: 220, flex: "2 1 240px" }}
      />
      {select(state, "state", startGlyph(FilterAltIcon))}
      {select(sort, "sort", startGlyph(SortIcon))}
    </>
  );
}
