import type { Metadata } from "next";
import { hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { redirect } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";
import { sportsOrganizationJsonLd } from "@/modules/events/structured-data";
import { readHomeContent } from "@/modules/home/home-content";
import HomePage from "@/modules/home/ui/HomePage";
import { cachedHomePage } from "@/modules/public-cache/reads";
import { pageAlternates, staticRouteUrl, staticRouteUrls } from "@/modules/seo/alternates";
import { env } from "@/shared/config/env";
import JsonLd from "@/shared/ui/JsonLd";
import { CLUB_NAME } from "@/theme/brand";

type Props = { params: Promise<{ locale: string }> };

/**
 * The site's root: the home page while «Pagina principală» is on, the listing otherwise (§NNN,
 * amending §353 and §251; `docs/REDESIGN.md`, decision 3).
 *
 * **Off** — the default, and what a database without the row reads — the root answers a **307** to
 * the listing (`/ro` → `/ro/evenimente`), as it always led there. Temporary, no longer §353's 308: a
 * permanent redirect is kept by browsers for good, so a visitor who had once opened the root would
 * keep landing on the listing after the club switched the home page on. The proxy no longer answers
 * the root itself (it cannot read a setting without waking the database on the site's most-visited
 * address): this page does, and since it is static the redirect is decided once, kept by the CDN as
 * a redirect (Next's redirect document, about 66 KB, not an empty page), and made again when the setting is saved.
 *
 * **On** — the home page: the hero, the next run, the weekly runs and the special events, then the
 * four lower sections the club switched on («Prima dată», «De ce», the photo strip, the numbers)
 * (`modules/home/ui/`), reached from the logo and never from a menu entry. It is canonical to itself
 * in each language, and the sitemap lists it first (`app/sitemap.ts`).
 *
 * Static, made on its first visit and kept by the CDN (§549): the same for every visitor. It reads the
 * setting and the listing's own upcoming events from the public cache, so it is made again when the
 * setting is saved, when an event is written or ends (the listing's clock window), when a club page is
 * published or withdrawn (the navigation's list, which «Cum funcționează» reads), at the forecast's
 * hour, and at the latest after a day. It reads no `searchParams`: `?utm_…` and every other query is
 * the same static page. A literal, as Next requires: `PUBLIC_PAGE_CEILING_SECONDS`.
 */
export const revalidate = 86400;

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) return {};
  if (!(await cachedHomePage()).on) return {};
  const t = await getTranslations({ locale, namespace: "Home" });
  return {
    // The club's name first, from its one constant (§369): the root is where a search result names the club.
    title: { absolute: t("meta.title", { club: CLUB_NAME }) },
    description: t("meta.description"),
    alternates: pageAlternates(locale, staticRouteUrls(env.APP_BASE_URL, "/")),
  };
}

export default async function RootPage({ params }: Props) {
  const { locale } = await params;
  // BR-REQ-040-02: an unknown locale is a 404, not a redirect into the default language.
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);

  const setting = await cachedHomePage();
  // Off: the listing, as before — a temporary redirect, so switching the home page on is seen at once.
  if (!setting.on) redirect({ href: "/events", locale });

  const now = new Date();
  const { props } = await readHomeContent(locale, now, setting);
  return (
    <>
      {/* BR-REQ-052-02 criterion 1: the home page carries the club's one SportsOrganization block. */}
      <JsonLd data={sportsOrganizationJsonLd(CLUB_NAME, staticRouteUrl(env.APP_BASE_URL, "/", locale))} />
      <HomePage {...props} />
    </>
  );
}
