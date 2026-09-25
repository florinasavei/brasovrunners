import { getTranslations } from "next-intl/server";
import { type CoHostSource, readCoHosts } from "../domain/co-hosts";
import { partnerPhrase } from "./counted-phrases";
import GlyphChip from "./GlyphChip";

/**
 * A pill that wraps rather than ending in MUI's ellipsis, like the event page's pills (§356):
 * the generic "Eveniment în parteneriat" marker (§367) is still a full word wider than some
 * 320-pixel cards leave it. A plain object in module scope, because it crosses to `GlyphChip`.
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
 * multiple partners"): one small outlined chip in the card's chips row, the handshake and a
 * generic "Eveniment în parteneriat" — the size and the colour of the surface chip beside it, so
 * it reads as one more fact about the event rather than a badge that competes with "Ediție
 * specială".
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
