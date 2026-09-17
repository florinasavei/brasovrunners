"use client";

import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Menu from "@mui/material/Menu";
import MenuItem from "@mui/material/MenuItem";
import { useTranslations } from "next-intl";
import { useSelectedLayoutSegments } from "next/navigation";
import { useLayoutEffect, useRef, useState, type ComponentProps, type MouseEvent } from "react";
import { Link } from "@/i18n/navigation";
import { DURATION, EASE, HOVER_OK } from "@/theme/motion";

const SECTIONS = [{ segment: "events", href: "/events" }] as const;

export type NavPage = { slug: string; title: string };

type Href = ComponentProps<typeof Link>["href"];
type Item = { key: string; href: Href; label: string; current: boolean };

/**
 * The site's sections, in the header, on every page — and, when they do not all fit on the
 * row, the rest of them in a menu.
 *
 * Until this existed the only way out of an event page was the logo — a convention people know
 * rather than a signpost people read. Somebody who landed on `/ro/evenimente/tura-pe-tampa`
 * from a search had nothing telling them the site has a list of events at all.
 *
 * ## Why this is a Client Component
 *
 * Originally for `aria-current` alone: marking the section you are in is what separates
 * navigation from a row of links, and it needs to know where you are.
 * `useSelectedLayoutSegments` runs during the server render too, so the anchors carry real
 * `href`s in the HTML and every link works with JavaScript switched off — the same reasoning
 * `LocaleSwitcher` already documents.
 *
 * Since 2026-09-17 it also measures. The club's standing pages are one entry each, in the order
 * the club put them, and there is no limit on how many an organizer publishes — so on any width
 * the row can run out of room. Until now it scrolled sideways behind a hidden scrollbar, which
 * the owner read as "the buttons don't fit". Now the row shows what fits and folds the rest
 * into one "More" button (the "priority+" pattern): every entry is rendered, each is measured,
 * and the first N whose widths — plus the button, when there is a rest — fit the container stay
 * on the row. A `ResizeObserver` on the container and on every entry re-runs the sum when the
 * viewport or a label changes, so a rotation or a late font moves entries in or out of the menu.
 *
 * Measuring, not a breakpoint, because the break depends on how many pages the club has and
 * how long their titles are — two things no breakpoint can know.
 *
 * ## What is hidden, and how
 *
 * A folded entry stays in the DOM, absolutely positioned and `visibility: hidden`, so it keeps
 * a measurable width and can come back without a re-render of its content. It is
 * `aria-hidden` and out of the tab order; the same destination is reachable through the menu,
 * which is a real `<a>` per entry (`MenuItem component={Link}`), so nothing is a menu-only
 * route. The server render has every entry on the row and the button hidden; the first layout
 * effect corrects that before paint. With JavaScript off, the row keeps the sideways scroll it
 * always had, so no page is unreachable.
 *
 * The segment is the *folder* under `[locale]`, so it is `events` whether the visitor is on
 * `/ro/evenimente` or `/en/events`. That is why the comparison needs no localized path and
 * cannot drift when a slug is translated (`AGENTS.md` §9.2). Segments rather than one segment: a
 * standing page is two deep (`pages` then its slug), and comparing only the first would mark
 * every page as the current one.
 *
 * ## Why the list is so short
 *
 * Because it is honest. Events is the section this site is built around; the legal pages live in
 * the footer, where legal links belong. Articles and galleries are still M5, and a nav item
 * pointing at a route that 404s is worse than one that is missing. The club's own standing pages
 * arrive as a prop from `SiteHeader` — a Server Component that can read them — rather than as a
 * constant somebody has to remember to edit (BR-REQ-050-03).
 */
export default function SiteNav({ pages = [] }: { pages?: readonly NavPage[] }) {
  const t = useTranslations("Site.nav");
  const segments = useSelectedLayoutSegments();
  const selected = segments[0];

  const items: Item[] = [
    ...SECTIONS.map((section) => ({
      key: section.segment,
      href: section.href as Href,
      label: t(section.segment),
      current: selected === section.segment,
    })),
    ...pages.map((page) => ({
      key: `page:${page.slug}`,
      href: { pathname: "/pages/[slug]", params: { slug: page.slug } } as Href,
      label: page.title,
      current: selected === "pages" && segments[1] === page.slug,
    })),
  ];

  const navRef = useRef<HTMLElement>(null);
  const moreRef = useRef<HTMLElement>(null);
  const itemRefs = useRef<Array<HTMLElement | null>>([]);
  // Everything, until measured: the server render and a no-JavaScript reader get the whole row.
  const [visibleCount, setVisibleCount] = useState(items.length);
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);

  useLayoutEffect(() => {
    const nav = navRef.current;
    if (!nav) return;

    const measure = () => {
      const gap = parseFloat(getComputedStyle(nav).columnGap) || 0;
      // Fractional widths: `offsetWidth` rounds each entry, and a row of rounded widths can sum
      // to a pixel more than the row, which is one entry clipped on its last letter.
      const width = (el: HTMLElement | null) => el?.getBoundingClientRect().width ?? 0;
      const available = nav.clientWidth;
      const widths = itemRefs.current.slice(0, items.length).map(width);
      const more = width(moreRef.current);

      let used = 0;
      let count = 0;
      for (; count < widths.length; count++) {
        const withThis = used + (count > 0 ? gap : 0) + widths[count];
        // Room for the button must be kept unless this is the last entry: if anything after it
        // fails to fit, the button appears, and then this entry must still fit beside it.
        const reserve = count < widths.length - 1 ? gap + more : 0;
        if (withThis + reserve > available) break;
        used = withThis;
      }
      setVisibleCount((previous) => (previous === count ? previous : count));
    };

    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(nav);
    for (const el of itemRefs.current) if (el) observer.observe(el);
    return () => observer.disconnect();
  }, [items.length]);

  const overflow = items.slice(visibleCount);
  const currentIsFolded = overflow.some((item) => item.current);
  const close = () => setAnchor(null);

  return (
    <Box
      component="nav"
      ref={navRef}
      aria-label={t("label")}
      sx={{
        display: "flex",
        alignItems: "center",
        gap: { xs: 1, sm: 2 },
        flexWrap: "nowrap",
        minWidth: 0,
        position: "relative",
        // Scrolls only without JavaScript; with it, what does not fit is folded away.
        overflowX: "auto",
        // The current section is marked with a 2px underline; without room for it the
        // container clips it away exactly on the entry it is meant to identify.
        pb: "2px",
        scrollbarWidth: "none",
        "&::-webkit-scrollbar": { display: "none" },
        "& > *": { flexShrink: 0 },
      }}
    >
      {items.map((item, index) => {
        const folded = index >= visibleCount;
        return (
          <Box
            key={item.key}
            component="span"
            ref={(el: HTMLElement | null) => {
              itemRefs.current[index] = el;
            }}
            aria-hidden={folded || undefined}
            sx={folded ? FOLDED : undefined}
          >
            {/* inline-flex so the anchor's box is the 44px entry, not a line of text. */}
            <Link
              href={item.href}
              style={{ textDecoration: "none", display: "inline-flex" }}
              tabIndex={folded ? -1 : 0}
            >
              <Box component="span" aria-current={item.current ? "page" : undefined} sx={entrySx(item.current)}>
                {item.label}
              </Box>
            </Link>
          </Box>
        );
      })}

      <Box component="span" ref={moreRef} sx={overflow.length === 0 ? FOLDED : undefined}>
        <Button
          id="site-nav-more"
          aria-haspopup="menu"
          aria-expanded={anchor ? "true" : undefined}
          aria-controls={anchor ? "site-nav-more-menu" : undefined}
          onClick={(event: MouseEvent<HTMLElement>) => setAnchor(event.currentTarget)}
          tabIndex={overflow.length === 0 ? -1 : 0}
          sx={{
            ...entrySx(currentIsFolded),
            textTransform: "none",
            fontSize: "inherit",
            borderRadius: 0,
            minWidth: 0,
            // MUI's button padding on top of the entry's 44px made this the tallest thing on
            // the row, and the row the tallest thing in the header. The same box as an entry.
            py: 0,
            "&:hover": { color: "text.primary", bgcolor: "transparent" },
          }}
        >
          {t("more")}
          {/* A caret drawn with text: one glyph, no icon package (AGENTS.md §1.5). */}
          <Box component="span" aria-hidden="true" sx={{ ml: 0.5, fontSize: "0.75em" }}>
            ▾
          </Box>
        </Button>
      </Box>

      <Menu
        id="site-nav-more-menu"
        anchorEl={anchor}
        open={Boolean(anchor)}
        onClose={close}
        slotProps={{ list: { "aria-labelledby": "site-nav-more" } }}
      >
        {overflow.map((item) => (
          <MenuItem
            key={item.key}
            component={Link}
            href={item.href}
            selected={item.current}
            onClick={close}
            sx={{ minHeight: 44 }}
          >
            {item.label}
          </MenuItem>
        ))}
      </Menu>
    </Box>
  );
}

/** Out of the flow and invisible, but still laid out, so its width can be read back. */
const FOLDED = { position: "absolute", visibility: "hidden", pointerEvents: "none" } as const;

/**
 * One entry on the row, with the current one underlined — not colour alone (BR-REQ-041-01).
 *
 * The underline is a pseudo-element scaled from the left, so it slides in under the pointer
 * and is simply there on the current entry. The transparent border beneath it keeps the box
 * the height it always was (44px plus the line), so the row does not move when the line does.
 * Hover is behind `HOVER_OK`: on a phone `:hover` sticks after a tap.
 */
function entrySx(current: boolean) {
  return {
    position: "relative",
    display: "inline-flex",
    alignItems: "center",
    // BR-REQ-041-01 criterion 6: a target a thumb can hit, on the phone this site is mostly
    // read on.
    minHeight: 44,
    px: 0.5,
    color: current ? "text.primary" : "text.secondary",
    fontWeight: current ? 700 : 500,
    borderBottom: 2,
    borderColor: "transparent",
    transition: `color ${DURATION.fast}ms ${EASE}`,
    "&::after": {
      content: '""',
      position: "absolute",
      left: 4,
      right: 4,
      bottom: -2,
      height: 2,
      bgcolor: "primary.main",
      transform: current ? "scaleX(1)" : "scaleX(0)",
      transformOrigin: "left",
      transition: `transform ${DURATION.base}ms ${EASE}`,
      "@media (prefers-reduced-motion: reduce)": { transition: "none" },
    },
    [HOVER_OK]: {
      "&:hover": { color: "text.primary" },
      "&:hover::after": { transform: "scaleX(1)" },
    },
  } as const;
}
