import { getTranslations } from "next-intl/server";
import { formatDay } from "@/i18n/dates";
import type { Locale } from "@/i18n/routing";
import { type HomePageSetting, buttonLabelIn, heroLines, splitHeadline } from "@/modules/appearance/domain/home-page";
import { coverSources } from "@/modules/events/cover";
import { coverTag } from "@/modules/events/domain/event-kind";
import type { EventType } from "@/modules/events/domain/event-type";
import { nextWeeklyRun } from "@/modules/events/domain/next-weekly-run";
import { recurrenceOf } from "@/modules/events/domain/series";
import { clubNightEvent } from "@/modules/events/night-event";
import type { PublicEvent } from "@/modules/events/repository";
import { recurrenceSentence } from "@/modules/events/ui/series-sentence";
import { type PictureColumn, pictureSizes, pictureSrcSet } from "@/modules/media/ladder";
import { getStorage, isStorageConfigured, objectKey } from "@/modules/media/storage";
import { cachedPublishedPages, cachedUpcomingEvents } from "@/modules/public-cache/reads";
import { readWithLastGood, type Resilient } from "@/modules/resilience/last-good";
import { forecastsForEvents } from "@/modules/weather/source";
import { weatherWords } from "@/modules/weather/words";
import { clubSocialLinks } from "@/shared/ui/club-socials";
import { homeFigures } from "./domain/numbers";
import { type HomeCard, homeSections } from "./domain/sections";
import { type StripPicture, stripPictures } from "./strip-pictures";
import type { HomePictureSources } from "./ui/HomePicture";
import type { HomePageProps } from "./ui/HomePage";
import type { RunCardItem } from "./ui/RunCardGrid";
import type { RunTagProps } from "./ui/RunTag";

/**
 * Everything the home page draws, as the typed props of its components (§NNN): read once, on the
 * server, from what the site already reads — the listing's cached upcoming events (§333, with their
 * last good copy behind them, §447), the forecast's cached hour (§402), the setting the root already
 * read — so a visit the CDN does not answer still asks the database nothing new. The components get
 * words and addresses, never a row: `HomePage` and its sections are drawn from a fixture on the design
 * page the same way.
 */
export type HomeContent = { props: HomePageProps; read: Resilient<PublicEvent[]> };

/** A cover or the hero, as an `img` draws it — or null when there is none, or no store to name it in. */
function pictureOf(cover: unknown, column: PictureColumn): HomePictureSources | null {
  try {
    const sources = coverSources(cover, column);
    return sources ? { src: sources.src, srcSet: sources.srcSet, sizes: sources.sizes, width: sources.width, height: sources.height, crop: sources.crop } : null;
  } catch {
    // A cover with no store configured to name it in (a laptop without R2): an empty slot, never a broken page.
    return null;
  }
}

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
 * A club page chosen by its id, at its own address in the reader's language — or null while it is not
 * published there (a draft, or a page since unpublished): the button is then not drawn, never a 404.
 * Read from the navigation's own cached list of published pages, so it asks the database nothing new.
 */
async function clubPageHref(pageId: string | null, locale: Locale) {
  if (!pageId) return null;
  const page = (await cachedPublishedPages(locale)).find((candidate) => candidate.id === pageId);
  return page ? { pathname: "/pages/[slug]" as const, params: { slug: page.slug } } : null;
}

/** The place in words, or null while it is to be announced (§328) or unnamed. */
const placeOf = (event: PublicEvent): string | null => (event.locationToBeAnnounced ? null : (event.locationName ?? null));

export async function readHomeContent(locale: Locale, now: Date, setting: HomePageSetting): Promise<HomeContent> {
  const t = await getTranslations({ locale, namespace: "Home" });
  const tEvent = await getTranslations({ locale, namespace: "Event" });
  const tSections = await getTranslations({ locale, namespace: "HomeSections" });

  // The listing's own read (held to its clock window, §549), under a key of the home page's own.
  const read = await readWithLastGood(`home:events:${locale}`, () => cachedUpcomingEvents(locale, now), now);
  const upcoming = read.value;
  const sections = homeSections(upcoming);

  const tagOf = (event: PublicEvent): RunTagProps => {
    const tag = coverTag({ seriesCadence: event.seriesCadence, type: event.type as EventType });
    return { kind: tag.kind, glyph: tag.glyph, label: tEvent(tag.labelKey) };
  };
  const when = (event: PublicEvent, position: "start" | "inline" = "start") =>
    formatDay(event.startsAt, { locale, timeZone: event.timezone, style: "long", withTime: true, position });

  // «Vino cu noi»: the next weekly run, as the header's button reads it (§708, decision 5), else the listing.
  const weeklyRun = nextWeeklyRun(upcoming);
  const lines = heroLines(setting, locale);
  // The two «Cum funcționează» buttons: each a club page, at its own address in this language, or none.
  const howHref = await clubPageHref(setting.buttons.how?.pageId ?? null, locale);
  const stepsHref = await clubPageHref(setting.steps.targetPageId, locale);

  let nextRun: HomePageProps["nextRun"] = null;
  if (sections.next) {
    const next = sections.next;
    const forecast = (await forecastsForEvents([next], now)).get(next.id)?.start ?? null;
    const words = forecast ? weatherWords(forecast, locale) : null;
    const sunset = clubNightEvent(next).sunset;
    nextRun = {
      heading: t("nextRun.title"),
      slug: next.slug,
      title: next.title,
      when: when(next),
      place: placeOf(next),
      sunset: sunset ? t("nextRun.sunset", { time: sunset }) : null,
      weather: forecast && words ? { glyph: forecast.glyph, words: [words.summary, words.temperature].filter(Boolean).join(", ") } : null,
      picture: pictureOf(next.cover, "hero"),
      tag: tagOf(next),
    };
  }

  const cardOf = async (card: HomeCard<PublicEvent>): Promise<RunCardItem> => {
    const shown = card.shown;
    const ahead = card.members.filter((member) => member.eventStatus !== "CANCELLED");
    // A weekly run says its rhythm and then its next date; a date alone (or a special event) says when and where.
    const rhythm = card.kind === "weekly" && recurrenceOf(ahead, shown.timezone).kind === "weekly";
    return {
      key: card.key,
      slug: shown.slug,
      title: shown.title,
      when: rhythm ? await recurrenceSentence(ahead, shown.timezone, locale) : when(shown),
      detail: rhythm ? t("weekly.next", { when: when(shown, "inline") }) : placeOf(shown),
      picture: pictureOf(shown.cover, "homeCard"),
      tag: tagOf(shown),
    };
  };

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
    nextRun,
    weekly: {
      id: "weekly",
      title: t("weekly.title"),
      intro: t("weekly.intro"),
      cards: await Promise.all(sections.weekly.map(cardOf)),
      // The listing, under the weekly runs only when it holds more of them than the section shows.
      more: sections.moreWeekly > 0 ? { label: t("more") } : null,
    },
    special: {
      id: "special",
      title: t("special.title"),
      intro: t("special.intro"),
      cards: await Promise.all(sections.special.map(cardOf)),
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
