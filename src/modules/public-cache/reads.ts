import { getDb } from "@/db/client";
import type { LegalDocumentKey } from "@/db/schema/legal-documents";
import { parseLocalizedPath } from "@/i18n/alternate-path";
import { routing, type Locale } from "@/i18n/routing";
import { contactFormReaches } from "@/modules/contact/delivery";
import { readContactRecipients } from "@/modules/contact/recipients";
import {
  findPublishedAlbumBySlug,
  findPublishedAlbumTranslations,
  findPublishedAlbumTranslationsForAlbums,
  listPublishedAlbums,
} from "@/modules/content/gallery/repository";
import {
  findPublishedPageBySlug,
  findPublishedPageTranslations,
  findPublishedPageTranslationsForPages,
  listPublishedPages,
} from "@/modules/content/pages/repository";
import { resolveLocaleSwitch } from "@/modules/events/locale-switch";
import {
  findEventForRegistrationById,
  findLatestPastEvent,
  findPublishedEventBySlug,
  findPublishedTranslations,
  findPublishedTranslationsForEvents,
  listPastEvents,
  listPublishedEventEndings,
  listPublishedEvents,
  listPublishedEventsBetween,
  listUpcomingEvents,
} from "@/modules/events/repository";
import { readDeadlines } from "@/modules/deadlines/deadlines";
import { DEFAULT_DEADLINES, type Deadlines } from "@/modules/deadlines/domain/deadlines";
import { describesListStates } from "@/modules/legal-documents/domain/merge-fields";
import { findCurrentApprovedDocument, findFirstStatesNoticeVersion, listEffectiveDates } from "@/modules/legal-documents/repository";
import { DEFAULT_BOT_CHECK, readBotCheck } from "@/modules/registrations/bot-check";
import {
  countAnonymousStartListEntries,
  countPublicStartList,
  countPublicStartListOthers,
  listPlaceCountInstants,
  listPublicStartList,
  listPublicStartListOthers,
} from "@/modules/registrations/repository";
import { readPublicPlaces } from "@/modules/registrations/service";
import { familyRegistrationOpen } from "@/modules/registrations/family-gate";
import { EXPECTED_MIGRATION } from "@/db/schema-version";
import { turnstileSiteKey } from "@/modules/registrations/turnstile";
import { env } from "@/shared/config/env";
import { type PublicContent, publicRead } from "./cache";
import { clockWindow } from "./clock";

/**
 * Every read a public page makes, through the data cache (`DECISIONS.md` §333).
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

// --- The visitor's slug -----------------------------------------------------------------------

/**
 * What a slug has to look like before it may name a cache entry: the shape every slug the
 * backoffice saves already has — lowercase words joined by single hyphens (`fields.ts` for events,
 * pages and albums) — and a length no saved slug comes near (they stop at 120).
 */
const CACHEABLE_SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const CACHEABLE_SLUG_MAX_LENGTH = 200;

/**
 * One read by the slug in the address — cached when the slug could be a real one, live otherwise.
 *
 * The slug is the visitor's own input, and a miss is an answer like any other: "no such event"
 * would stand for the day's ceiling under the key it was asked by. A crawler trying addresses at
 * random would leave one entry per address, which is the language switch's problem too
 * (`cachedLocaleSwitch` refuses a path over 300 characters). A slug of the wrong shape or length
 * can name no row, so it is answered by the database, exactly as before, and filed nowhere.
 */
function readBySlug<T>(
  slug: string,
  key: readonly (string | number)[],
  contents: readonly PublicContent[],
  load: () => Promise<T>,
): Promise<T> {
  if (slug.length > CACHEABLE_SLUG_MAX_LENGTH || !CACHEABLE_SLUG.test(slug)) return load();
  return publicRead(key, contents, load);
}

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

/**
 * `listPastEvents`: the folded section at the foot of the listing (§267). Never narrowed by kind
 * here: the listing reads one window whatever the address ticks and filters it in memory (§413),
 * so there is one entry per language and clock window — the page's one `limit` — and no filter
 * combination can mint entries of its own.
 */
export async function cachedPastEvents(locale: Locale, now: Date, limit: number) {
  const window = await listingWindow(locale, now);
  return publicRead(["events.past", locale, window, limit], ["events"], () => listPastEvents(getDb(), locale, now, limit));
}

/** `listPublishedEventsBetween`: one month or one year of the calendar. No clock: the range is the key. */
export async function cachedPublishedEventsBetween(locale: Locale, from: Date, to: Date) {
  return publicRead(["events.between", locale, from.toISOString(), to.toISOString()], ["events"], () =>
    listPublishedEventsBetween(getDb(), locale, from, to),
  );
}

/** `findPublishedEventBySlug`: the event page, its metadata, its pictures and its `.ics`. */
export async function cachedPublishedEventBySlug(locale: Locale, slug: string) {
  return readBySlug(slug, ["events.by-slug", locale, slug], ["events"], () => findPublishedEventBySlug(getDb(), locale, slug));
}

/** `findPublishedTranslations`: the event page's `hreflang` alternates. */
export async function cachedPublishedTranslations(eventId: string) {
  return publicRead(["events.translations", eventId], ["events"], () => findPublishedTranslations(getDb(), eventId));
}

/**
 * The sitemap's events: the address, the publication date and every published locale's own slug
 * (the entry's `hreflang` alternates, §342 canonical and hreflang), and nothing else.
 *
 * Narrowed before it is cached, because every published event is a lot of rich text to keep for
 * three fields — and Vercel refuses to cache an entry over two megabytes, which a few seasons of
 * weekly runs with their descriptions would reach. The alternates come from one query for the
 * whole list, grouped here, never one query per event.
 */
export async function cachedSitemapEvents(locale: Locale) {
  return publicRead(["events.sitemap", locale], ["events"], async () => {
    const db = getDb();
    const rows = await listPublishedEvents(db, locale);
    const translations = groupById(
      await findPublishedTranslationsForEvents(db, rows.map((event) => event.id)),
      (row) => row.eventId,
    );
    return rows.map((event) => ({
      slug: event.slug,
      publishedAt: event.publishedAt,
      translations: translations.get(event.id) ?? [],
    }));
  });
}

/**
 * Groups a flat "one row per (id, locale)" read into `id → its locales and slugs` — what turns
 * "one lookup per event/page/album" into one lookup for the whole sitemap (§342 canonical and
 * hreflang). The id is left off each row: the cache keeps only what the sitemap prints.
 */
function groupById<T extends { locale: Locale; slug: string }>(
  rows: readonly T[],
  idOf: (row: T) => string,
): Map<string, Array<{ locale: Locale; slug: string }>> {
  const groups = new Map<string, Array<{ locale: Locale; slug: string }>>();
  for (const row of rows) {
    const id = idOf(row);
    const group = groups.get(id) ?? [];
    group.push({ locale: row.locale, slug: row.slug });
    groups.set(id, group);
  }
  return groups;
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
 * One entry carries everything the door says about places, so every line beside the button comes
 * from one internal read and one cache entry — never a second formula, and never a query per
 * visitor:
 * - `available`: the free places (`readPublicPlaces`, the allocator's formula);
 * - `capacity`: the event's own number of places, off the very row the formula counted, for
 *   "12 înscriși din 50 de locuri" (§346 public fill count);
 * - `waitlistRoom`: how many more the waiting list takes (§350 waiting-list length), `null` when
 *   it has no limit, counted from the same two counts as the places — an offer lapsing, the key's
 *   clock, frees a slot in the line exactly when it frees a place;
 * - `waitlistCapacity`: the limit itself, `null` for none and 0 for no waiting list at all.
 *
 * `null` for an uncapped event, which shows no number and never waitlists anybody, and for one
 * that no longer exists.
 */
export async function cachedPublicAvailability(eventId: string, now: Date): Promise<PublicAvailability | null> {
  const instants = await publicRead(["places.count-instants", eventId], ["places", "events"], () =>
    listPlaceCountInstants(getDb(), eventId),
  );
  const window = clockWindow(instants, now, "reached");
  return publicRead(["places.available", eventId, window], ["places", "events"], async () => {
    const db = getDb();
    const event = await findEventForRegistrationById(db, eventId);
    if (!event || event.capacity === null) return null;
    const places = await readPublicPlaces(db, event, now);
    if (places.availablePlaces === null) return null;
    return {
      available: places.availablePlaces,
      capacity: event.capacity,
      waitlistRoom: places.waitlistRoom,
      waitlistCapacity: event.waitlistCapacity,
    };
  });
}

/**
 * What `cachedPublicAvailability` answers for a capped event: its free places, its size, and the
 * waiting list's room and limit (§346, §350 waiting-list length).
 */
export type PublicAvailability = {
  available: number;
  capacity: number;
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

/**
 * How many of the ticked pending and waiting rows the list gains behind the notice's gate
 * (§396) — `countPublicStartListOthers`, expired by the same "places" tag every change of state
 * and every change of the tick expires. Only registrations made under the first notice that
 * described the states, or a later one (§421): the version is in the key, so the approval of a
 * notice can never serve a count computed against another line.
 */
export async function cachedStartListOthersCounts(eventId: string, firstStatesNoticeVersion: number): Promise<{ pending: number; waitlisted: number }> {
  return publicRead(["places.start-list-others-counts", eventId, firstStatesNoticeVersion], ["places", "events"], () =>
    countPublicStartListOthers(getDb(), eventId, firstStatesNoticeVersion),
  );
}

/** One page of `listPublicStartListOthers` — a name, a club and a group, nothing else. */
export async function cachedStartListOthersPage(eventId: string, firstStatesNoticeVersion: number, offset: number, limit: number) {
  return publicRead(["places.start-list-others", eventId, firstStatesNoticeVersion, offset, limit], ["places", "events"], () =>
    listPublicStartListOthers(getDb(), eventId, firstStatesNoticeVersion, { offset, limit }),
  );
}

/**
 * The first approved privacy notice that described the list's states (`findFirstStatesNoticeVersion`,
 * §421), or null — the line below which a tick was given under a notice promising confirmed names
 * only. Expired with every legal text (an approval, a withdrawal, a deletion).
 */
export async function cachedFirstStatesNoticeVersion(): Promise<number | null> {
  return publicRead(["legal.first-states-notice"], ["legal"], () => findFirstStatesNoticeVersion(getDb()));
}

/**
 * Whether the public list may show the states, and the pending and waiting groups (§396): the
 * privacy notice in force describes them (`describesListStates`), in every language. Read
 * through `cachedCurrentApprovedDocument`, so an approval expires it and a version approved for
 * a later day takes over on that day — exactly when the notice itself changes on
 * `/confidentialitate`, never before. `noticeDescribesListStates` is the backoffice's uncached twin.
 */
export async function cachedListStatesDisclosed(now: Date): Promise<boolean> {
  const notices = await Promise.all(routing.locales.map((locale) => cachedCurrentApprovedDocument("PRIVACY_NOTICE", locale, now)));
  return notices.every((notice) => notice !== undefined && describesListStates(notice.body));
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
  return readBySlug(slug, ["pages.by-slug", locale, slug], ["pages"], () => findPublishedPageBySlug(getDb(), locale, slug));
}

/** `findPublishedPageTranslations`: a standing page's `hreflang` alternates (§342 canonical and hreflang). */
export async function cachedPublishedPageTranslations(pageId: string) {
  return publicRead(["pages.translations", pageId], ["pages"], () => findPublishedPageTranslations(getDb(), pageId));
}

/** The sitemap's standing pages: the address, the last change and the alternates — `cachedSitemapEvents`' shape. */
export async function cachedSitemapPages(locale: Locale) {
  return publicRead(["pages.sitemap", locale], ["pages"], async () => {
    const db = getDb();
    const rows = await listPublishedPages(db, locale);
    const translations = groupById(
      await findPublishedPageTranslationsForPages(db, rows.map((page) => page.id)),
      (row) => row.pageId,
    );
    return rows.map((page) => ({ slug: page.slug, updatedAt: page.updatedAt, translations: translations.get(page.id) ?? [] }));
  });
}

/** `listPublishedAlbums`: the gallery, the "Galerie" entry in the navigation. */
export async function cachedPublishedAlbums(locale: Locale) {
  return publicRead(["gallery.published", locale], ["gallery"], () => listPublishedAlbums(getDb(), locale));
}

/** `findPublishedAlbumBySlug`: one album, its photos, and the event it is from — hence `events` too. */
export async function cachedPublishedAlbumBySlug(locale: Locale, slug: string) {
  return readBySlug(slug, ["gallery.by-slug", locale, slug], ["gallery", "events"], () =>
    findPublishedAlbumBySlug(getDb(), locale, slug),
  );
}

/** `findPublishedAlbumTranslations`: an album's `hreflang` alternates (§342 canonical and hreflang). */
export async function cachedPublishedAlbumTranslations(albumId: string) {
  return publicRead(["gallery.translations", albumId], ["gallery"], () => findPublishedAlbumTranslations(getDb(), albumId));
}

/** The sitemap's albums: the address, the last change and the alternates — `cachedSitemapEvents`' shape. */
export async function cachedSitemapAlbums(locale: Locale) {
  return publicRead(["gallery.sitemap", locale], ["gallery"], async () => {
    const db = getDb();
    const rows = await listPublishedAlbums(db, locale);
    const translations = groupById(
      await findPublishedAlbumTranslationsForAlbums(db, rows.map((album) => album.id)),
      (row) => row.albumId,
    );
    return rows.map((album) => ({ slug: album.slug, updatedAt: album.updatedAt, translations: translations.get(album.id) ?? [] }));
  });
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

/**
 * The club's deadlines (§377) for the public pages that state them — the form's five steps, the
 * countdown on the listing, the "check your email" screen, the terms and the privacy notice — from
 * the data cache, so a visitor reading "the link is valid 48 hours" wakes nothing. A save expires
 * it (`updateDeadlines`). When the database cannot answer, today's constants: the same numbers an
 * unset setting has, and never a page that fails over a sentence.
 */
export async function cachedDeadlines(): Promise<Deadlines> {
  try {
    return (await publicRead(["settings.deadlines"], ["settings"], () => readDeadlines(getDb()))).deadlines;
  } catch {
    return { ...DEFAULT_DEADLINES };
  }
}

/**
 * Whether one address may carry a family at an event yet (§389, `registrations/family-gate.ts`),
 * for the one line of the five steps that says how — never promised before the schema allows it.
 * Keyed by the migration this build was compiled against, so the release that drops the old
 * constraint asks afresh rather than reading yesterday's "no"; the day's ceiling bounds the rest.
 * When the database cannot answer, "not yet": the line is left out, and nothing is promised.
 */
export async function cachedFamilyRegistrationOpen(): Promise<boolean> {
  try {
    return await publicRead(["registrations.family-open", EXPECTED_MIGRATION.tag ?? ""], ["settings"], () => familyRegistrationOpen(getDb()));
  } catch {
    return false;
  }
}

// --- The language switch ----------------------------------------------------------------------

/** The routes whose other-language address only the database knows: a slug per language. */
const SLUG_ROUTES = new Set(["/events/[slug]", "/events/[slug]/register", "/events/[slug]/declaration", "/gallery/[slug]", "/pages/[slug]"]);

/**
 * Where the language switcher lands (`resolveLocaleSwitch`), cached per address.
 *
 * **Only the addresses with a slug in them.** Every other route is answered without the
 * database, so there is nothing to cache — and one of those is an email link, whose path *is* a
 * secret: it must never become a cache key, which is stored and logged where a token has no
 * business being (`AGENTS.md` §12.8). The address is also the visitor's own input, so one of an
 * unreasonable length is answered live rather than filling the cache with whatever was typed.
 *
 * **Keyed by the path alone.** The query string changes nothing about where the switch lands —
 * `parseLocalizedPath` drops it and the answer never carries it — so `?interest=ok`, `?lista=2`
 * or a campaign's `?utm_…` on the same event page is one entry, not one per variant a visitor or
 * a crawler happens to send.
 */
export async function cachedLocaleSwitch(from: string, target: Locale): Promise<string> {
  const path = from.split("?")[0];
  const route = parseLocalizedPath(path)?.route;
  if (!route || !SLUG_ROUTES.has(route) || path.length > 300) return resolveLocaleSwitch(getDb(), from, target);
  return publicRead(["locale-switch", target, path], ["events", "pages", "gallery"], () => resolveLocaleSwitch(getDb(), path, target));
}
