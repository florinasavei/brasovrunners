"use client";

import { createSvgIcon } from "@mui/material/SvgIcon";

/**
 * A cloud with three strokes of rain under it, the sky's glyph for plain rain (WMO 61/63; §NNN,
 * amending §677: the owner, 2026-10-09, «Yes different icon» — the drop it replaces is the chance's
 * mark alone). It was the glyph for showers and heavy rain (§677, amending §402; the owner,
 * 2026-10-08: «I hate that umbrella closed»), which now take `RainyHeavyIcon`, and drizzle
 * `RainyLightIcon`: one family of three clouds, by intensity. Material's icon set has no such
 * glyph — its `Shower` is a bathroom's, `BeachAccess` a parasol, `Water` waves — so it is drawn
 * here, as `createSvgIcon` draws every glyph of `@mui/icons-material` (the same `"use client"`
 * module): it takes `fontSize` and `color` like the others, and its test id is «RainyIcon».
 *
 * The path is the «rainy» glyph of Google's Material Symbols (filled, weight 400), licensed under
 * the Apache License 2.0 (Google's `material-design-icons` repository), rescaled from the
 * Symbols' 960-unit grid to the 24-unit viewBox every Material icon here uses.
 */
const RainyIcon = createSvgIcon(
  <path d="M13.95 21.9q-.375.2-.762.063T12.6 21.45l-1.5-3q-.2-.375-.062-.762T11.55 17.1q.375-.2.763-.062T12.9 17.55l1.5 3q.2.375.063.763T13.95 21.9Zm6 0q-.375.2-.762.063T18.6 21.45l-1.5-3q-.2-.375-.062-.762T17.55 17.1q.375-.2.763-.062T18.9 17.55l1.5 3q.2.375.063.763T19.95 21.9Zm-12 0q-.375.2-.762.063T6.6 21.45l-1.5-3q-.2-.375-.062-.762T5.55 17.1q.375-.2.763-.062T6.9 17.55l1.5 3q.2.375.063.763T7.95 21.9Zm-.45-5.9q-2.275 0-3.887-1.612T2 10.5q0-2.075 1.375-3.625t3.4-1.825q.8-1.425 2.188-2.237T12 2q2.25 0 3.913 1.438T17.925 7.025q1.725.15 2.9 1.425t1.175 3.05q0 1.875-1.312 3.188T17.5 16H7.5Z" />,
  "Rainy",
);

export default RainyIcon;
