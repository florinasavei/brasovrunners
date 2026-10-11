import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import type { ComponentProps } from "react";
import type { Link } from "@/i18n/navigation";
import ArrowButtonLink from "@/shared/ui/ArrowButtonLink";
import HomePicture, { type HomePictureSources } from "./HomePicture";

type Href = ComponentProps<typeof Link>["href"];

export type HeroProps = {
  /** The headline as `splitHeadline` cuts it: the words in ink, the last one in the accent (or none). */
  headline: { lead: string; accent: string | null };
  subline: string;
  /** The club's photograph, or null for the empty slot (decision 6: never a stock picture). */
  picture: HomePictureSources | null;
  /** «Vino cu noi»: the next weekly run's page, or the listing (decision 5). */
  primary: { label: string; href: Href };
  /** The quiet partner: the calendar. */
  secondary: { label: string; href: Href };
  /** «Cum funcționează»: a club page the club named; null until it does, and then the button is not drawn. */
  tertiary?: { label: string; href: Href } | null;
  /**
   * The heading's element: the page's one `h1` on the site, a paragraph where the hero is a sample
   * among others (the design page's «Mostre»), so that page keeps its own one `h1`. Same look either way.
   */
  headingAs?: "h1" | "p";
};

/**
 * The home page's first screen (the facelift's phase 3, §714; `docs/REDESIGN.md` § The visual system):
 * the page's one `h1` with its last word in the accent (a `span`, never a gradient), one line under
 * it, two pill buttons with their arrows (a third, «Cum funcționează», once the club names its page) (`ArrowButtonLink`, §708) and the club's photograph.
 *
 * The words come first on a phone, so the first screen at 320 pixels is the heading and the buttons,
 * and the photograph follows; from `md` they sit side by side. The photograph is the one eager
 * picture on the page (`fetchpriority="high"`): it is what the largest-paint clock waits for, so it
 * is asked for before anything else and never lazily; every other picture on the page is lazy.
 *
 * A Server Component with typed props: no state, no element-valued prop (§370), tokens only.
 */
export default function Hero({ headline, subline, picture, primary, secondary, tertiary = null, headingAs = "h1" }: HeroProps) {
  return (
    <Box
      component="section"
      aria-labelledby="home-hero-title"
      data-testid="home-hero"
      sx={{
        display: "grid",
        gridTemplateColumns: { xs: "1fr", md: "minmax(0, 1fr) minmax(0, 1fr)" },
        gap: { xs: 2, md: 4 },
        alignItems: "center",
      }}
    >
      <Box sx={{ minWidth: 0 }}>
        <Typography
          variant="h1"
          component={headingAs}
          id="home-hero-title"
          sx={{ fontSize: { xs: "2rem", sm: "2.5rem", lg: "3.25rem" }, lineHeight: 1.1, overflowWrap: "anywhere", m: 0 }}
        >
          {headline.lead}
          {headline.accent && (
            <>
              {" "}
              <Box component="span" sx={{ color: "primary.main" }} data-testid="home-hero-accent">
                {headline.accent}
              </Box>
            </>
          )}
        </Typography>
        <Typography variant="body1" color="text.secondary" sx={{ mt: { xs: 1.5, md: 2 }, fontSize: { md: "1.125rem" }, maxWidth: "36em" }}>
          {subline}
        </Typography>
        <Box sx={{ mt: { xs: 2, md: 3 }, display: "flex", flexWrap: "wrap", gap: 1.5 }}>
          <ArrowButtonLink href={primary.href} label={primary.label} data-testid="home-hero-primary" />
          <ArrowButtonLink href={secondary.href} label={secondary.label} variant="outlined" data-testid="home-hero-secondary" />
          {tertiary && <ArrowButtonLink href={tertiary.href} label={tertiary.label} variant="outlined" data-testid="home-hero-tertiary" />}
        </Box>
      </Box>
      <Box sx={{ minWidth: 0, borderRadius: 2, overflow: "hidden" }}>
        <HomePicture picture={picture} eager testId="home-hero-picture" />
      </Box>
    </Box>
  );
}
