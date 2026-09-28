"use client";

import Box from "@mui/material/Box";
import TextField from "@mui/material/TextField";
import { useState } from "react";

/**
 * The club's own line in the bib's footer, with a live "87/120" count (§317). `maxLength` is the
 * limit in the browser; the schema trims and cuts again on the server, so the count is a courtesy.
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
