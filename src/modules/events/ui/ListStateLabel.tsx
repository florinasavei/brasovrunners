import Box from "@mui/material/Box";
import type { PublicListGroup } from "@/modules/registrations/domain/public-list-states";

/**
 * Where a registration stands, beside a name on the public list (`DECISIONS.md` §NNN): "Confirmat",
 * "Înscris, în așteptarea confirmării", "Pe lista de așteptare". One component for the three, so
 * they read as one kind of thing — a muted word, not a badge competing with the name.
 *
 * Under the name on a phone, where a 320-pixel cell has no room beside a long name for "Înscris,
 * în așteptarea confirmării"; after it, on the same line, from `sm` up. Plain text inside the
 * name's own cell, so a screen reader reads "Ana Popescu Pe lista de așteptare" as one cell, and
 * the table keeps its three columns (§250).
 *
 * Server-rendered, with no JavaScript: the word is given, never looked up here — the caller has
 * the page's translator.
 */
export default function ListStateLabel({ group, label }: { group: PublicListGroup; label: string }) {
  return (
    <Box
      component="span"
      data-testid="start-list-state"
      data-state={group}
      sx={{
        display: { xs: "block", sm: "inline" },
        // No margin on a phone, where the word has its own line.
        ml: { sm: 1 },
        fontSize: "0.8125rem",
        color: "text.secondary",
        // A confirmed runner's word is the quiet default; the two that say "not yet" are the ones
        // a reader looks for, so they are set apart by style as well as by words.
        fontStyle: group === "CONFIRMED" ? "normal" : "italic",
      }}
    >
      {label}
    </Box>
  );
}
