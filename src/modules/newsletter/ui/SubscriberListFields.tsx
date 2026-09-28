"use client";

import FilterAltIcon from "@mui/icons-material/FilterAlt";
import SearchIcon from "@mui/icons-material/Search";
import TopicIcon from "@mui/icons-material/Topic";
import InputAdornment from "@mui/material/InputAdornment";
import TextField from "@mui/material/TextField";
import type { ComponentType } from "react";

type Option = { value: string; label: string };

const GLYPH_SX = { fontSize: 20, color: "text.secondary" } as const;

function startGlyph(Glyph: ComponentType<{ "aria-hidden"?: "true"; sx?: object }>) {
  return (
    <InputAdornment position="start">
      <Glyph aria-hidden="true" sx={GLYPH_SX} />
    </InputAdornment>
  );
}

/**
 * The «Abonați» list's three controls (§550) — the address, the topic, the state — inside the
 * card's GET form, as the events list's are (§527, `EventListFields`): a client component only
 * because each field wears its glyph as an adornment, and an icon element may not cross the
 * server/client boundary (§370). A search box and two **native** selects, drawn on the server, so
 * the form works before hydration and with JavaScript off; every prop is a string.
 */
export default function SubscriberListFields({
  search,
  topic,
  state,
}: {
  search: { label: string; placeholder: string; value: string; maxLength: number };
  topic: { label: string; value: string; options: readonly Option[] };
  state: { label: string; value: string; options: readonly Option[] };
}) {
  const select = (field: { label: string; value: string; options: readonly Option[] }, name: string, glyph: ReturnType<typeof startGlyph>) => (
    <TextField
      select
      size="small"
      name={name}
      id={`newsletter-subscribers-${name}`}
      label={field.label}
      defaultValue={field.value}
      slotProps={{ select: { native: true }, inputLabel: { shrink: true }, input: { startAdornment: glyph } }}
      sx={{ minWidth: 190, flex: "1 1 190px", maxWidth: { sm: 280 } }}
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
        id="newsletter-subscribers-q"
        type="search"
        label={search.label}
        placeholder={search.placeholder}
        defaultValue={search.value}
        autoComplete="off"
        slotProps={{ htmlInput: { maxLength: search.maxLength }, inputLabel: { shrink: true }, input: { startAdornment: startGlyph(SearchIcon) } }}
        sx={{ minWidth: 220, flex: "2 1 240px" }}
      />
      {select(topic, "topic", startGlyph(TopicIcon))}
      {select(state, "state", startGlyph(FilterAltIcon))}
    </>
  );
}
