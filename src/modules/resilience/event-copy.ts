import { getDb } from "@/db/client";
import type { Locale } from "@/i18n/routing";
import { findPublishedEventBySlug } from "@/modules/events/repository";
import { cachedPublishedEventBySlug } from "@/modules/public-cache/reads";
import { throughBreaker } from "./breaker";
import { readWithLastGood, type Resilient } from "./last-good";

/**
 * One published event by its slug, with its last good copy behind it (§447) — for the surfaces
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

const isSavedSlug = (slug: string) => slug.length <= 200 && SAVED_SLUG.test(slug);

export async function eventBySlugWithLastGood(locale: Locale, slug: string, now: Date = new Date()) {
  if (!isSavedSlug(slug)) return cachedPublishedEventBySlug(locale, slug);
  const read = await readWithLastGood(`event-row:${locale}:${slug}`, async () => (await cachedPublishedEventBySlug(locale, slug)) ?? null, now);
  return read.value ?? undefined;
}

export type RegistrationEvent = NonNullable<Awaited<ReturnType<typeof findPublishedEventBySlug>>>;

/**
 * The event the registration form is for, with its last good copy behind it (§447).
 *
 * Read from the database itself, as the form always was — it decides whether the form is offered,
 * so it is not answered from the public cache — but through the breaker, so a database this
 * instance already knows is away fails at once, and with a copy behind it under the same key the
 * `.ics` file and the pictures keep (`event-row:`; the same row, the same shape). While the
 * database is away the page is served from that copy with the resting notice and the form
 * disabled (`register/page.tsx`): nothing can be sent, and what a person typed before a refused
 * press comes back from the draft cookie. `stale` says so; with no copy the error page stands, as
 * for every other page (§281).
 */
export async function registrationEventWithLastGood(locale: Locale, slug: string, now: Date = new Date()): Promise<Resilient<RegistrationEvent | null>> {
  const load = async () => (await throughBreaker(() => findPublishedEventBySlug(getDb(), locale, slug))) ?? null;
  if (!isSavedSlug(slug)) return { value: await load(), freshness: "live", takenAt: now, restingUntil: null };
  return readWithLastGood(`event-row:${locale}:${slug}`, load, now);
}
