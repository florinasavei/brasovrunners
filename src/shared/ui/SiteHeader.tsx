import Box from "@mui/material/Box";
import Container from "@mui/material/Container";
import { getTranslations } from "next-intl/server";
import { LOGO } from "@/theme/brand";
import LogoLink from "./LogoLink";

/**
 * The site header: the mark, the club's name, and a way back to the first page.
 *
 * A Server Component — nothing here is interactive except the link, and that lives in
 * `LogoLink` (AGENTS.md §14.1: narrow client boundaries).
 *
 * The logo is a plain `<img>` rather than `next/image`. It is a fixed-size SVG, so there is
 * nothing for the image optimizer to do, and serving an SVG through `next/image` requires
 * `dangerouslyAllowSVG`, which turns on SVG rendering for *every* remote image the app might
 * ever load. That is a large door to open for one logo.
 *
 * `alt` is the club's name, from the message catalogue: the lockup carries the name as
 * artwork, so the alternative text has to say it. It is the only place the name appears in
 * this header, which is why it is not `alt=""`.
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
      }}
    >
      <Container maxWidth="sm" sx={{ display: "flex", alignItems: "center", py: 1 }}>
        <LogoLink>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={LOGO.lockup.src}
            width={LOGO.lockup.width}
            height={LOGO.lockup.height}
            alt={t("name")}
            // Reserving the box stops the header from reflowing while the SVG loads. The
            // lockup is 180px wide and the narrowest supported viewport is 320px, so it fits
            // without a separate mark-only variant.
            style={{ display: "block", flexShrink: 0 }}
          />
        </LogoLink>
      </Container>
    </Box>
  );
}
