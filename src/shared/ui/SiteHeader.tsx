import Box from "@mui/material/Box";
import Container from "@mui/material/Container";
import { getLocale, getTranslations } from "next-intl/server";
import { getDb } from "@/db/client";
import type { Locale } from "@/i18n/routing";
import { listPublishedPages } from "@/modules/content/pages/repository";
import { HEADER_MARK_HEIGHT, HEADER_MARK_HEIGHT_PX, LOGO } from "@/theme/brand";
import LocaleSwitcher from "./LocaleSwitcher";
import LogoLink from "./LogoLink";
import SiteNav from "./SiteNav";

/**
 * The club's standing pages, for the navigation — or nothing at all, whatever goes wrong.
 *
 * ## Why a try/catch and not `.catch()`
 *
 * This was written as `listPublishedPages(getDb(), locale).catch(() => [])`, which reads as
 * guarded and is not: `getDb()` runs **synchronously**, as an argument, and throws before there
 * is any promise for `.catch` to attach to. The rejection handler was chained to a promise that
 * never existed. A `try` covers the call and the await together, which is the only shape that
 * covers both failures.
 *
 * ## Why it must survive having no database at all
 *
 * `db/client.ts` documents the rule this broke: importing it must stay free, because Next
 * evaluates page modules while collecting build data, and a build must work on a machine with
 * no database — CI has none. `/[locale]` is a pure redirect with no `force-dynamic`, so Next
 * prerenders it at build time and renders this layout to do it. Unguarded, that failed the
 * whole build with "DATABASE_URL is not set", on a page that renders nothing.
 *
 * Returning `[]` costs a navigation entry on the two routes that are statically prerendered —
 * a redirect and a catch-all 404, neither of which shows a menu anybody reads. Every page where
 * the navigation matters declares `force-dynamic` and queries for real, on every request.
 *
 * And a header that throws is a site with no way out of any page, which is worse than a site
 * with a shorter menu.
 */
async function navigationPages(locale: Locale) {
  try {
    return await listPublishedPages(getDb(), locale);
  } catch {
    return [];
  }
}

/**
 * The site header: the club's logo, whole, and a way back to the first page.
 *
 * A Server Component — nothing here is interactive except the link, and that lives in
 * `LogoLink` (AGENTS.md §14.1: narrow client boundaries).
 *
 * The logo is the club's **lockup**, the supplied artwork entire: the mountains with
 * `BRASOV RUNNERS` beneath them, set in the lettering the logo was drawn with. Settled on
 * 2026-09-17 after two alternatives were tried in one day — the lockup alone at mark height,
 * where the wordmark was four pixels tall, and the mark with the kit face beside it, which put
 * the club's name on the row twice in two different typefaces and could not be aligned because
 * one of them is baked into an image. The answer was neither the pairing nor a smaller logo but
 * a bigger one: `HEADER_MARK_HEIGHT` is 44px now and the artwork's own lettering reads.
 *
 * Nothing renders the kit face any more, so the font is no longer loaded — 36 kB that every
 * visitor used to pay for a word they can already see in the artwork.
 *
 * The artwork's wordmark reads BRASOV, without the ș: it is the printed logotype, not the
 * club's name. So the link's accessible name comes from the message catalogue and assistive
 * technology announces `Brașov Runners`, spelled properly, and never the artwork.
 *
 * A plain `<img>` rather than `next/image`. It is an SVG, so there is nothing for the image
 * optimizer to do, and serving one through `next/image` requires `dangerouslyAllowSVG`, which
 * turns on SVG rendering for *every* remote image the app might ever load. That is a large door
 * to open for one logo.
 *
 * `alt=""` because the link itself carries the name; announcing both would read the club name
 * twice to a screen reader.
 */
export default async function SiteHeader() {
  const t = await getTranslations("Site");
  /**
   * One indexed query on every public page, which is a cost worth naming: the header is what
   * every visitor pays for (`AGENTS.md` §1.5). It buys a navigation an organizer can change
   * without a developer, which is the whole point of the page type (BR-REQ-050-03).
   */
  const locale = await getLocale();
  const pages = await navigationPages(locale as Locale);

  return (
    <Box
      component="header"
      sx={{
        borderBottom: 1,
        borderColor: "divider",
        bgcolor: "background.paper",
        /**
         * Sticky, because an event page is long and the way out of it should not depend on
         * scrolling back. `sticky` rather than `fixed`: it stays in the flow, so nothing
         * below needs a matching top offset and no page can slide underneath it.
         *
         * The environment notice above is deliberately *not* sticky — it is read once.
         */
        position: "sticky",
        top: 0,
        zIndex: 1100,
      }}
    >
      <Container
        maxWidth="md"
        sx={{
          display: "flex",
          alignItems: "center",
          // The lockup takes the space it needs and the switcher sits at the end — until they
          // do not both fit, and then the switcher takes a second row. Wrapping rather than
          // shrinking, because at 320px the header has 288px to work with and this lockup has
          // overflowed once already (BR-REQ-041-01 criterion 1). A wrap costs 44px of height
          // on the narrowest phones; an overflow costs the whole page a sideways scrollbar.
          flexWrap: "wrap",
          gap: 1,
          py: 1,
        }}
      >
        <Box sx={{ order: 1 }}>
        <LogoLink label={t("name")}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={LOGO.lockup.src}
            // The attributes reserve the box at its largest, from the artwork's own
            // proportions, so the header does not reflow while the SVG loads; the CSS below
            // draws it at the fluid size. A differently shaped lockup needs no change here.
            height={HEADER_MARK_HEIGHT_PX}
            width={Math.round((HEADER_MARK_HEIGHT_PX * LOGO.lockup.width) / LOGO.lockup.height)}
            alt=""
            style={{
              display: "block",
              flexShrink: 0,
              height: HEADER_MARK_HEIGHT,
              width: "auto",
            }}
          />
        </LogoLink>
        </Box>

        {/*
          The sections sit next to the club's name, where navigation is looked for, and the
          language sits at the far end, where a setting belongs. They were briefly grouped
          together at the end, which read as two settings rather than a place to go.

          At 320px the lockup fills the first row and the sections take the whole of a
          second, aligned under the name rather than crammed against the right edge.
          Wrapping rather than shrinking: an overflow costs the page a sideways scrollbar
          (BR-REQ-041-01 criterion 1), a wrap costs one row of height.
        */}
        <Box
          sx={{
            order: { xs: 3, sm: 2 },
            flexBasis: { xs: "100%", sm: "auto" },
            // The nav below scrolls sideways rather than wrapping, and a flex child will not
            // shrink below its content unless both it and the scroller say so.
            minWidth: 0,
            flexShrink: 1,
            ml: { sm: 2 },
          }}
        >
          <SiteNav pages={pages.map((page) => ({ slug: page.slug, title: page.title }))} />
        </Box>

        <Box sx={{ order: { xs: 2, sm: 3 }, ml: "auto" }}>
          <LocaleSwitcher />
        </Box>
      </Container>
    </Box>
  );
}
