"use client";

import { createSvgIcon } from "@mui/material/SvgIcon";

/**
 * The incognito hat and glasses, «Anonim»'s glyph in «Cum vrei să trimiți?» (§NNN; the owner,
 * 2026-10-09: «For "anymoymoys" use that incognito icons as well», «We love icons»). Drawn as
 * `createSvgIcon` draws every glyph of `@mui/icons-material` (the same `"use client"` module, as
 * `weather/ui/RainyIcon.tsx` is): it takes `fontSize` and `color` like the others, and its test id is
 * «IncognitoIcon».
 *
 * Asked for: Google's Material Symbols «detective» glyph (outlined, weight 400, Apache License 2.0).
 * Google's icon CDN answers, but has no such glyph — no «detective» and no «incognito» there, nor in
 * the outlined set of `@material-symbols/svg-400` 0.48.0 — so the same hat and glasses are drawn here
 * by hand as one path on the 24-unit grid, in the Symbols' outlined manner: a solid hat with its brim,
 * and two lenses as rings joined by a bridge. Nothing of Google's is copied, so no licence applies.
 */
const IncognitoIcon = createSvgIcon(
  <path d="M3 10h2.6l2.05-5.35q.35-.9 1.3-.7l2.35.55q.7.15 1.4 0l2.35-.55q.95-.2 1.3.7L18.4 10H21a1 1 0 0 1 0 2H3a1 1 0 0 1 0-2ZM2.5 17.5a4 4 0 1 1 8 0a4 4 0 1 1-8 0Zm1.75 0a2.25 2.25 0 1 0 4.5 0a2.25 2.25 0 1 0-4.5 0ZM13.5 17.5a4 4 0 1 1 8 0a4 4 0 1 1-8 0Zm1.75 0a2.25 2.25 0 1 0 4.5 0a2.25 2.25 0 1 0-4.5 0ZM10.2 15.6q1.8-1 3.6 0v1.6q-1.8-1-3.6 0Z" />,
  "Incognito",
);

export default IncognitoIcon;
