import Container from "@mui/material/Container";
import Stack from "@mui/material/Stack";
import type { Resilient } from "@/modules/resilience/last-good";
import LastGoodNotice from "@/modules/resilience/ui/LastGoodNotice";
import { PAGE_WIDTH } from "@/theme/brand";
import { DENSITY } from "@/theme/density";
import Hero, { type HeroProps } from "./Hero";
import NextRunCard, { type NextRunCardProps } from "./NextRunCard";
import RunCardGrid, { type RunCardGridProps } from "./RunCardGrid";

export type HomePageProps = {
  hero: HeroProps;
  /** Null when no run is ahead: the card is not drawn, and the sections below say what there is. */
  nextRun: NextRunCardProps | null;
  weekly: RunCardGridProps;
  special: RunCardGridProps;
  /** How fresh the events are (§281): a last good copy says so above the hero. A fixture leaves it out. */
  freshness?: Pick<Resilient<unknown>, "freshness" | "takenAt" | "restingUntil">;
};

/**
 * The home page (the facelift's phase 3, part A, §NNN; `docs/REDESIGN.md`, decision 3): the hero, the
 * next run, the weekly runs and the special events — each a named Server Component with typed props
 * under `src/modules/home/ui/`, drawn with a fixture on the design page's «Mostre» (the owner's rule
 * of 2026-10-10: component-based, easy for whoever vibe-codes next). Part B adds the band «Prima
 * dată», «De ce», the photo strip and the numbers under these, each the same way.
 *
 * The page's one `main` and its one `h1` (the hero's). Works with scripts off: nothing here is an
 * island but the links the house already has.
 */
export default function HomePage({ hero, nextRun, weekly, special, freshness }: HomePageProps) {
  return (
    <Container id="main" component="main" maxWidth={PAGE_WIDTH} sx={{ py: { xs: DENSITY.pagePadY, sm: 4 } }} data-testid="home-page">
      {freshness && <LastGoodNotice read={freshness} />}
      <Stack spacing={{ xs: 4, md: 6 }}>
        <Hero {...hero} />
        {nextRun && <NextRunCard {...nextRun} />}
        <RunCardGrid {...weekly} />
        <RunCardGrid {...special} />
        {/*
          Part B's four sections go here, in the plan's order, each with its own typed props
          (`feat/home-sections`, wired by the phase's third chain): «Prima dată» (`StepsBand`), «De ce»
          and the quote (`WhyList`), the photo strip (`PhotoStrip`), the numbers band (`NumbersBand`).
        */}
      </Stack>
    </Container>
  );
}
