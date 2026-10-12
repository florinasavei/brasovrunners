import Box from "@mui/material/Box";
import { getTranslations } from "next-intl/server";
import { EVENT_KINDS, type EventKind } from "@/modules/events/domain/event-kind";
import { EVENT_SURFACES, type EventSurface } from "@/modules/events/domain/event-type";
import { kindChipActive, kindFilter, kindQuery } from "@/modules/events/domain/calendar-kind";
import { listingFilterQuery, type ListingFilter } from "@/modules/events/domain/listing-filter";
import ChipLink from "@/shared/ui/ChipLink";
import ScrollRow from "@/shared/ui/ScrollRow";
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
 * a visible scrollbar and an edge fade from `ScrollRow`, §720 amended), so the row stays one 44-pixel line at every width: at 320 pixels the first week stays
 * above the fold (§569), and a month with another surface never moves the arrows (§575).
 *
 * Drawn only under the look (`onlyUnderLook`): off, the calendar is today's, and the kind is
 * reached from nowhere. A Server Component with typed props; every chip is strings and a glyph's
 * name.
 */
/** The pill on a phone, under the look; every value names its `sm` too, MUI's small chip, so nothing reaches a wider screen. */
const PHONE_PILL_SX = {
  height: { xs: "20px", sm: "24px" },
  fontSize: { xs: "0.6875rem", sm: "0.8125rem" },
  "& .MuiChip-label": { px: { xs: "6px", sm: "8px" } },
  "& .MuiChip-icon": { fontSize: { xs: "13px", sm: "18px" }, ml: { xs: "5px", sm: "4px" }, mr: { xs: "-3px", sm: "-4px" } },
} as const;

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
    <ScrollRow
      role="group"
      ariaLabel={t("calendar.look.kinds.label")}
      testId="calendar-kind-chips"
      sx={{
        display: "none",
        alignItems: "center",
        columnGap: 0.75,
        // One row at every width, scrolled sideways where it does not fit: a month with one more
        // surface never wraps a second line and moves the arrows under it (BR-REQ-041-01 criterion 12).
        // The shared scroll style shows the scrollbar and fades the edge with more to see (§720 amended).
        flexWrap: "nowrap",
        scrollSnapType: "x proximity",
        "& > a": { scrollSnapAlign: "start", flexShrink: 0 },
        // Drawn only under the look (onlyUnderLook rule); the pills are ChipLink own small ones, inside its 44-pixel links.
        // On a phone they are smaller still (the owner, 2026-10-12: «chipurile trebuie să fie mult mai mici pe telefon»):
        // a 20-pixel pill, the 11-pixel word, a 13-pixel glyph and tighter sides, so three or four show at 360 pixels.
        // The link around each stays 44 pixels tall (BR-REQ-041-01 criterion 6). From `sm`, MUI's small pill as before.
        [UNDER_LOOK]: { display: "flex", columnGap: { xs: "4px", sm: "6px" }, "& .MuiChip-root": PHONE_PILL_SX },
      }}
    >
      {([null, ...EVENT_KINDS] as const).map((option) => {
        const active = kindChipActive(option, kind, filter);
        const key = option ?? "all";
        return (
          <ChipLink
            key={key}
            href={href(option, kindFilter(filter))}
            label={t(`calendar.look.kinds.${key}`)}
            glyph={KIND_GLYPH[key]}
            active={active}
            current={active ? "page" : undefined}
            keepScroll
          />
        );
      })}
      {surfaces.length > 0 && <Box aria-hidden="true" sx={{ width: "1px", height: 20, alignSelf: "center", bgcolor: "divider", mx: 0.25, flexShrink: 0 }} />}
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
    </ScrollRow>
  );
}
