"use client";

import Box from "@mui/material/Box";
import MenuItem from "@mui/material/MenuItem";
import TextField from "@mui/material/TextField";
import { GLYPHS, type GlyphName } from "@/modules/events/ui/glyphs";
import { useRecall } from "@/shared/forms/recall";

export type GlyphOption = { value: string; label: string; glyph?: GlyphName };

/**
 * A select whose options wear the public pages' glyphs (§112, §121). Client so the icon is made
 * here from a name, never passed as an element. The hidden input keeps `name` for `OnlyForType`'s
 * observer and the action. Re-mounts from the posted choice after a refused submit (§315).
 */
export default function GlyphSelect({
  name,
  label,
  helperText,
  defaultValue,
  options,
  required,
  sx,
}: {
  name: string;
  label: string;
  helperText?: string;
  defaultValue: string;
  /** The first may be the "not stated" option with no glyph. */
  options: readonly GlyphOption[];
  required?: boolean;
  sx?: Record<string, unknown>;
}) {
  const recall = useRecall();
  const named = recall.named(name);

  const withGlyph = (option: GlyphOption) => {
    const Icon = option.glyph ? GLYPHS[option.glyph] : null;
    return (
      <Box component="span" sx={{ display: "inline-flex", alignItems: "center", gap: 1 }}>
        {Icon && <Icon aria-hidden="true" sx={{ fontSize: 18, color: "text.secondary" }} />}
        {option.label}
      </Box>
    );
  };

  return (
    <TextField
      key={recall.generation}
      select
      id={recall.idOf(name)}
      name={name}
      label={label}
      helperText={named && recall.fieldError ? recall.fieldError : helperText}
      error={named}
      defaultValue={recall.value(name) ?? defaultValue}
      required={required}
      sx={sx}
      slotProps={{
        select: {
          // The chosen option shows its glyph in the closed field too.
          renderValue: (value) => {
            const option = options.find((candidate) => candidate.value === value);
            return option ? withGlyph(option) : "";
          },
          displayEmpty: true,
        },
        inputLabel: { shrink: true },
      }}
    >
      {options.map((option) => (
        <MenuItem key={option.value} value={option.value}>
          {withGlyph(option)}
        </MenuItem>
      ))}
    </TextField>
  );
}
