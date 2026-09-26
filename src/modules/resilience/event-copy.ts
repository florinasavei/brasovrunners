import type { Locale } from "@/i18n/routing";
import { cachedPublishedEventBySlug } from "@/modules/public-cache/reads";
import { readWithLastGood } from "./last-good";

/**
 * One published event by its slug, with its last good copy behind it (§NNN) — for the surfaces
 * that carry an event without being its page: the `.ics` file, the Open Graph picture a link
 * preview draws, the picture to save for Instagram. Each used to answer 500 while the database
 * was away, which is exactly when a runner re-shares the race or re-adds it to a calendar; now
 * they answer from the same kind of copy the event page does (§281). No notice: a file and a
 * picture have nowhere to put one, and they say nothing the page does not.
 *
 * "No such event" is kept as an answer too (null), exactly as the page keeps it: a slug that was
 * unpublished must stay a 404 during an outage, never come back from an older copy. Only a slug of
 * the shape a saved slug has names a copy; anything else is asked plainly and kept nowhere, so a
 * crawler guessing addresses cannot fill the store (`public-cache/reads.ts#readBySlug`'s rule).
 */
const SAVED_SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export async function eventBySlugWithLastGood(locale: Locale, slug: string, now: Date = new Date()) {
  if (slug.length > 200 || !SAVED_SLUG.test(slug)) return cachedPublishedEventBySlug(locale, slug);
  const read = await readWithLastGood(`event-row:${locale}:${slug}`, async () => (await cachedPublishedEventBySlug(locale, slug)) ?? null, now);
  return read.value ?? undefined;
}
