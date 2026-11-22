"use client";

import Box from "@mui/material/Box";
import Checkbox from "@mui/material/Checkbox";
import FormControlLabel from "@mui/material/FormControlLabel";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { useState } from "react";
import GlyphButton from "@/shared/ui/GlyphButton";
import { CHECKBOX_TAP_TARGET } from "@/shared/ui/tap-target";

/** One download under a tile: its address, its button's word, and the whole name a screen reader hears. */
export type LogoDownload = { format: "svg" | "png" | "pdf"; href: string; text: string; label: string };

/** What a tile shows on one ground: its name, the picture, the colour behind the picture (null: the checkerboard), the files. */
export type LogoTileFace = { name: string; preview: string; ground: string | null; downloads: LogoDownload[] };

/** A download's glyph: the PDF's own for a PDF, the arrow for a file to save. */
const FORMAT_ICON = { svg: "download", png: "download", pdf: "pdf" } as const;

/** A link a thumb must hit (BR-REQ-041-01 criterion 6). */
const TARGET_SX = { minHeight: 44, minWidth: 44 } as const;

/**
 * Transparency as drawing programs show it: a checkerboard, here in two middle greys so the white logo stands out on it
 * (a light board, the usual one, would hide it).
 */
const CHECKERBOARD_SX = {
  backgroundColor: "#8f8f8f",
  backgroundImage: "repeating-conic-gradient(#a6a6a6 0% 25%, transparent 0% 50%)",
  backgroundSize: "20px 20px",
} as const;

/**
 * One logo tile of «PR Kit» (§1015): the picture, its name, and an SVG, a PNG and a PDF of it. The white one carries a tick
 * (§1046; the owner, 2026-11-22, of the white tile drawn on the club's colour: «nu știam de ce are fundal albastru, trebe să fie
 * ceva bifă pt fundal, e confusing») — unticked, the picture lies on a checkerboard and the three files are transparent;
 * ticked, the picture and the three files are on the club's colour. What the tile shows is what it hands out.
 *
 * A client island for that tick alone; every word and address comes from the Server Component, which asserts who may see the
 * page (the routes assert it again).
 */
export default function LogoTile({
  shape,
  ink,
  face,
  onPrimary,
  startOnPrimary = false,
}: {
  shape: string;
  ink: string;
  face: LogoTileFace;
  /** The same tile on the club's colour, and the tick's words: the white ink only. */
  onPrimary?: { face: LogoTileFace; tick: string };
  /** The tick's state on arrival: unticked on the page; a test draws the ticked tile with it. */
  startOnPrimary?: boolean;
}) {
  const [ticked, setTicked] = useState(startOnPrimary && onPrimary !== undefined);
  const shown = ticked && onPrimary ? onPrimary.face : face;
  return (
    <Box data-testid="pr-kit-logo-tile" data-shape={shape} data-ink={ink} data-ground={ticked ? "primary" : "none"} sx={{ minWidth: 0 }}>
      <Box
        sx={{
          ...(shown.ground === null ? CHECKERBOARD_SX : { bgcolor: shown.ground }),
          border: 1,
          borderColor: "divider",
          borderRadius: 1,
          p: 2,
          aspectRatio: "5 / 2",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <Box component="img" src={shown.preview} alt={shown.name} sx={{ display: "block", width: "100%", height: "100%", objectFit: "contain" }} />
      </Box>
      <Typography variant="body2" sx={{ mt: 1, fontWeight: 500 }}>
        {shown.name}
      </Typography>
      {onPrimary && (
        <FormControlLabel
          sx={{ mt: 0.25 }}
          control={
            <Checkbox
              checked={ticked}
              onChange={(event) => setTicked(event.target.checked)}
              sx={CHECKBOX_TAP_TARGET}
              slotProps={{ input: { "data-testid": "pr-kit-logo-ground" } as Record<string, string> }}
            />
          }
          label={<Typography variant="body2">{onPrimary.tick}</Typography>}
        />
      )}
      <Stack direction="row" sx={{ mt: 0.5, flexWrap: "wrap", gap: 1 }}>
        {shown.downloads.map((download) => (
          <GlyphButton
            key={download.format}
            icon={FORMAT_ICON[download.format]}
            href={download.href}
            variant="outlined"
            size="small"
            sx={TARGET_SX}
            aria-label={download.label}
            data-testid={`pr-kit-logo-${download.format}`}
          >
            {download.text}
          </GlyphButton>
        ))}
      </Stack>
    </Box>
  );
}
