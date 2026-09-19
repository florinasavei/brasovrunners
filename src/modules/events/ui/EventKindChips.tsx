import { getTranslations } from "next-intl/server";
import type { EventSurface, EventType } from "../domain/event-type";
import GlyphChip from "./GlyphChip";

/**
 * What the event is, and what it is run on, as two small chips with their glyphs (§112) — on
 * a listing card and on the featured hero, the same pair. The surface chip only when the club
 * has said (`DECISIONS.md` §61: a coffee is run on nothing).
 *
 * A Server Component: the words come from the catalogue; the glyph crosses the boundary as a
 * name and `GlyphChip` makes the element, for the reason written there.
 */
export default async function EventKindChips({ type, surface }: { type: EventType; surface: EventSurface | null }) {
  const t = await getTranslations("Event");
  return (
    <>
      <GlyphChip glyph={`type:${type}`} label={t(`type.${type}`)} />
      {surface && <GlyphChip glyph={`surface:${surface}`} variant="outlined" label={t(`surface.${surface}`)} />}
    </>
  );
}
