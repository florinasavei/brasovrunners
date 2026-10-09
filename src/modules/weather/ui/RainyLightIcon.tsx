"use client";

import { createSvgIcon } from "@mui/material/SvgIcon";

/**
 * A cloud with two short strokes of rain under it, the sky's glyph for drizzle (WMO 51/53/55; §NNN,
 * amending §677): the lightest of the three rain clouds — `RainyLightIcon` for drizzle, `RainyIcon`
 * for plain rain, `RainyHeavyIcon` for showers and heavy rain — so the drop stays the chance's
 * mark alone. Made with `createSvgIcon`, as every glyph of `@mui/icons-material` is (the same
 * `"use client"` module): it takes `fontSize` and `color` like the others, and its test id is
 * «RainyLightIcon».
 *
 * Drawn here by hand, not fetched: Google's icon CDN does carry a «rainy_light» in Material Symbols,
 * but it is the rain's strokes alone, with no cloud, and the family is three clouds. So the path is
 * the «rainy» glyph of Google's Material Symbols (filled, weight 400) — licensed under the Apache
 * License 2.0 (Google's `material-design-icons` repository), on the 24-unit viewBox `RainyIcon`
 * uses — with its cloud unchanged and two strokes in place of its three, each half as long, set
 * under the cloud at the same spacing and slope. Nothing is taken from any other icon set.
 */
const RainyLightIcon = createSvgIcon(
  <path d="M10.575 20.4q-.375.2-.762.063t-.588-.513l-.75-1.5q-.2-.375-.062-.762t.512-.588q.375-.2.763-.062t.587.512l.75 1.5q.2.375.063.763t-.513.587ZM16.575 20.4q-.375.2-.762.063t-.588-.513l-.75-1.5q-.2-.375-.062-.762t.512-.588q.375-.2.763-.062t.587.512l.75 1.5q.2.375.063.763t-.513.587ZM7.5 16q-2.275 0-3.887-1.612T2 10.5q0-2.075 1.375-3.625t3.4-1.825q.8-1.425 2.188-2.237T12 2q2.25 0 3.913 1.438T17.925 7.025q1.725.15 2.9 1.425t1.175 3.05q0 1.875-1.312 3.188T17.5 16H7.5Z" />,
  "RainyLight",
);

export default RainyLightIcon;
