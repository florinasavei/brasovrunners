import type { Locale } from "@/i18n/routing";
import { splitHeadline } from "@/modules/appearance/domain/home-page";
import type { HomePageProps } from "@/modules/home/ui/HomePage";
import { SAMPLE_HOME_STEPS, SAMPLE_HOME_WHY, SAMPLE_NOW, SAMPLE_WEATHER, sampleHomeFigures, sampleRace, sampleSeries } from "./fixtures";

/** A translator for one namespace, as `getTranslations` hands it back: the fixture asks the catalogue for its words. */
type Words = (key: string, values?: Record<string, string>) => string;

/**
 * The home page's sections from the sample rows (§714): the props `Hero` and the three `RunSection`s
 * take on the site, built from the same made-up events as the design page's cards (`fixtures.ts`) —
 * the run sections hand the listing's own cards those rows (§NNN): the next run gets its series'
 * card, as `readHomeContent` gives it for a date of a series, the weekly runs the same series, the
 * special events the race —
 * with the hero's empty photo slot the club starts from (never a stock picture, decision 6) and the
 * platform's own words from the catalogue (`home` is the `Home` namespace). Nothing here is read from
 * the database and nothing names a person: the repository is public. A file of its own beside
 * `fixtures.ts`, so the sections of the plan's part B keep theirs there.
 */
export function sampleHome(locale: Locale, home: Words): HomePageProps {
  const series = sampleSeries(locale);
  const race = sampleRace(locale);
  return {
    hero: {
      headline: splitHeadline(home("hero.headline")),
      subline: home("hero.subline"),
      picture: null,
      primary: { label: home("hero.join"), href: "/events" },
      secondary: { label: home("hero.calendar"), href: "/calendar" },
    },
    nextRun: {
      id: "next-run",
      title: home("nextRun.title"),
      intro: null,
      cards: [{ key: "sample-run", members: series, weather: SAMPLE_WEATHER }],
      now: SAMPLE_NOW,
      more: null,
    },
    weekly: {
      id: "weekly",
      title: home("weekly.title"),
      intro: home("weekly.intro"),
      cards: [{ key: "sample-run", members: series, weather: SAMPLE_WEATHER }],
      now: SAMPLE_NOW,
      more: null,
    },
    special: {
      id: "special",
      title: home("special.title"),
      intro: home("special.intro"),
      cards: [{ key: "sample-race", members: [race] }],
      now: SAMPLE_NOW,
      more: { label: home("more") },
    },
    // The four lower sections from `fixtures.ts`'s samples; the strip has no picture, so the page draws none.
    steps: { content: SAMPLE_HOME_STEPS, locale, href: "/faq" },
    why: { content: SAMPLE_HOME_WHY, locale },
    strip: { content: { title: null }, pictures: [], instagram: null, locale },
    numbers: { figures: sampleHomeFigures(locale), locale },
  };
}
