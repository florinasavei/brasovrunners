import Box from "@mui/material/Box";
import { onlyUnderLook } from "@/theme/look";
import MountainMark from "./MountainMark";

/**
 * The watermark of «Aspectul nou» (§708; phase 1 of `docs/REDESIGN.md`): the mountain mark, faint
 * and centred, between a public page's content and the footer — the shell's one decoration, where
 * every page ends.
 *
 * The locale layout renders it only while the setting is on, and it is drawn only inside the new
 * look's scope (`onlyUnderLook`), so a backoffice page — inside the same layout — never shows it.
 * Decoration: hidden from assistive technology, no tap target, no text. The colour is the hot pink
 * (`primary.light` under the look, `brand.ts`'s `accent`) at a fifth of its strength, so it reads as
 * a mark on the page and never as something to read.
 */
export default function LookWatermark() {
  return (
    <Box aria-hidden="true" data-testid="look-watermark" sx={{ ...onlyUnderLook("flex"), justifyContent: "center", pt: 4, pb: 2, color: "primary.light", opacity: 0.2 }}>
      <MountainMark width={96} />
    </Box>
  );
}
