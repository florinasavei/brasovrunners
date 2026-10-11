import Stack from "@mui/material/Stack";
import { getTranslations } from "next-intl/server";
import type { Locale } from "@/i18n/routing";
import Hero from "@/modules/home/ui/Hero";
import RunSection from "@/modules/home/ui/RunSection";
import { sampleHome } from "../home-fixtures";

/**
 * «Mostre» → the home page's first sections (§714): `Hero` and the three `RunSection`s, the very
 * components the site's root draws, from the sample rows (`home-fixtures.ts`) — the hero's empty
 * photo slot the club starts from, the platform's own words, and the run sections drawn with the
 * listing's own cards (`ListingCard`, §NNN). The hero's heading is a paragraph here, so the design
 * page keeps its one `h1`. Server Components throughout.
 */
export default async function HomePageSamples({ locale }: { locale: Locale }) {
  const home = sampleHome(locale, await getTranslations("Home"));
  return (
    <Stack spacing={4} data-testid="design-home-page">
      <Hero {...home.hero} headingAs="p" />
      {home.nextRun && <RunSection {...home.nextRun} />}
      <RunSection {...home.weekly} />
      <RunSection {...home.special} />
    </Stack>
  );
}
