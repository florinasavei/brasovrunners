import Box from "@mui/material/Box";
import { getTranslations } from "next-intl/server";
import { type CoHostSource, readCoHosts } from "../domain/co-hosts";
import { partnerPhrase } from "./counted-phrases";
import { GLYPHS } from "./glyphs";

/**
 * The partner marker on the event page's overline (§367, amended §375 — the owner, 2026-09-24:
 * "For the partnership, I just need 1 icon, I do not need to show the full partners list, there
 * might be multiple partners"), and again (§379 — "the chip is too long, just say 'colaborare'
 * in the Romanian one"): after the type and the surface, a "·", the gray handshake and a
 * generic "Colaborare" — the words the listing card's chip and the calendar entry
 * say, from the one phrase (`partnerPhrase`). It never names a partner: the event page's own
 * partner cards (§344) are where the full list lives.
 *
 * The glyph is the overline's own size, 18 pixels, like the type's and the surface's before it,
 * and takes the overline's grey (now doubly so, with `PartnerEmoji`'s own grayscale filter,
 * §379): one more fact about the event, not a badge. Nothing at all for an event with no partner.
 *
 * A Server Component: the glyph is made here, never handed to a client component as an element.
 */
export default async function PartnerOverline({ event }: { event: CoHostSource }) {
  const t = await getTranslations("Event");
  const partner = partnerPhrase(t, readCoHosts(event).length > 0);
  if (!partner) return null;
  const Icon = GLYPHS.partner;
  return (
    <>
      <span aria-hidden="true">·</span>
      <Box component="span" data-testid="overline-partner" sx={{ display: "inline-flex", alignItems: "center", gap: 0.75, minWidth: 0 }}>
        <Icon aria-hidden="true" sx={{ fontSize: 18, flexShrink: 0 }} />
        <span>{partner}</span>
      </Box>
    </>
  );
}
