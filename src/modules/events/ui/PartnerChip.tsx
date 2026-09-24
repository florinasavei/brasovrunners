import { getLocale, getTranslations } from "next-intl/server";
import { type CoHostSource, readCoHosts } from "../domain/co-hosts";
import { partnerPhrase } from "./counted-phrases";
import GlyphChip from "./GlyphChip";

/**
 * A pill that wraps rather than ending in MUI's ellipsis, like the event page's pills (§356): a
 * partner's name is what the chip is for, and "În parteneriat cu Brașov Running Festival" is wider
 * than a 320-pixel card. A plain object in module scope, because it crosses to `GlyphChip`.
 */
const PARTNER_CHIP_SX = {
  height: "auto",
  minHeight: 24,
  maxWidth: "100%",
  "& .MuiChip-label": { whiteSpace: "normal", overflowWrap: "anywhere", py: 0.25 },
} as const;

/**
 * The partner marker on a listing card (§NNN; the owner: "I would like to have a special marker
 * with this partnered event, so that people know this is not a regular Brașov Runners group run —
 * show like a handshake icon on the card"): one small outlined chip in the card's chips row, the
 * handshake and "În parteneriat cu Brașov Running Festival" — the size and the colour of the
 * surface chip beside it, so it reads as one more fact about the event rather than a badge that
 * competes with "Ediție specială".
 *
 * Nothing for an event with no partner. The partners are read the one way every surface reads
 * them (`readCoHosts`), and the words are `partnerPhrase`'s; the glyph crosses to `GlyphChip` by
 * its name (§112).
 */
export default async function PartnerChip({ event }: { event: CoHostSource }) {
  const t = await getTranslations("Event");
  const locale = await getLocale();
  const label = partnerPhrase(t, locale, readCoHosts(event).map((host) => host.name));
  if (!label) return null;
  return <GlyphChip glyph="partner" variant="outlined" label={label} sx={PARTNER_CHIP_SX} />;
}
