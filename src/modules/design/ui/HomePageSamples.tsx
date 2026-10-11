import Stack from "@mui/material/Stack";
import { getTranslations } from "next-intl/server";
import type { Locale } from "@/i18n/routing";
import Hero from "@/modules/home/ui/Hero";
import NextRunCard from "@/modules/home/ui/NextRunCard";
import RunCardGrid from "@/modules/home/ui/RunCardGrid";
import { sampleHome } from "../home-fixtures";

/**
 * «Mostre» → the home page's first sections (§NNN): `Hero`, `NextRunCard` and `RunCardGrid`, the very
 * components the site's root draws, from the sample rows (`home-fixtures.ts`) — the empty photo slots
 * the club starts from and the platform's own words. The hero's heading is a paragraph here, so the
 * design page keeps its one `h1`. Server Components throughout.
 */
export default async function HomePageSamples({ locale }: { locale: Locale }) {
  const home = sampleHome(locale, await getTranslations("Home"), await getTranslations("Event"));
  return (
    <Stack spacing={4} data-testid="design-home-page">
      <Hero {...home.hero} headingAs="p" />
      {home.nextRun && <NextRunCard {...home.nextRun} />}
      <RunCardGrid {...home.weekly} />
      <RunCardGrid {...home.special} />
    </Stack>
  );
}
