import Box from "@mui/material/Box";
import Container from "@mui/material/Container";
import Typography from "@mui/material/Typography";
import { getTranslations } from "next-intl/server";
import {
  FONT,
  HEADER_MARK_HEIGHT,
  HEADER_MARK_HEIGHT_PX,
  HEADER_WORDMARK_SIZE,
  LOGO,
  WORDMARK,
} from "@/theme/brand";
import LocaleSwitcher from "./LocaleSwitcher";
import LogoLink from "./LogoLink";
import SiteNav from "./SiteNav";

/**
 * The site header: the mark, the club's name, and a way back to the first page.
 *
 * A Server Component — nothing here is interactive except the link, and that lives in
 * `LogoLink` (AGENTS.md §14.1: narrow client boundaries).
 *
 * The mark is the mountains alone, with the wordmark set as live text in the club's own kit
 * face rather than baked into the artwork. Two reasons:
 *
 *   1. The full lockup is 2.4:1. At a height that fits a header, the wordmark inside it renders
 *      about four pixels tall — present, and unreadable.
 *   2. Text scales with the reader's font settings; artwork does not.
 *
 * The visible wordmark is `BRASOV RUNNERS`, unaccented, matching the printed kit. That is a
 * logotype, not the club's name, and it is safe here only because it is pure ASCII: Facón has
 * no Romanian characters at all. The link's accessible name is set from the message catalogue
 * instead, so assistive technology announces `Brașov Runners`, spelled properly.
 *
 * The mark is a plain `<img>` rather than `next/image`. It is an SVG, so there is nothing for
 * the image optimizer to do, and serving one through `next/image` requires
 * `dangerouslyAllowSVG`, which turns on SVG rendering for *every* remote image the app might
 * ever load. That is a large door to open for one logo.
 *
 * `alt=""` because the name is already beside it as text; announcing both would read the club
 * name twice to a screen reader.
 */
export default async function SiteHeader() {
  const t = await getTranslations("Site");

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
            src={LOGO.mark.src}
            // Width is derived from the artwork's own proportions, so replacing the mark with
            // a differently shaped one needs no change here. Both are set so the browser
            // reserves the box and the header does not reflow while the SVG loads.
            // The attributes reserve the box at its largest, so the header does not reflow
            // while the SVG loads; the CSS below draws it at the fluid size.
            height={HEADER_MARK_HEIGHT_PX}
            width={Math.round((HEADER_MARK_HEIGHT_PX * LOGO.mark.width) / LOGO.mark.height)}
            alt=""
            style={{
              display: "block",
              flexShrink: 0,
              height: HEADER_MARK_HEIGHT,
              // Width follows the artwork's own aspect ratio, so a differently proportioned
              // mark needs no change here.
              width: "auto",
            }}
          />
          <Typography
            component="span"
            sx={{
              // Facón is one style: black, italic. Both are stated so the fallback, Roboto,
              // lands in the same weight and slant if the font has not arrived yet.
              fontFamily: `${FONT.wordmark}, ${FONT.fallback}`,
              fontWeight: 900,
              fontStyle: "italic",
              fontSize: HEADER_WORDMARK_SIZE,
              lineHeight: 1,
              // The face is wide and tightly fitted; a little tracking stops the letters
              // touching at header size.
              letterSpacing: "0.02em",
              whiteSpace: "nowrap",
            }}
          >
            {WORDMARK}
          </Typography>
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
        <Box sx={{ order: { xs: 3, sm: 2 }, flexBasis: { xs: "100%", sm: "auto" }, ml: { sm: 2 } }}>
          <SiteNav />
        </Box>

        <Box sx={{ order: { xs: 2, sm: 3 }, ml: "auto" }}>
          <LocaleSwitcher />
        </Box>
      </Container>
    </Box>
  );
}
