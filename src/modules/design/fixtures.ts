import { formatDay } from "@/i18n/dates";
import type { Locale } from "@/i18n/routing";
import { splitHeadline } from "@/modules/appearance/domain/home-page";
import type { PublicEvent } from "@/modules/events/repository";
import type { HomePageProps } from "@/modules/home/ui/HomePage";
import type { WeatherReading } from "@/modules/weather/domain/forecast";

/**
 * The sample rows the design-system page draws its cards and pills from (§692): made-up events
 * shaped like the listing's own (`listPublishedEvents`' rows), so `EventCard`, `SeriesCard` and
 * `buildRoutePills` render exactly what they render on the site. Nothing here is read from the
 * database and nothing names a person — the repository is public — and every word the club
 * would otherwise type is written once per language, both or neither.
 *
 * The dates are fixed so the page draws the same cards on every visit; `SAMPLE_NOW` is the
 * "today" the cards count from, one day before the first date.
 */
export const SAMPLE_NOW = new Date("2026-09-27T09:00:00.000Z");

const WORDS = {
  ro: {
    run: "Alergare de probă",
    runExcerpt: "O oră de alergare ușoară, în ritm de conversație. Ne vedem la fântână.",
    race: "Cursa de probă",
    raceExcerpt: "O cursă montană de probă, cu start din centru. Traseul e marcat.",
    night: "Alergare de seară",
    place: "Parcul Titulescu, la fântâna arteziană",
    square: "Piața Sfatului",
    partner: "Partener de probă",
  },
  en: {
    run: "Sample run",
    runExcerpt: "An hour of easy running at a talking pace. We meet at the fountain.",
    race: "Sample race",
    raceExcerpt: "A sample mountain race starting from the centre. The course is marked.",
    night: "Evening run",
    place: "Titulescu Park, at the fountain",
    square: "Council Square",
    partner: "Sample partner",
  },
} as const;

/** A group run's row, with every field the cards read; the type is the listing row's, as the card tests shape it. */
function row(locale: Locale, overrides: Partial<PublicEvent> = {}): PublicEvent {
  const words = WORDS[locale];
  return {
    id: "00000000-0000-4000-8000-000000000001",
    type: "GROUP_RUN",
    surface: "ASPHALT",
    eventStatus: "SCHEDULED",
    startsAt: new Date("2026-09-28T15:30:00Z"),
    endsAt: null,
    raceStartsAt: null,
    timezone: "Europe/Bucharest",
    mapUrl: null,
    routeUrl: null,
    stravaEventUrl: null,
    facebookEventUrl: null,
    coHosts: null,
    coHostName: null,
    coHostUrl: null,
    featured: false,
    isSpecial: false,
    distanceMeters: 8000,
    elevationGainMeters: 120,
    registrationMode: "NONE",
    registrationOpensAt: null,
    registrationClosesAt: null,
    externalRegistrationUrl: null,
    externalProvider: null,
    minAge: 14,
    slug: "sample-run-0",
    title: words.run,
    excerpt: words.runExcerpt,
    excerptJson: null,
    locationName: words.place,
    locationAddress: null,
    locationToBeAnnounced: false,
    difficultyLevel: 5,
    costType: "FREE",
    costAmount: null,
    costUrl: null,
    publishedAt: SAMPLE_NOW,
    ...overrides,
  } as PublicEvent;
}

/** Three Mondays at 18:30 — one series card (§113). */
export function sampleSeries(locale: Locale): PublicEvent[] {
  return ["2026-09-28T15:30:00Z", "2026-10-05T15:30:00Z", "2026-10-12T15:30:00Z"].map((startsAt, index) =>
    row(locale, { id: `00000000-0000-4000-8000-00000000001${index}`, slug: `sample-run-${index}`, startsAt: new Date(startsAt) }),
  );
}

/**
 * A race held with a partner, on trail, with the distance and the climb marked approximate — the
 * single-date card, and the featured one when the page asks (§470).
 */
export function sampleRace(locale: Locale): PublicEvent {
  const words = WORDS[locale];
  return row(locale, {
    id: "00000000-0000-4000-8000-000000000002",
    slug: "sample-race",
    type: "RACE",
    surface: "TRAIL",
    title: words.race,
    excerpt: words.raceExcerpt,
    startsAt: new Date("2026-11-21T08:00:00Z"),
    raceStartsAt: new Date("2026-11-21T08:00:00Z"),
    locationName: words.square,
    distanceMeters: 21000,
    distanceEstimated: true,
    elevationGainMeters: 650,
    elevationGainEstimated: true,
    difficultyLevel: 11,
    isSpecial: true,
    costType: "PAID",
    costAmount: "80",
    coHosts: [{ name: words.partner, links: [] }],
  } as Partial<PublicEvent>);
}

/** An evening run in December, on mixed ground, by donation: the night pill and the third surface. */
export function sampleNightRun(locale: Locale): PublicEvent {
  const words = WORDS[locale];
  return row(locale, {
    id: "00000000-0000-4000-8000-000000000003",
    slug: "sample-evening-run",
    title: words.night,
    surface: "MIXED",
    startsAt: new Date("2026-12-15T18:00:00Z"),
    distanceMeters: 5000,
    elevationGainMeters: null,
    difficultyLevel: 2,
    costType: "DONATION",
  });
}

/** One hour of a made-up forecast: a cloud, nine degrees, a likely shower. */
export const SAMPLE_WEATHER: WeatherReading = {
  hourAt: new Date("2026-09-28T15:00:00Z").getTime(),
  code: 80,
  kind: "showers",
  glyph: "showers",
  temperatureC: 9.4,
  precipitationProbability: 60,
  windKmh: 12,
  feelsLikeC: 7.1,
  precipitationMm: 0.8,
  gustKmh: 25,
  humidity: 82,
  uvIndex: 1,
};

/** A translator for one namespace, as `getTranslations` hands it back: the fixture asks the catalogue for its words. */
type Words = (key: string, values?: Record<string, string>) => string;

/**
 * The home page's sections from the sample rows (§NNN): the props `HomePage`, `Hero`, `NextRunCard`
 * and `RunCardGrid` take on the site, built from the same made-up events as the cards above, with
 * the empty photo slots the club starts from (no picture is a stock one, decision 6) and the
 * platform's own words from the catalogue (`home` is the `Home` namespace, `event` the `Event` one).
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
      empty: home("weekly.empty"),
      more: null,
    },
    special: {
      id: "special",
      title: home("special.title"),
      intro: home("special.intro"),
      cards: [{ key: "sample-race", slug: race.slug, title: race.title, when: when(race.startsAt), detail: race.locationName, picture: null, tag: specialTag }],
      empty: home("special.empty"),
      more: { label: home("more") },
    },
  };
}

/** A team card's person, with no photograph: the no-photo state. */
export function sampleTeamMember(locale: Locale): { name: string; role: string } {
  return locale === "ro" ? { name: "Membru A", role: "Antrenor" } : { name: "Member A", role: "Coach" };
}
