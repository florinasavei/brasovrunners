import Container from "@mui/material/Container";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { DEFAULT_SECTION_SHOWN, type HomeSectionKey } from "@/modules/appearance/domain/home-page";
import type { Resilient } from "@/modules/resilience/last-good";
import LastGoodNotice from "@/modules/resilience/ui/LastGoodNotice";
import { CLUB_NAME, PAGE_WIDTH } from "@/theme/brand";
import { DENSITY } from "@/theme/density";
import Hero, { type HeroProps } from "./Hero";
import NumbersBand, { type NumbersBandProps } from "./NumbersBand";
import PhotoStrip, { type PhotoStripProps } from "./PhotoStrip";
import RunSection, { type RunSectionProps } from "./RunSection";
import StepsBand, { type StepsBandProps } from "./StepsBand";
import WhyList, { type WhyListProps } from "./WhyList";

export type HomePageProps = {
  hero: HeroProps;
  /**
   * «Următoarea alergare», one listing card (§NNN); null when no run is ahead: the section is not
   * drawn, and the sections below say what there is.
   */
  nextRun: RunSectionProps | null;
  /** The weekly runs and the special events, each a section of the listing's own cards (§NNN). */
  weekly: RunSectionProps;
  special: RunSectionProps;
  /** «Prima dată»: the club's words or the platform's, and the club page «Cum funcționează» opens. */
  steps: StepsBandProps;
  /** «De ce» and the quote. */
  why: WhyListProps;
  /** The photo strip: the club's chosen pictures; none, and it is not drawn. */
  strip: PhotoStripProps;
  /** The numbers band: the figures that can be known; none, and it is not drawn. */
  numbers: NumbersBandProps;
  /**
   * Which sections are drawn (the club's switches, «Pagina principală»). A key left out takes the
   * setting's default: the first four on, the four lower ones off.
   */
  show?: Partial<Record<HomeSectionKey, boolean>>;
  /** How fresh the events are (§281): a last good copy says so above the hero. A fixture leaves it out. */
  freshness?: Pick<Resilient<unknown>, "freshness" | "takenAt" | "restingUntil">;
};

/**
 * The home page (the facelift's phase 3, §714; `docs/REDESIGN.md`, decision 3), in the plan's order:
 * the hero, the next run, the weekly runs, the special events, «Prima dată», «De ce» and the quote,
 * the photo strip and the numbers band — each a named Server Component with typed props under
 * `src/modules/home/ui/`, drawn with a fixture on the design page's «Mostre» (the owner's rule of
 * 2026-10-10: component-based, easy for whoever vibe-codes next). The three run sections draw the
 * listing's own cards (`RunSection` → `ListingCard`, §NNN), never cards of their own. A section the club switched off is
 * not drawn; a section with nothing true to show (no card, no picture, no figure) draws nothing itself.
 *
 * The page's one `main` and its one `h1`: the hero's, or — with the hero switched off — the same
 * headline in a visually hidden `h1` first in `main`, so the page never has none (a heading outline and
 * a screen reader's landmark need one). Works with scripts off: nothing here is an
 * island but the links the house already has.
 */
/** Out of sight, still read aloud and still in the outline (the usual clip, no `display: none`). */
const VISUALLY_HIDDEN = { position: "absolute", width: "1px", height: "1px", p: 0, m: "-1px", overflow: "hidden", clip: "rect(0 0 0 0)", whiteSpace: "nowrap", border: 0 } as const;

export default function HomePage({ hero, nextRun, weekly, special, steps, why, strip, numbers, show = {}, freshness }: HomePageProps) {
  const shown = (key: HomeSectionKey) => show[key] ?? DEFAULT_SECTION_SHOWN[key];
  const headline = [hero.headline.lead, hero.headline.accent].filter(Boolean).join(" ").trim() || CLUB_NAME;
  return (
    <Container id="main" component="main" maxWidth={PAGE_WIDTH} sx={{ py: { xs: DENSITY.pagePadY, sm: 4 } }} data-testid="home-page">
      {!shown("hero") && (
        <Typography variant="h1" data-testid="home-h1-hidden" sx={VISUALLY_HIDDEN}>
          {headline}
        </Typography>
      )}
      {freshness && <LastGoodNotice read={freshness} />}
      <Stack spacing={{ xs: 4, md: 6 }}>
        {shown("hero") && <Hero {...hero} />}
        {shown("nextRun") && nextRun && <RunSection {...nextRun} />}
        {shown("weekly") && <RunSection {...weekly} />}
        {shown("special") && <RunSection {...special} />}
        {shown("steps") && <StepsBand {...steps} />}
        {shown("why") && <WhyList {...why} />}
        {shown("strip") && <PhotoStrip {...strip} />}
        {shown("numbers") && <NumbersBand {...numbers} />}
      </Stack>
    </Container>
  );
}
