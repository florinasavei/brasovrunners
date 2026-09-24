import { getDb } from "@/db/client";
import type { LegalDocumentKey } from "@/db/schema/legal-documents";
import { parseLocalizedPath } from "@/i18n/alternate-path";
import type { Locale } from "@/i18n/routing";
import { contactFormReaches } from "@/modules/contact/delivery";
import { readContactRecipients } from "@/modules/contact/recipients";
import { findPublishedAlbumBySlug, listPublishedAlbums } from "@/modules/content/gallery/repository";
import { findPublishedPageBySlug, listPublishedPages } from "@/modules/content/pages/repository";
import type { EventType } from "@/modules/events/domain/event-type";
import { resolveLocaleSwitch } from "@/modules/events/locale-switch";
import {
  findEventForRegistrationById,
  findLatestPastEvent,
  findPublishedEventBySlug,
  findPublishedTranslations,
  listPastEvents,
  listPublishedEventEndings,
  listPublishedEvents,
  listPublishedEventsBetween,
  listUpcomingEvents,
} from "@/modules/events/repository";
import { findCurrentApprovedDocument, listEffectiveDates } from "@/modules/legal-documents/repository";
import { DEFAULT_BOT_CHECK, readBotCheck } from "@/modules/registrations/bot-check";
import {
  countAnonymousStartListEntries,
  countPublicStartList,
  listPlaceCountInstants,
  listPublicStartList,
} from "@/modules/registrations/repository";
import { readPublicPlaces } from "@/modules/registrations/service";
import { turnstileSiteKey } from "@/modules/registrations/turnstile";
import { env } from "@/shared/config/env";
import { publicRead } from "./cache";
import { clockWindow } from "./clock";

/**
 * Every read a public page makes, through the data cache (`DECISIONS.md` §NNN).
 *
 * One file on purpose. The cache tells two reads apart by their key alone, so the keys have to be
 * unique across the application, and the only way to keep them unique is to keep them together.
 * It is also the list to check when a public page starts showing something new: a read that is
 * not in here wakes the database for every visitor, which is what this whole module is for.
 *
 * Each function is the repository function of the same name, without the database handle. The
 * queries are unchanged — the cache is in front of them, not instead of them — so what a page
 * shows is exactly what it showed before.
 */

// --- Events -----------------------------------------------------------------------------------

/**
 * The stretch of time `now` falls in for the listing's three queries, named by the next moment
 * an event stops being upcoming (`clock.ts`). The endings are cached on their own: they depend on
 * the rows, never on the clock.
 */
async function listingWindow(locale: Locale, now: Date): Promise<string> {
  const endings = await publicRead(["events.endings", locale], ["events"], () => listPublishedEventEndings(getDb(), locale));
  return clockWindow(endings, now, "passed");
}

/** `listUpcomingEvents`: what the listing leads with. */
export async function cachedUpcomingEvents(locale: Locale, now: Date) {
  const window = await listingWindow(locale, now);
  return publicRead(["events.upcoming", locale, window], ["events"], () => listUpcomingEvents(getDb(), locale, now));
}

/** `findLatestPastEvent`: the listing's last resort between seasons (§167). */
export async function cachedLatestPastEvent(locale: Locale, now: Date) {
  const window = await listingWindow(locale, now);
  return publicRead(["events.latest-past", locale, window], ["events"], () => findLatestPastEvent(getDb(), locale, now));
}

/** `listPastEvents`: the folded section at the foot of the listing (§267). */
export async function cachedPastEvents(locale: Locale, now: Date, limit: number, type?: EventType) {
  const window = await listingWindow(locale, now);
  return publicRead(["events.past", locale, window, limit, type ?? "all"], ["events"], () =>
    listPastEvents(getDb(), locale, now, limit, type),
  );
}

/** `listPublishedEventsBetween`: one month or one year of the calendar. No clock: the range is the key. */
export async function cachedPublishedEventsBetween(locale: Locale, from: Date, to: Date) {
  return publicRead(["events.between", locale, from.toISOString(), to.toISOString()], ["events"], () =>
    listPublishedEventsBetween(getDb(), locale, from, to),
  );
}

/** `findPublishedEventBySlug`: the event page, its metadata, its pictures and its `.ics`. */
export async function cachedPublishedEventBySlug(locale: Locale, slug: string) {
  return publicRead(["events.by-slug", locale, slug], ["events"], () => findPublishedEventBySlug(getDb(), locale, slug));
}

/** `findPublishedTranslations`: the event page's `hreflang` alternates. */
export async function cachedPublishedTranslations(eventId: string) {
  return publicRead(["events.translations", eventId], ["events"], () => findPublishedTranslations(getDb(), eventId));
}

/**
 * The sitemap's events: the address and the publication date, and nothing else.
 *
 * Narrowed before it is cached, because every published event is a lot of rich text to keep for
 * two fields — and Vercel refuses to cache an entry over two megabytes, which a few seasons of
 * weekly runs with their descriptions would reach.
 */
export async function cachedSitemapEvents(locale: Locale) {
  return publicRead(["events.sitemap", locale], ["events"], async () =>
    (await listPublishedEvents(getDb(), locale)).map((event) => ({ slug: event.slug, publishedAt: event.publishedAt })),
  );
}

// --- Places: what registrations change on a public page ---------------------------------------

/**
 * `readPublicAvailability` — the allocator's own formula (`AGENTS.md` §10.6), cached.
 *
 * Not a copy of the count and not a recent one: every registration that moves expires it
 * (`repository.ts#transitionRegistration` and the few writes beside it), an event save expires
 * it, and the inputs that change with the clock — a waiting-list offer lapsing, and on an event
 * whose line has a limit a declaration hold lapsing (`listPlaceCountInstants`) — are in the
 * key. So the number served is the number the formula gives for this instant. It is still a
 * page render and not a decision: the form and the allocator count again, under the lock.
 *
 * `availablePlaces` is `null` for an uncapped event, and for one that no longer exists; `capacity`
 * is the event's own number of places, off the same row, for the "din 50 de locuri" (§NNN).
 * `waitlistRoom` is how many more the waiting list takes (§NNN), null when it has no limit; and
 * `waitlistCapacity` the limit itself, null for none and 0 for no waiting list at all. The room
 * is counted from the same two counts as the places, and an offer lapsing — the key's clock —
 * frees a slot in the line exactly when it frees a place.
 */
export async function cachedPublicAvailability(eventId: string, now: Date): Promise<CachedPublicPlaces> {
  const instants = await publicRead(["places.count-instants", eventId], ["places", "events"], () =>
    listPlaceCountInstants(getDb(), eventId),
  );
  const window = clockWindow(instants, now, "reached");
  return publicRead(["places.available", eventId, window], ["places", "events"], async () => {
    const db = getDb();
    const event = await findEventForRegistrationById(db, eventId);
    if (!event) return { availablePlaces: null, capacity: null, waitlistRoom: null, waitlistCapacity: null };
    const places = await readPublicPlaces(db, event, now);
    return { ...places, capacity: event.capacity, waitlistCapacity: event.capacity === null ? null : event.waitlistCapacity };
  });
}

/** `cachedPublicAvailability`'s answer: the free places, the event's size, and the line's room. */
export type CachedPublicPlaces = {
  availablePlaces: number | null;
  capacity: number | null;
  waitlistRoom: number | null;
  waitlistCapacity: number | null;
};

/** The two counts the public start list pages by (§250): named, and left off at their request. */
export async function cachedStartListCounts(eventId: string): Promise<{ named: number; anonymous: number }> {
  return publicRead(["places.start-list-counts", eventId], ["places", "events"], async () => {
    const db = getDb();
    const [named, anonymous] = await Promise.all([countPublicStartList(db, eventId), countAnonymousStartListEntries(db, eventId)]);
    return { named, anonymous };
  });
}

/** One page of `listPublicStartList` — names and clubs, which is all it has ever selected. */
export async function cachedStartListPage(eventId: string, offset: number, limit: number) {
  return publicRead(["places.start-list", eventId, offset, limit], ["places", "events"], () =>
    listPublicStartList(getDb(), eventId, { offset, limit }),
  );
}

// --- Legal texts ------------------------------------------------------------------------------

/**
 * `findCurrentApprovedDocument` for a public page: the terms, the privacy notice, and whether an
 * event page may offer the "tell me when it opens" box. Keyed by the stretch between effective
 * dates, so a version approved ahead of time takes over on its day.
 *
 * Only for display. Registration asks the database itself, because refusing a registration is a
 * decision (BR-REQ-053-01).
 */
export async function cachedCurrentApprovedDocument(key: LegalDocumentKey, locale: Locale, now: Date) {
  const dates = await publicRead(["legal.effective-dates", key], ["legal"], () => listEffectiveDates(getDb(), key));
  const window = clockWindow(dates, now, "reached");
  return publicRead(["legal.current", key, locale, window], ["legal"], () => findCurrentApprovedDocument(getDb(), key, locale, now));
}

// --- Standing pages and the gallery -----------------------------------------------------------

/** `listPublishedPages`: the navigation on every page, and the sitemap. */
export async function cachedPublishedPages(locale: Locale) {
  return publicRead(["pages.published", locale], ["pages"], () => listPublishedPages(getDb(), locale));
}

/** `findPublishedPageBySlug`: one standing page. */
export async function cachedPublishedPageBySlug(locale: Locale, slug: string) {
  return publicRead(["pages.by-slug", locale, slug], ["pages"], () => findPublishedPageBySlug(getDb(), locale, slug));
}

/** `listPublishedAlbums`: the gallery, the "Galerie" entry in the navigation, the sitemap. */
export async function cachedPublishedAlbums(locale: Locale) {
  return publicRead(["gallery.published", locale], ["gallery"], () => listPublishedAlbums(getDb(), locale));
}

/** `findPublishedAlbumBySlug`: one album, its photos, and the event it is from — hence `events` too. */
export async function cachedPublishedAlbumBySlug(locale: Locale, slug: string) {
  return publicRead(["gallery.by-slug", locale, slug], ["gallery", "events"], () => findPublishedAlbumBySlug(getDb(), locale, slug));
}

// --- Settings ---------------------------------------------------------------------------------

/**
 * Whether the contact form reaches anybody (`contactFormReaches`), for the header's "Contact"
 * entry and the contact page (§164).
 *
 * The answer is cached, not the list: the addresses the club named are nobody's business but the
 * sender's, and the two pages only ever needed the yes or no. When the database cannot say, the
 * setting counts as naming nobody and the deployment's own list answers — what
 * `readContactRecipientsOrNull` gives both pages. Sending a message reads the setting itself.
 */
export async function cachedContactFormReaches(): Promise<boolean> {
  try {
    return await publicRead(["settings.contact-reaches"], ["settings"], async () =>
      contactFormReaches(env, await readContactRecipients(getDb())),
    );
  } catch {
    return contactFormReaches(env, null);
  }
}

/**
 * The Turnstile site key the contact page draws its widget with, or nothing (§254) — on when the
 * database cannot answer, as `botCheckIsOn` is. Verifying a submission reads the switch itself.
 */
export async function cachedBotCheckSiteKey(): Promise<string | undefined> {
  let enabled: boolean;
  try {
    enabled = (await publicRead(["settings.bot-check"], ["settings"], () => readBotCheck(getDb()))).enabled;
  } catch {
    enabled = DEFAULT_BOT_CHECK.enabled;
  }
  return enabled ? turnstileSiteKey() : undefined;
}

// --- The language switch ----------------------------------------------------------------------

/** The routes whose other-language address only the database knows: a slug per language. */
const SLUG_ROUTES = new Set(["/events/[slug]", "/events/[slug]/register", "/gallery/[slug]", "/pages/[slug]"]);

/**
 * Where the language switcher lands (`resolveLocaleSwitch`), cached per address.
 *
 * **Only the addresses with a slug in them.** Every other route is answered without the
 * database, so there is nothing to cache — and one of those is an email link, whose path *is* a
 * secret: it must never become a cache key, which is stored and logged where a token has no
 * business being (`AGENTS.md` §12.8). The address is also the visitor's own input, so one of an
 * unreasonable length is answered live rather than filling the cache with whatever was typed.
 */
export async function cachedLocaleSwitch(from: string, target: Locale): Promise<string> {
  const route = parseLocalizedPath(from)?.route;
  if (!route || !SLUG_ROUTES.has(route) || from.length > 300) return resolveLocaleSwitch(getDb(), from, target);
  return publicRead(["locale-switch", target, from], ["events", "pages", "gallery"], () => resolveLocaleSwitch(getDb(), from, target));
}
