import Box from "@mui/material/Box";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import type { ReactNode } from "react";

/**
 * The design-system page's sections (§NNN), in the page's order: each an anchor the contents row
 * points at and a heading, so a colleague lands on «Butoane» rather than scrolling for it. The ids
 * are the page's contract — the test asserts every one is on the page.
 */
export const DESIGN_SECTION_IDS = ["colours", "type", "shape", "buttons", "pills", "samples", "icons", "rules", "plan"] as const;
export type DesignSectionId = (typeof DESIGN_SECTION_IDS)[number];

/** A section: its anchor, its heading at the backoffice's size, one sentence under it, then its blocks. */
export default function DesignSection({ id, title, intro, children }: { id: DesignSectionId; title: string; intro?: string; children: ReactNode }) {
  return (
    <Box component="section" id={id} aria-labelledby={`${id}-title`} sx={{ scrollMarginTop: 16 }}>
      <Typography variant="h3" id={`${id}-title`} sx={{ fontSize: "1.125rem", fontWeight: 600, mb: intro ? 0.5 : 2 }}>
        {title}
      </Typography>
      {intro && (
        <Typography color="text.secondary" sx={{ mb: 2 }}>
          {intro}
        </Typography>
      )}
      <Stack spacing={3}>{children}</Stack>
    </Box>
  );
}

/** A block inside a section: a small heading, an optional note, and what it draws. */
export function Block({ title, note, children }: { title: string; note?: string; children: ReactNode }) {
  return (
    <Box>
      <Typography variant="h4" sx={{ fontSize: "0.9375rem", fontWeight: 600, mb: note ? 0.25 : 1 }}>
        {title}
      </Typography>
      {note && (
        <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
          {note}
        </Typography>
      )}
      {children}
    </Box>
  );
}

/** A token's name or a path, as the code writes it. */
export function Code({ children }: { children: ReactNode }) {
  return (
    <Box component="code" sx={{ fontFamily: "ui-monospace, Consolas, monospace", fontSize: "0.8125rem", bgcolor: "action.hover", px: 0.5, borderRadius: 0.5, overflowWrap: "anywhere" }}>
      {children}
    </Box>
  );
}

/** A grid of small cells that fills the width: swatches, glyphs. */
export const CELL_GRID_SX = { display: "grid", gap: 1.5, gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))" } as const;

/** A wrapping row of things drawn side by side: buttons, chips. */
export const ROW_SX = { display: "flex", flexWrap: "wrap", alignItems: "center", gap: 1.5 } as const;

/** The square a colour is shown as: 40 pixels, bordered so a near-white reads on the paper. */
export const SWATCH_PX = 40;
