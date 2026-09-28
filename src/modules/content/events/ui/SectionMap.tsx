"use client";

import WarningAmberIcon from "@mui/icons-material/WarningAmber";
import Box from "@mui/material/Box";
import type { PageSectionGlyph, PageSectionId } from "@/modules/events/domain/page-sections";
import { openFoldsAround } from "@/shared/ui/fold";
import { useCardMissing } from "./PublishCheck";
import type { PublishGapBox } from "./publish-check";
import { SECTION_GLYPHS } from "./section-glyphs";

/** One chip of the map, as the server hands it: strings, numbers and names only. */
export type SectionMapEntry = {
  id: PageSectionId;
  /** The card's number, or null for an automatic section. */
  number: number | null;
  name: string;
  glyph: PageSectionGlyph;
  /** Whether the page draws it, as saved. */
  drawn: boolean;
  /** The card's id (`box-title`), or null for an automatic section, which has no card. */
  card: string | null;
  /** The publication gaps that belong to its card, when it holds a box publication needs. */
  gapBox: PublishGapBox | null;
};

export type SectionMapWords = {
  /** "apare pe pagină". */
  drawn: string;
  /** "gol, nu apare pe pagină". */
  empty: string;
  /** "automat, fără card". */
  automatic: string;
  /** "lipsesc câmpuri obligatorii". */
  missing: string;
};

/**
 * The event page as a row of chips, top to bottom (§406): number, glyph, name and a dot (filled
 * while the page draws it). Each chip is a 44-px link to its card's `#box-…` and opens the fold
 * at once, since a second press on the same hash fires nothing (§336). Automatic sections have no
 * number and nothing to open; a card with a publication gap wears the warning glyph.
 */
export default function SectionMap({ entries, words, label }: { entries: readonly SectionMapEntry[]; words: SectionMapWords; label: string }) {
  return (
    <Box component="nav" aria-label={label} data-testid="section-map">
      <Box component="ol" sx={{ listStyle: "none", m: 0, p: 0, display: "flex", flexWrap: "wrap", gap: 0.75 }}>
        {entries.map((entry) => (
          <Box component="li" key={entry.id} sx={{ minWidth: 0, maxWidth: "100%" }}>
            <SectionChip entry={entry} words={words} />
          </Box>
        ))}
      </Box>
    </Box>
  );
}

function SectionChip({ entry, words }: { entry: SectionMapEntry; words: SectionMapWords }) {
  const missing = useCardMissing(entry.gapBox);
  const Glyph = SECTION_GLYPHS[entry.glyph];
  const state = entry.card === null ? words.automatic : entry.drawn ? words.drawn : words.empty;
  const name = entry.number === null ? entry.name : `${entry.number} · ${entry.name}`;
  const described = [`${name} — ${state}`, missing ? words.missing : null].filter(Boolean).join(" · ");
  const chipSx = {
    display: "inline-flex",
    alignItems: "center",
    gap: 0.5,
    boxSizing: "border-box",
    minHeight: 44,
    maxWidth: "100%",
    px: 1.25,
    border: 1,
    borderColor: missing ? "warning.main" : "divider",
    borderStyle: entry.card === null ? "dashed" : "solid",
    borderRadius: 999,
    color: entry.drawn ? "text.primary" : "text.secondary",
    bgcolor: "background.paper",
    typography: "body2",
    textDecoration: "none",
  } as const;
  const body = (
    <>
      {entry.number !== null && (
        <Box component="span" aria-hidden sx={{ fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>
          {entry.number}
        </Box>
      )}
      <Glyph aria-hidden fontSize="small" sx={{ color: "text.secondary" }} />
      <Box component="span" aria-hidden sx={{ overflowWrap: "anywhere" }}>
        {entry.name}
      </Box>
      {missing && <WarningAmberIcon aria-hidden fontSize="small" sx={{ color: "warning.main" }} data-testid="section-map-missing" />}
      {/* Filled while the page draws the section, a ring while it does not; the words are the label's. */}
      <Box
        component="span"
        aria-hidden
        data-drawn={entry.drawn ? "true" : "false"}
        sx={{
          width: 10,
          height: 10,
          flexShrink: 0,
          borderRadius: "50%",
          border: 2,
          borderColor: entry.drawn ? "success.main" : "text.disabled",
          bgcolor: entry.drawn ? "success.main" : "transparent",
        }}
      />
    </>
  );

  if (entry.card === null) {
    return (
      <Box component="span" aria-label={described} role="img" data-section={entry.id} sx={chipSx}>
        {body}
      </Box>
    );
  }
  const card = entry.card;
  return (
    <Box
      component="a"
      href={`#${card}`}
      aria-label={described}
      data-section={entry.id}
      onClick={() => openFoldsAround(document.getElementById(card))}
      sx={{ ...chipSx, "&:hover": { borderColor: "primary.main" }, "&:focus-visible": { outline: 2, outlineColor: "primary.main", outlineOffset: 2 } }}
    >
      {body}
    </Box>
  );
}
