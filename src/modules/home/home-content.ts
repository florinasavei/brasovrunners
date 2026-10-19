import { getTranslations } from "next-intl/server";
import type { Locale } from "@/i18n/routing";
import { type HomePageSetting, buttonLabelIn, heroLines, splitHeadline } from "@/modules/appearance/domain/home-page";
import { nextWeeklyRun } from "@/modules/events/domain/next-weekly-run";
import { groupSeries, seriesLookup } from "@/modules/events/domain/series";
import type { PublicEvent } from "@/modules/events/repository";
import { pictureSizes, pictureSrcSet } from "@/modules/media/ladder";
import { getStorage, isStorageConfigured, objectKey } from "@/modules/media/storage";
import { cachedPublishedPages, cachedUpcomingEvents } from "@/modules/public-cache/reads";
import { readWithLastGood, type Resilient } from "@/modules/resilience/last-good";
import { readOrWhileAway } from "@/modules/resilience/optional-read";
import { readPublicComing } from "@/modules/rsvp/public-page";
import { forecastsForEvents } from "@/modules/weather/source";
import { clubSocialLinks } from "@/shared/ui/club-socials";
import { homeFigures } from "./domain/numbers";
import { type HomeCard, homeSections } from "./domain/sections";
import { type StripPicture, stripPictures } from "./strip-pictures";
import type { HomePictureSources } from "./ui/HomePicture";
import type { HomePageProps } from "./ui/HomePage";
import type { RunSectionCard } from "./ui/RunSection";

/**
 * Everything the home page draws, as the typed props of its components (§714): read once, on the
 * server, from what the site already reads — the listing's cached upcoming events (§333, with their
 * last good copy behind them, §447), the forecast's cached hour (§402), the setting the root already
 * read — so a visit the CDN does not answer still asks the database nothing new. The hero and the
 * lower sections get words and addresses; the three run sections get the listing's own rows, because
 * they draw the listing's own cards (§726), which read what they read on the listing — the same
 * cached availability entry per open race card (§409), never a query of their own. `HomePage` and its
 * sections are drawn from a fixture on the design page the same way.
 */
export type HomeContent = { props: HomePageProps; read: Resilient<PublicEvent[]> };

/** The hero's photograph from the setting: the same sources an event's cover gets (§414, §601), or the empty slot. */
export function heroPicture(setting: HomePageSetting): HomePictureSources | null {
  const hero = setting.hero;
  if (!hero || !isStorageConfigured()) return null;
  const src = getStorage().publicUrl(objectKey(hero.keyPrefix, "web"));
  return {
    src,
    srcSet: pictureSrcSet(src, hero.width),
    sizes: pictureSizes("hero", 100, hero.crop ? 1 / hero.crop.w : 1),
    width: hero.width,
    height: hero.height,
    crop: hero.crop,
  };
}

/**
 * The strip's pictures from the setting, in the club's order, as their `<img>` draws them — or none
 * with no store to name them in (a laptop without R2): an unset strip is not drawn, never a broken page.
 */
function stripOf(setting: HomePageSetting, alt: (n: number, total: number) => string): StripPicture[] {
  const chosen = setting.strip.pictures;
  if (chosen.length === 0 || !isStorageConfigured()) return [];
  return stripPictures(chosen.map((picture, index) => ({ id: picture.assetId, keyPrefix: picture.keyPrefix, width: picture.width, height: picture.height, alt: alt(index + 1, chosen.length) })));
}

/**
 * The published club pages, read once per render the way the header reads them (`SiteHeader.tsx`,
 * §447): the navigation's cached list with its last good copy behind it, and an empty list when even
 * that fails — so an outage drops a button, never the site's most-visited page.
 */
async function publishedPages(locale: Locale) {
  try {
    return (await readWithLastGood(`nav:pages:${locale}`, () => cachedPublishedPages(locale))).value;
  } catch {
    return [];
  }
}

/**
 * A club page chosen by its id, at its own address in the reader's language — or null while it is not
 * published there (a draft, or a page since unpublished): the button is then not drawn, never a 404.
 */
function clubPageHref(pageId: string | null, pages: Awaited<ReturnType<typeof publishedPages>>) {
  if (!pageId) return null;
  const page = pages.find((candidate) => candidate.id === pageId);
  return page ? { pathname: "/pages/[slug]" as const, params: { slug: page.slug } } : null;
}

export async function readHomeContent(locale: Locale, now: Date, setting: HomePageSetting): Promise<HomeContent> {
  const t = await getTranslations({ locale, namespace: "Home" });
  const tSections = await getTranslations({ locale, namespace: "HomeSections" });

  // The listing's own read (held to its clock window, §549), under a key of the home page's own.
  const read = await readWithLastGood(`home:events:${locale}`, () => cachedUpcomingEvents(locale, now), now);
  const upcoming = read.value;
  const sections = homeSections(upcoming);

  /*
    The listing's cards, as `events/page.tsx` hands them theirs (§726): a series' every date ahead,
    the forecast at the first one's start (§416) — one call for every card, the next run's included,
    each place asked once and nothing outside the seven days — and, for a date alone on its card, the
    series it belongs to, read off the whole list (§486), so that date still wears its series' chip.
  */
  const seriesOf = seriesLookup(upcoming);
  const shownCards = [...sections.weekly, ...sections.special];
  // «Următoarea alergare» is drawn as the listing would draw that date: its series' card when it belongs to a series (the whole series, as `groupSeries` holds it), else the date alone.
  const nextMembers: readonly PublicEvent[] = sections.next ? (groupSeries(upcoming).find((series) => series.members.some((member) => member.id === sections.next!.id))?.members ?? [sections.next]) : [];
  const forecasts = await forecastsForEvents([...nextMembers.slice(0, 1), ...shownCards.map((card) => card.members[0])], now);
  /*
    «N vin» (§815, last surface, §822): how many confirmed they come, for the upcoming events whose page offers the answer — read once for
    the page, never per card, through the same gate and the same cached reads the listing's chips use (`readPublicComing`), over the same
    list the listing reads, so the two share one cache entry and cannot disagree. Nothing is read while no event ahead is ticked; nothing
    while the database is away (a chip is not worth a page). The page is kept until the first offered event starts, when its chip goes.
  */
  const coming = await readOrWhileAway(() => readPublicComing(upcoming, now), new Map<string, number>());
  const cardOf = (key: string, members: readonly PublicEvent[]): RunSectionCard => ({
    key,
    members,
    weather: forecasts.get(members[0].id)?.start ?? null,
    // A series card never wears the chip: its dates do (§815). A date alone on its card wears its own count.
    comingCount: members.length === 1 ? (coming.get(members[0].id) ?? 0) : 0,
    // A date alone on its card still wears its series' chip (§486); a series card has its own dates.
    seriesDates: members.length > 1 ? undefined : seriesOf(members[0]),
  });
  const cardsOf = (cards: readonly HomeCard<PublicEvent>[]) => cards.map((card) => cardOf(card.key, card.members));

  // «Vino cu noi», the hero's first button: the next weekly run (§708, decision 5), else the listing.
  const weeklyRun = nextWeeklyRun(upcoming);
  const lines = heroLines(setting, locale);
  // The two «Cum funcționează» buttons: each a club page, at its own address in this language, or none.
  const pages = setting.buttons.how?.pageId || setting.steps.targetPageId ? await publishedPages(locale) : [];
  const howHref = clubPageHref(setting.buttons.how?.pageId ?? null, pages);
  const stepsHref = clubPageHref(setting.steps.targetPageId, pages);

  // «Următoarea alergare»: what the listing draws for that date — a series' card, or the single-date card.
  const nextRun: HomePageProps["nextRun"] = sections.next
    ? { id: "next-run", title: t("nextRun.title"), intro: null, cards: [cardOf(sections.next.id, nextMembers)], now, more: null }
    : null;

  const props: HomePageProps = {
    hero: {
      headline: splitHeadline(lines.headline ?? t("hero.headline")),
      subline: lines.subline ?? t("hero.subline"),
      picture: heroPicture(setting),
      primary: { label: buttonLabelIn(setting.buttons.join, locale) ?? t("hero.join"), href: weeklyRun ? { pathname: "/events/[slug]", params: { slug: weeklyRun.slug } } : "/events" },
      secondary: { label: buttonLabelIn(setting.buttons.calendar, locale) ?? t("hero.calendar"), href: "/calendar" },
      tertiary: howHref ? { label: buttonLabelIn(setting.buttons.how?.label ?? null, locale) ?? t("hero.how"), href: howHref } : null,
    },
    show: setting.sections,
    specialFirst: setting.specialFirst,
    nextRun,
    weekly: {
      id: "weekly",
      title: t("weekly.title"),
      intro: t("weekly.intro"),
      cards: cardsOf(sections.weekly),
      now,
      // The listing, under the weekly runs only when it holds more of them than the section shows.
      more: sections.moreWeekly > 0 ? { label: t("more") } : null,
    },
    special: {
      id: "special",
      title: t("special.title"),
      intro: t("special.intro"),
      cards: cardsOf(sections.special),
      now,
      // The listing holds every event: the link under the last section, whatever the counts.
      more: { label: t("more") },
    },
    steps: { content: setting.steps, locale, href: stepsHref },
    why: { content: setting.why, locale },
    strip: {
      content: { title: setting.strip.title },
      pictures: stripOf(setting, (n, total) => tSections("strip.photoAlt", { n, total })),
      // The club's Instagram from the footer's one list (§565): a link, never a feed.
      instagram: (await clubSocialLinks()).find((link) => link.network === "instagram") ?? null,
      locale,
    },
    // The figures from the club's two facts and the same upcoming events the cards read; none, no band.
    numbers: { figures: homeFigures(setting.numbers, upcoming, now), locale },
    freshness: read,
  };
  return { props, read };
}
