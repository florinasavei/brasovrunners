"use client";

import Box from "@mui/material/Box";
import TextField from "@mui/material/TextField";
import { useState } from "react";

/**
 * The club's own line in the bib's footer, with a count of what is left (§NNN).
 *
 * A text box the form posts like any other — `name` is the panel's, the save reads it with the
 * rest of the design — and the one thing a Server Component cannot do for it: say "87/120" as
 * the club types. The browser's `maxLength` is the limit; the schema trims and cuts again on the
 * server, so the count is a courtesy and never the rule. The helper sentence under it is the
 * club's reminder that a bib is worn in public, and it stays visible while the count changes.
 *
 * Strings only across the boundary: the Server Component translates, this counts.
 */
export default function BibFooterTextField({
  name,
  defaultValue,
  maxLength,
  label,
  placeholder,
  help,
}: {
  name: string;
  defaultValue: string;
  maxLength: number;
  label: string;
  placeholder: string;
  help: string;
}) {
  const [length, setLength] = useState(defaultValue.length);
  return (
    <TextField
      name={name}
      label={label}
      defaultValue={defaultValue}
      placeholder={placeholder}
      fullWidth
      onChange={(event) => setLength(event.target.value.length)}
      slotProps={{ htmlInput: { maxLength, autoComplete: "off" }, inputLabel: { shrink: true } }}
      helperText={
        <Box component="span" sx={{ display: "flex", justifyContent: "space-between", gap: 1 }}>
          <span>{help}</span>
          <Box component="span" sx={{ flexShrink: 0, fontVariantNumeric: "tabular-nums" }} data-testid="bib-footer-text-count">
            {length}/{maxLength}
          </Box>
        </Box>
      }
    />
  );
}
