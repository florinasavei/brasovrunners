import { getTranslations } from "next-intl/server";
import { type CoHostSource, readCoHosts } from "../domain/co-hosts";
import { partnerPhrase } from "./counted-phrases";
import GlyphChip from "./GlyphChip";

/**
 * A pill that wraps rather than ending in MUI's ellipsis, like the event page's pills (§356),
 * kept even now the marker reads "Colaborare" / "Partnership" (§379 — shorter than §375's longer
 * label, which was a full word wider than some 320-pixel cards leave it) — a card narrower
 * still, or a phone's own font-size setting, is still safer wrapped than clipped. Unaffected by
 * the glyph reverting from the emoji back to Material's `Handshake` icon (§391): the chip's own
 * width comes from the label, not the glyph. A plain object in module scope, because it crosses
 * to `GlyphChip`.
 */
const PARTNER_CHIP_SX = {
  height: "auto",
  minHeight: 24,
  maxWidth: "100%",
  "& .MuiChip-label": { whiteSpace: "normal", overflowWrap: "anywhere", py: 0.25 },
} as const;

/**
 * The partner marker on a listing card (§367, amended §375 — the owner, 2026-09-24: "For the
 * partnership, I just need 1 icon, I do not need to show the full partners list, there might be
 * multiple partners"), and again (§379 — "the chip is too long, just say 'colaborare' in the
 * Romanian one"), and again (§391 — the owner, 2026-09-25: "wow shit handshake icon is super
 * ugly! Use the MUI icon ASAP", of the emoji §379/§386 put here, filtered gray until it read as
 * a smudge): one small outlined chip in the card's chips row, Material's own `Handshake` icon in
 * the chip's own ink and a generic "Colaborare" — the size and the colour of the surface chip
 * beside it, so it reads as one more fact about the event rather than a badge that competes with
 * "Ediție specială".
 *
 * It never names a partner: there may be several, and the chip is a marker, not a list — the whole
 * list is the event page's partner cards (§344). Nothing for an event with no partner. The words
 * are `partnerPhrase`'s; the glyph crosses to `GlyphChip` by its name (§112).
 */
export default async function PartnerChip({ event }: { event: CoHostSource }) {
  const t = await getTranslations("Event");
  const label = partnerPhrase(t, readCoHosts(event).length > 0);
  if (!label) return null;
  return <GlyphChip glyph="partner" variant="outlined" label={label} sx={PARTNER_CHIP_SX} />;
}
