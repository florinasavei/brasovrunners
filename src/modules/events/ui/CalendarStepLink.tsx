"use client";

import ChevronLeftIcon from "@mui/icons-material/ChevronLeft";
import ChevronRightIcon from "@mui/icons-material/ChevronRight";
import IconButton from "@mui/material/IconButton";
import Link, { useLinkStatus } from "next/link";
import RunnerLoader, { RunnerLoaderStyles } from "@/shared/ui/RunnerLoader";

/**
 * The calendar's previous/next arrow, as a soft navigation (`DECISIONS.md` §166).
 *
 * It was `IconButton component="a"` with a plain string href, which is a *document*
 * navigation: the browser threw the page away, painted white and rebuilt it — the flicker the
 * owner reported. This is the same button over `next/link` instead, so the press replaces
 * only what changed and the calendar's body streams into a skeleton while it does.
 *
 * A client island for exactly the reason `ButtonLink` and `CardLink` are: `component={Link}`
 * cannot be written in a Server Component, because a component reference cannot cross that
 * boundary. The icon is chosen here from a **direction**, never handed in as an element —
 * `GlyphChip` records what happens when an icon element crosses instead (hydration fails and
 * the glyph disappears from the server HTML).
 *
 * `next/link` and not the locale-aware one: the href arrives already resolved by
 * `getPathname`, so it carries its locale prefix and re-prefixing it would produce
 * `/ro/ro/evenimente`. The rendered element is still a plain `<a href="…">` with the whole
 * query in it, which is what a crawler follows and what `event-pages.spec.ts` reads.
 */
export default function CalendarStepLink({
  href,
  label,
  direction,
}: {
  /** Already localized, already carrying the month and every filter it keeps. */
  href: string;
  label: string;
  direction: "previous" | "next";
}) {
  return (
    <IconButton component={Link} href={href} aria-label={label} sx={{ minHeight: 44, minWidth: 44 }}>
      <StepGlyph direction={direction} />
      {/* The runner's styles, drawn with the page, so the press adds none (§NNN). */}
      <RunnerLoaderStyles size={24} color="inherit" />
    </IconButton>
  );
}

/**
 * The arrow, or the runner while the press is still travelling (`DECISIONS.md` §167).
 *
 * Next holds a soft navigation to a **dynamic** route until the server answers when the route
 * carries no `loading.tsx`, and the listing carries none on purpose — one would replace the
 * whole page, hero and chips and all, for a change to one grid. So between the press and the
 * new month the page is correct and completely still, and the reader has nothing telling them
 * the press landed. `useLinkStatus` is Next's own answer to exactly that case ("the
 * destination route is dynamic **and** doesn't include a `loading.js`"): it reports the
 * pending state of the `<Link>` above it, and the club's runner takes the chevron's place
 * inside the same 44-pixel button — same box, so nothing moves.
 *
 * It must be a **descendant** of the `Link`, which is why this is its own component rather
 * than a few lines in the button. The button keeps its `aria-label`, so the change is
 * decoration and the control never loses its name; under reduced motion the figure simply
 * stands still, like every other runner on the site.
 */
function StepGlyph({ direction }: { direction: "previous" | "next" }) {
  const { pending } = useLinkStatus();
  if (pending) return <RunnerLoader size={24} color="inherit" />;
  return direction === "previous" ? <ChevronLeftIcon /> : <ChevronRightIcon />;
}
