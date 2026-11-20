import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import GlyphButton from "@/shared/ui/GlyphButton";
import { TAP_TARGET } from "@/shared/ui/tap-target";

/**
 * The «Voluntari» card's own numbers form on the event's editor page (§NNN): «Numerele voluntarilor încep de la» and its «Salvează
 * numerele». The hint below links to it; `OpenFoldFromHash` opens the card around it on arrival, or at the press on the same page.
 */
export const VOLUNTEER_NUMBERS_ANCHOR = "box-volunteer-numbers";

/**
 * Why the volunteers are out of the raffle, said where it is seen (§NNN; the owner, 2026-11-20: «vreau să le dau automat numere și
 * voluntarilor, pentru că văd că deși voluntarii sunt bifați aici… cumva sunt excluși de pe lista de la tombolă»). A volunteer takes
 * part only with a number (§984's `noNumber`), and the numbers are the volunteers' own series (§948): set its start once and every
 * confirmed volunteer gets one at once, every later one at their confirmation. So, while the raffle counts the volunteers and some
 * confirmed ones wear no number, one line says how many and how — under the editor's «Voluntarii» tick and on «Ziua cursei» →
 * «Tombolă» beside «Voluntari: N» — with the way to that form. Nothing chooses a number by itself: the series' start is the club's,
 * above the runners' numbers.
 *
 * A Server Component of plain props: the caller says the sentence in its own language (`countForm`'s three keys), the link's words and
 * where it goes — `#box-volunteer-numbers` on the editor itself, the editor's address with it from the tab. An outlined warning, its
 * contrast the theme's in both schemes; the link a glyph button of a thumb's 44 pixels. A `note`, not MUI's default `alert`: standing
 * advice drawn with the page, which a screen reader should not announce as news on every arrival.
 */
export default function RaffleNumberHint({ text, linkLabel, href, testId }: { text: string; linkLabel: string; href: string; testId: string }) {
  return (
    <Alert severity="warning" variant="outlined" role="note" data-testid={testId} sx={{ py: 0, overflowWrap: "anywhere" }}>
      {text}
      <Box sx={{ mt: 0.5 }}>
        <GlyphButton icon="volunteers" href={href} variant="text" size="small" color="inherit" sx={TAP_TARGET} data-testid={`${testId}-link`}>
          {linkLabel}
        </GlyphButton>
      </Box>
    </Alert>
  );
}
