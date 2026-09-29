import Box from "@mui/material/Box";
import type { PublicListGroup } from "@/modules/registrations/domain/public-list-states";
import QuietHelp from "@/shared/ui/QuietHelp";

/**
 * Where a registration stands, beside a name on the public list (`DECISIONS.md` §396): "Confirmat",
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
 *
 * `help` is the word's sentence from the legend under the list (`list-state-legend.ts`), said again
 * by the platform's one «?» (`QuietHelp`, a string handed to a client island, §370) — the owner,
 * 2026-09-29: «trebuie să explic ce înseamnă „în așteptarea confirmării”».
 */
export default function ListStateLabel({ group, label, help }: { group: PublicListGroup; label: string; help?: string }) {
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
      {help ? <QuietHelp text={help} size={14} testId="start-list-state-help" /> : null}
    </Box>
  );
}
