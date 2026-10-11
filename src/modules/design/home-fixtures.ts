import { formatDay } from "@/i18n/dates";
import type { Locale } from "@/i18n/routing";
import { splitHeadline } from "@/modules/appearance/domain/home-page";
import type { HomePageProps } from "@/modules/home/ui/HomePage";
import { SAMPLE_HOME_STEPS, SAMPLE_HOME_WHY, SAMPLE_WEATHER, sampleHomeFigures, sampleRace, sampleSeries } from "./fixtures";

/** A translator for one namespace, as `getTranslations` hands it back: the fixture asks the catalogue for its words. */
type Words = (key: string, values?: Record<string, string>) => string;

/**
 * The home page's first sections from the sample rows (§714): the props `Hero`, `NextRunCard` and
 * `RunCardGrid` take on the site, built from the same made-up events as the design page's cards
 * (`fixtures.ts`), with the empty photo slots the club starts from (never a stock picture, decision 6)
 * and the platform's own words from the catalogue (`home` is the `Home` namespace, `event` the `Event`
 * one). Nothing here is read from the database and nothing names a person: the repository is public.
 * A file of its own beside `fixtures.ts`, so the sections of the plan's part B keep theirs there.
 */
export function sampleHome(locale: Locale, home: Words, event: Words): HomePageProps {
  const series = sampleSeries(locale);
  const race = sampleRace(locale);
  const timeZone = series[0].timezone;
  const when = (startsAt: Date, position: "start" | "inline" = "start") => formatDay(startsAt, { locale, timeZone, style: "long", withTime: true, position });
  const weeklyTag = { kind: "weekly" as const, glyph: "repeat" as const, label: event("kind.weekly") };
  const specialTag = { kind: "special" as const, glyph: "type:RACE" as const, label: event("kind.special") };
  return {
    hero: {
      headline: splitHeadline(home("hero.headline")),
      subline: home("hero.subline"),
      picture: null,
      primary: { label: home("hero.join"), href: "/events" },
      secondary: { label: home("hero.calendar"), href: "/calendar" },
    },
    nextRun: {
      heading: home("nextRun.title"),
      slug: series[0].slug,
      title: series[0].title,
      when: when(series[0].startsAt),
      place: series[0].locationName,
      sunset: home("nextRun.sunset", { time: "18:58" }),
      weather: { glyph: SAMPLE_WEATHER.glyph, words: locale === "ro" ? "Averse, 9 °C" : "Showers, 9 °C" },
      picture: null,
      tag: weeklyTag,
    },
    weekly: {
      id: "weekly",
      title: home("weekly.title"),
      intro: home("weekly.intro"),
      cards: [
        {
          key: "sample-run",
          slug: series[0].slug,
          title: series[0].title,
          when: when(series[0].startsAt),
          detail: home("weekly.next", { when: when(series[0].startsAt, "inline") }),
          picture: null,
          tag: weeklyTag,
        },
      ],
      more: null,
    },
    special: {
      id: "special",
      title: home("special.title"),
      intro: home("special.intro"),
      cards: [{ key: "sample-race", slug: race.slug, title: race.title, when: when(race.startsAt), detail: race.locationName, picture: null, tag: specialTag }],
      more: { label: home("more") },
    },
    // The four lower sections from `fixtures.ts`'s samples; the strip has no picture, so the page draws none.
    steps: { content: SAMPLE_HOME_STEPS, locale, href: "/faq" },
    why: { content: SAMPLE_HOME_WHY, locale },
    strip: { content: { title: null }, pictures: [], instagram: null, locale },
    numbers: { figures: sampleHomeFigures(locale), locale },
  };
}
