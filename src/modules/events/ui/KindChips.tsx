import Box from "@mui/material/Box";
import { getTranslations } from "next-intl/server";
import { EVENT_KINDS, type EventKind } from "@/modules/events/domain/event-kind";
import { EVENT_SURFACES, type EventSurface } from "@/modules/events/domain/event-type";
import { kindQuery } from "@/modules/events/domain/calendar-kind";
import { listingFilterQuery, type ListingFilter } from "@/modules/events/domain/listing-filter";
import ChipLink from "@/shared/ui/ChipLink";
import { UNDER_LOOK } from "@/theme/look";
import type { GlyphName } from "./glyphs";

/** The chips' glyphs, by name in the public registry (§370): everything, the weekly repeat, the special's sparkle. */
const KIND_GLYPH: Record<EventKind | "all", GlyphName> = { all: "club", weekly: "repeat", special: "special" };

export type KindChipsProps = {
  /** The period's own path, spelled (`/ro/calendar/2026-10`, §574): every chip's link goes there with its query. */
  path: string;
  /** The kind in force, or null for every kind. */
  kind: EventKind | null;
  /** The panel's filters in force (§413): every chip keeps them, and the surface chips tick and untick theirs. */
  filter: ListingFilter;
  /** The surfaces worth a chip on this period — the panel's own offer for the group (§413), the ticked ones included. */
  surfaces: readonly EventSurface[];
};

/**
 * The calendar's filter chips, always in sight under «Aspectul nou» (the facelift's phase 4,
 * `docs/REDESIGN.md` § Open questions: the chips carry the kind and the surface; the collapsed
 * «Filtre» panel keeps the rest). Two groups in one row: the kind — «Toate evenimentele»,
 * «Alergări săptămânale», «Evenimente speciale», one choice (`?kind=`, `calendar-kind.ts`) — and
 * the surfaces this period offers, each a tick of the panel's own `?surface=` (§413), so a chip
 * and a box are one state and the panel hides its surface group under the look.
 *
 * **Links, so scripts are optional** (§413): every chip is a `ChipLink` to the address with that
 * choice made — the period's path, the other filters kept — so a browser without JavaScript
 * filters by following it, and with one the press is a soft navigation that keeps the scroll.
 *
 * **One row.** The chips are a sideways strip that scrolls where it does not fit (CSS scroll-snap,
 * no island), so the row stays one 44-pixel line at every width: at 320 pixels the first week stays
 * above the fold (§569), and a month with another surface never moves the arrows (§575).
 *
 * Drawn only under the look (`onlyUnderLook`): off, the calendar is today's, and the kind is
 * reached from nowhere. A Server Component with typed props; every chip is strings and a glyph's
 * name.
 */
export default async function KindChips({ path, kind, filter, surfaces }: KindChipsProps) {
  const t = await getTranslations("Events");
  const tEvent = await getTranslations("Event");
  const href = (nextKind: EventKind | null, next: ListingFilter) => {
    const search = new URLSearchParams();
    for (const [name, value] of Object.entries({ ...kindQuery(nextKind), ...listingFilterQuery(next) }))
      for (const one of Array.isArray(value) ? value : [value]) search.append(name, one);
    const query = search.toString();
    return query ? `${path}?${query}` : path;
  };
  const withSurface = (surface: EventSurface, on: boolean): ListingFilter => ({
    ...filter,
    // In the closed set's own order, as the panel's form submits them (§413): one address per state.
    surface: EVENT_SURFACES.filter((value) => (value === surface ? on : filter.surface.includes(value))),
  });

  return (
    <Box
      role="group"
      aria-label={t("calendar.look.kinds.label")}
      data-testid="calendar-kind-chips"
      sx={{
        display: "none",
        alignItems: "center",
        columnGap: 0.75,
        // One row at every width, scrolled sideways where it does not fit: a month with one more
        // surface never wraps a second line and moves the arrows under it (BR-REQ-041-01 criterion 12).
        flexWrap: "nowrap",
        overflowX: "auto",
        scrollSnapType: "x proximity",
        scrollbarWidth: "none",
        "&::-webkit-scrollbar": { display: "none" },
        "& > a": { scrollSnapAlign: "start", flexShrink: 0 },
        // A little larger than the panel's 24-pixel pills: these are the page's first controls.
        // Drawn only under the look (`onlyUnderLook`'s rule, merged with the chips' size here).
        [UNDER_LOOK]: { display: "flex", "& .MuiChip-root": { height: 32, borderRadius: "16px", px: 0.5, fontWeight: 600 } },
      }}
    >
      {([null, ...EVENT_KINDS] as const).map((option) => {
        const active = option === kind;
        const key = option ?? "all";
        return (
          <ChipLink
            key={key}
            href={href(option, filter)}
            label={t(`calendar.look.kinds.${key}`)}
            glyph={KIND_GLYPH[key]}
            active={active}
            current={active ? "page" : undefined}
            keepScroll
          />
        );
      })}
      {surfaces.length > 0 && <Box aria-hidden="true" sx={{ width: "1px", alignSelf: "stretch", minHeight: 20, bgcolor: "divider", mx: 0.25, flexShrink: 0 }} />}
      {surfaces.map((surface) => {
        const on = filter.surface.includes(surface);
        return (
          <ChipLink
            key={surface}
            href={href(kind, withSurface(surface, !on))}
            label={tEvent(`surface.${surface}`)}
            glyph={`surface:${surface}`}
            active={on}
            current={on ? "page" : undefined}
            keepScroll
          />
        );
      })}
    </Box>
  );
}
