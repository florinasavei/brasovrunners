import Box from "@mui/material/Box";
import type { ReactNode } from "react";
import GlyphChip from "./GlyphChip";
import type { Pill } from "./route-pills";

/**
 * A pill that wraps rather than ending in MUI's ellipsis, like the event page's (§356): a pill
 * only for what the club stated, so a wide club-typed amount is never cut. A plain object in
 * module scope, because it crosses to the client component (`GlyphChip`).
 */
const PILL_SX = { height: "auto", minHeight: 24, maxWidth: "100%", "& .MuiChip-label": { whiteSpace: "normal", overflowWrap: "anywhere", py: 0.25 } } as const;

/**
 * A row of route pills, small and outlined, exactly as the event page and the listing card draw
 * them (§356, §366). A plain, synchronous component — `buildRoutePills` (`route-pills.ts`) is
 * what decides the order and the set, so a caller builds the array once (with its own translator
 * and formatter) and hands it here; nesting an async Server Component inside another one is what
 * `react-dom/server`'s static renderer cannot resolve, so this one takes no translations of its
 * own.
 *
 * Called from the listing card's compact facts (`EventFacts`) and the backoffice's own event
 * list (`DECISIONS.md` §388 — the owner, 2026-09-25, on `/admin` on his phone: "I want the same
 * small icons for the event types, trail, distance, etc. on the back-office cards as well,
 * people will get used to them"), so neither surface can read the route pills differently from
 * the other. Nothing at all when there is nothing to draw.
 *
 * `trailing` is drawn after the last pill, in the same wrapping row: the listing card's weather at
 * the start (`CardWeather`, §NNN), which is not a route pill — its glyph is the forecast's, made in
 * a Server Component, never a `GlyphChip` name — but sits beside them as the row's last. A node
 * made by the Server Component that calls this one, never handed to a client component.
 */
export default function RoutePills({ pills, trailing }: { pills: Pill[]; trailing?: ReactNode }) {
  if (pills.length === 0 && !trailing) return null;
  return (
    <Box sx={{ display: "flex", flexWrap: "wrap", gap: 1 }}>
      {pills.map((item) => (
        <GlyphChip key={item.glyph} glyph={item.glyph} label={item.label} tooltip={item.tooltip} srSuffix={item.srSuffix} variant="outlined" sx={PILL_SX} />
      ))}
      {trailing}
    </Box>
  );
}
