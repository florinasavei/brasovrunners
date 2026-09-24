import Box from "@mui/material/Box";
import { getLocale, getTranslations } from "next-intl/server";
import { type CoHostSource, readCoHosts } from "../domain/co-hosts";
import { partnerPhrase } from "./counted-phrases";
import { GLYPHS } from "./glyphs";

/**
 * The partner marker on the event page's overline (§367; the owner: "a special marker with this
 * partnered event, so that people know this is not a regular Brașov Runners group run"): after the
 * type and the surface, a "·", the handshake and "În parteneriat cu Brașov Running Festival" — the
 * words the listing card's chip and the calendar entry say, from the one phrase (`partnerPhrase`).
 *
 * The glyph is the overline's own size, 18 pixels, like the type's and the surface's before it,
 * and takes the overline's grey: one more fact about the event, not a badge. The name wraps
 * inside its own span (`minWidth: 0`) rather than widening a 320-pixel page, and the "·" stays at
 * the end of the line it follows. Nothing at all for an event with no partner.
 *
 * A Server Component: the glyph is made here, never handed to a client component as an element.
 */
export default async function PartnerOverline({ event }: { event: CoHostSource }) {
  const t = await getTranslations("Event");
  const locale = await getLocale();
  const partner = partnerPhrase(t, locale, readCoHosts(event).map((host) => host.name));
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
