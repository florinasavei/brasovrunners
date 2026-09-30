import Container from "@mui/material/Container";
import type { Metadata } from "next";
import { hasLocale } from "next-intl";
import { setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { getPathname } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";
import { sportsEventJsonLd } from "@/modules/events/structured-data";
import EventPageView from "@/modules/events/ui/EventPageView";
import { absoluteUrl, eventPageUrl } from "@/modules/events/share-links";
import { datedOrNull } from "@/modules/events/domain/dated";
import { registrationState } from "@/modules/events/domain/registration-window";
import {
  cachedCurrentApprovedDocument,
  cachedPublishedEventBySlug,
  cachedPublishedTranslations,
} from "@/modules/public-cache/reads";
import { parseInterestOutcome, parseInterestSince } from "@/modules/registrations/interest-box";
import { CLUB_TIME_ZONE } from "@/i18n/dates";
import { nextWallMidnight } from "@/modules/events/domain/page-clock";
import { holdPageUntil } from "@/modules/public-cache/page-lifetime";
import { forecastForEvent } from "@/modules/weather/source";
import { env } from "@/shared/config/env";
import { readWithLastGood } from "@/modules/resilience/last-good";
import LastGoodNotice from "@/modules/resilience/ui/LastGoodNotice";
import { readOrWhileAway } from "@/modules/resilience/optional-read";
import { pageAlternates, slugRouteUrls } from "@/modules/seo/alternates";
import JsonLd from "@/shared/ui/JsonLd";
import { CLUB_NAME, PAGE_WIDTH } from "@/theme/brand";
import { DENSITY } from "@/theme/density";

type Props = {
  params: Promise<{ locale: string; slug: string }>;
  /**
   * The address's query — `?lista=`, `?interest=`, `?since=`, `?declaratie=` — passed only by the
   * live twin (`app/[locale]/live/events/[slug]/page.tsx`), which the proxy sends such a visit to
   * (§549). This static route never reads Next's `searchParams`.
   */
  query?: Promise<EventQuery>;
  /**
   * Whether the signed-in reader may edit the words (§135) — the twin asks the session, for a visit
   * that carries a session cookie; the static copy every stranger is served never shows the button.
   * The editor asserts the role again for itself (BR-REQ-060-01).
   */
  canEdit?: boolean;
  /**
   * A members' event (§552), read for a members' session — passed only by the live twin, which a
   * signed-in visitor is sent to (§549). Asked only when the public read found nothing. The static
   * copy has none: a members' row is withheld from the public read in SQL, so a stranger, and the
   * CDN's copy, get the 404 an unpublished page gives (§28).
   */
  membersRead?: () => Promise<PublishedEvent | undefined>;
};

type PublishedEvent = NonNullable<Awaited<ReturnType<typeof cachedPublishedEventBySlug>>>;

type EventQuery = { interest?: string | string[]; since?: string | string[]; lista?: string | string[]; declaratie?: string | string[] };

/** One value of a query key, as the page's readers expect it: the first, when the address repeats it. */
const one = (value: string | string[] | undefined): string | undefined => (Array.isArray(value) ? value[0] : value);

/**
 * Static for an anonymous visitor at its bare address, made on its first visit and kept by the CDN
 * (§549, amending §333). Organizers publish and cancel events between deploys: every write that
 * changes the event, its places or its start list expires the page through the rows' own tags
 * (§333), so a cancelled run is never served as scheduled. The clock is kept the same way: the page
 * is made again when its door opens or closes, the confirmation or weather window opens, the start
 * list closes, at midnight (the countdown's day), and — while the forecast shows — within the
 * weather's hour. Nothing is prerendered at build (no database in CI).
 *
 * What depends on the reader is the live twin's: `?lista=`, `?interest=`, `?declaratie=`, and a
 * session cookie for the staff edit button (`i18n/live-twin.ts`). A literal, as Next requires: it
 * equals `PUBLIC_PAGE_CEILING_SECONDS` (a test holds them together).
 */
export const revalidate = 86400;

/** Made on its first visit, never at build: no slug is known before the database is asked (§549). */
export function generateStaticParams(): { slug: string }[] {
  return [];
}



/** Absolute URL for this event in a given locale, always derived from APP_BASE_URL. */
function eventUrl(locale: "ro" | "en", slug: string): string {
  return eventPageUrl(env.APP_BASE_URL, locale, slug);
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale, slug } = await params;
  if (!hasLocale(routing.locales, locale)) return {};

  // The head says nothing rather than failing the page while the database is away (§447): the
  // body's own read decides between its last good copy and the resting page.
  const event = await readOrWhileAway(() => cachedPublishedEventBySlug(locale, slug), undefined);
  if (!event) return {};

  return {
    title: event.seoTitle ?? event.title,
    description: event.seoDescription ?? event.excerpt ?? undefined,
    /*
      Its own canonical, never another date's: a date of a series is its own page, with its own
      places, holds and start list, and it is what the series card's date chips link to (§113,
      §342 canonical and hreflang). The canonical carries no query — `?lista=`, `?interest=` and
      `?since=` are the same page. BR-REQ-040-01 criterion 5: each alternate points at *that
      locale's own slug*, looked up from the database through the public cache (§333) — never
      this slug under another prefix, which is a 404 — and only a published locale appears
      (BR-REQ-040-02); `x-default` is the Romanian one.
    */
    alternates: pageAlternates(
      locale,
      slugRouteUrls(env.APP_BASE_URL, "/events/[slug]", await readOrWhileAway(() => cachedPublishedTranslations(event.id), [])),
    ),
    openGraph: {
      title: event.seoTitle ?? event.title,
      description: event.seoDescription ?? event.excerpt ?? undefined,
      url: eventUrl(locale, slug),
      type: "website",
    },
  };
}

export default async function EventDetailPage({ params, query, canEdit = false, membersRead }: Props) {
  const { locale, slug } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);
  const asked: EventQuery = (await query) ?? {};
  const [interest, since, lista, declaratie] = [one(asked.interest), one(asked.since), one(asked.lista), one(asked.declaratie)];

  const now = new Date();
  // The countdown and the day's words (§76, §78): the static page is made again at midnight (§549).
  await holdPageUntil([nextWallMidnight(now, CLUB_TIME_ZONE)], now);
  /*
    The page's facts, with the last copy of them behind it (§281).

    Both reads sit inside one loader, so a page served from a copy is internally consistent —
    the event and whether it may take an address were true at the same moment. `notFound()` is
    called on the *result*, outside: throwing it in here would be caught by the fallback and
    answered with the previous visitor's page, turning a 404 into a wrong 200.
  */
  const read = await readWithLastGood(
    `event:${locale}:${slug}`,
    async () => {
      const found = await cachedPublishedEventBySlug(locale, slug);
      if (!found) return { event: null, interestBox: false };
      // "Tell me when registration opens" (§146) takes an address, and an address is taken only
      // under an approved privacy notice — the registration form's own rule (BR-REQ-053-01). One
      // read, only while there is a box to show. The box's own action asks the database again
      // before it keeps an address; this only decides whether to draw it.
      const interestBox =
        found.registrationMode === "INTERNAL" &&
        registrationState(found, now) === "NOT_YET_OPEN" &&
        (await cachedCurrentApprovedDocument("PRIVACY_NOTICE", locale, now)) !== undefined;
      return { event: found, interestBox };
    },
    now,
  );
  /*
    An event for the members alone (§552): the public read above never meets one, so a slug it did
    not find is asked once more — by the live twin only, for a members' session, live, never through
    the public cache or the last good copy, both shared by every visitor (`events/members-only.ts`).
    The static copy asks nobody: a stranger gets the 404 an unpublished page gives (§28), never a
    sentence that the event exists.
  */
  const membersEvent = read.value.event || !membersRead ? undefined : await membersRead();
  const event = read.value.event ?? membersEvent ?? null;
  // No «Anunță-mă» on a members' event: its box is a public form, and a member is told by the zone.
  const interestBox = membersEvent ? false : read.value.interestBox;
  const membersOnly = membersEvent !== undefined;
  // An unknown slug, or one whose translation is still Draft or In review, is a 404 — never a
  // redirect to the other locale (BR-REQ-020-01 criterion 1, BR-REQ-040-02).
  if (!event) notFound();
  // The event's own dates are told on its own wall clock (`raceWeek`, §78): in another zone its day
  // turns at that zone's midnight, and the page is made again then too (§549).
  await holdPageUntil([nextWallMidnight(now, event.timezone)], now);

  const interestOutcome = parseInterestOutcome(interest);
  // A staff member who may edit the words gets the way into the editor from here (§135; the
  // owner: "when I am signed in … I should be able to edit events from the event page"). The live
  // twin reads the session and says so (§549); the editor asserts the role again for itself
  // (BR-REQ-060-01). Never on the static copy.
  const editHref = canEdit ? getPathname({ locale, href: { pathname: "/admin/events/[id]", params: { id: event.id } } }) : null;
  // The forecast for the start (§402): read on the server, from Open-Meteo through the data cache,
  // only within seven days of it; null — and no row — otherwise or when the service did not answer.
  // An event whose date is to be announced (§533) has no forecast, no structured data (a
  // `SportsEvent` requires its `startDate`), no calendar entry and no countdown: `dated` is null.
  const dated = datedOrNull(event);
  const weather = dated ? await forecastForEvent(dated, now) : null;
  return (
    <Container id="main" component="main" maxWidth={PAGE_WIDTH} sx={{ py: { xs: DENSITY.pagePadY, sm: 3 } }}>
      {/* No structured data for a members' event (§552): nothing on its page is for a search engine. */}
      {dated && !membersOnly && (
      <JsonLd
        data={sportsEventJsonLd(
          dated,
          eventUrl(locale, slug),
          CLUB_NAME,
          [absoluteUrl(env.APP_BASE_URL, `/${locale}/events/${slug}/opengraph-image`), absoluteUrl(env.APP_BASE_URL, `/${locale}/events/${slug}/share-image`)],
          // The page's language, for what a partnership is (§352) — said in this language or not at all.
          locale,
        )}
      />
      )}

      <LastGoodNotice read={read} />

      {/* The page itself: the one body the editor's preview before saving draws too (§NNN). */}
      <EventPageView
        event={event}
        locale={locale}
        slug={slug}
        now={now}
        weather={weather}
        membersOnly={membersOnly}
        editHref={editHref}
        visit={{
          interestBox,
          interestOutcome,
          // A corrected address is timed from the render the person is correcting, not from the redirect.
          interestRenderedAt: (interestOutcome === "invalid" && parseInterestSince(since, now)) || now,
          declaratie,
          lista,
        }}
      />
    </Container>
  );
}
