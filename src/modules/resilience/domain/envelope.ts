/**
 * The last good answer to one public read, and how it is written down (`DECISIONS.md` §281; the
 * owner, 2026-09-22: "I want to gracefully handle DB failures … we want the website to keep
 * running so that we don't break our reputation").
 *
 * ## What this is for
 *
 * Every public page reads the database per request (`force-dynamic`, and deliberately: an event
 * cancelled between deploys must not still read as scheduled). The cost of that is that a
 * database the club cannot reach — Neon suspended, a bad minute on the provider, a migration
 * mid-flight — takes the whole site's content with it, and a stranger meets an error page on the
 * week they were deciding whether to enter a race.
 *
 * Since §333 the rows come through the public cache first (`modules/public-cache/`), which every
 * write expires; an outage then costs nothing while the cache holds the answer, and this copy is
 * what stands behind a cache miss that finds the database away.
 *
 * So each public read keeps its last good answer, and serves it if the database cannot be
 * reached. Normally nothing is stale at all: the snapshot is consulted **only** when the live
 * read throws.
 *
 * ## Why the envelope carries when it was taken
 *
 * Because a page served from one must say so. `takenAt` is what the banner reads, and what the
 * capacity rule leans on: a stale page never states a number of free places (§281), and the
 * reader is told the page is the last copy the site had rather than being quietly shown old
 * facts as current ones.
 *
 * ## Why the dates are tagged
 *
 * The values are rows: an event carries `startsAt`, a legal version carries `approvedAt`, and
 * `JSON.stringify` turns each into a string that `JSON.parse` never turns back. A page that
 * received a string where it expects a `Date` would throw inside the fallback — the one place
 * that must not throw. So a `Date` is written as `{"__date":"…"}` and read back as a `Date`,
 * and nothing else about the shape is touched.
 */

export type Envelope<T> = {
  /** When the live read that produced this succeeded. */
  takenAt: Date;
  value: T;
};

/** Written into the store: the envelope, with every `Date` inside it tagged. */
export type StoredEnvelope = { takenAt: string; value: unknown };

const DATE_KEY = "__date";

/**
 * Exported for the public cache (`modules/public-cache/cache.ts`, §333), which stores the same
 * rows as JSON for the same reason and must hand back a `Date` wherever the database did.
 */
export function tagDates(value: unknown): unknown {
  if (value instanceof Date) return { [DATE_KEY]: value.toISOString() };
  if (Array.isArray(value)) return value.map(tagDates);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, inner]) => [key, tagDates(inner)]));
  }
  return value;
}

export function untagDates(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(untagDates);
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    const tagged = record[DATE_KEY];
    if (typeof tagged === "string" && Object.keys(record).length === 1) {
      const date = new Date(tagged);
      // An unreadable date is left as the string it was rather than becoming `Invalid Date`,
      // which renders as the words "Invalid Date" on a page somebody is reading.
      return Number.isNaN(date.getTime()) ? tagged : date;
    }
    return Object.fromEntries(Object.entries(record).map(([key, inner]) => [key, untagDates(inner)]));
  }
  return value;
}

/** The envelope as the bytes that are stored. Total: anything unserializable is not stored. */
export function writeEnvelope<T>(envelope: Envelope<T>): string | null {
  try {
    return JSON.stringify({ takenAt: envelope.takenAt.toISOString(), value: tagDates(envelope.value) });
  } catch {
    // A value carrying a cycle or a function is not a row this site reads — and a snapshot that
    // cannot be written is not a failure worth surfacing on a page that worked.
    return null;
  }
}

/**
 * The stored bytes as an envelope, or `null` when they are not one.
 *
 * Deliberately total, for the same reason `readEmailBody` is: this is read on the path where the
 * database is already gone, and a parse that throws there would replace a stale page with the
 * error page the whole mechanism exists to avoid.
 */
export function readEnvelope<T>(raw: string | null | undefined): Envelope<T> | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as StoredEnvelope;
    if (!parsed || typeof parsed.takenAt !== "string") return null;
    const takenAt = new Date(parsed.takenAt);
    if (Number.isNaN(takenAt.getTime())) return null;
    return { takenAt, value: untagDates(parsed.value) as T };
  } catch {
    return null;
  }
}

/**
 * How old a snapshot may be and still be shown, in hours.
 *
 * Twelve, not unlimited: a page from three days ago could be advertising a race that has since
 * been called off, and "the site kept working" is not worth telling somebody to come to an event
 * that is not happening. Past that, the error page — which says the site is having trouble — is
 * the honest answer. Twelve hours covers every outage this platform has any business surviving:
 * a suspended compute, a provider incident, a bad deployment caught the same day.
 */
export const SNAPSHOT_MAX_AGE_HOURS = 12;

/**
 * How old a snapshot may be while Neon has suspended the project for the rest of its billing
 * period (§NNN): a whole period and a day. Nothing is written while the database is suspended, so
 * the copy is the newest truth there is, and the page says so and until when.
 */
export const SNAPSHOT_MAX_AGE_WHILE_RESTING_HOURS = 32 * 24;

export function isSnapshotTooOld(envelope: Envelope<unknown>, now: Date, maxAgeHours: number = SNAPSHOT_MAX_AGE_HOURS): boolean {
  return now.getTime() - envelope.takenAt.getTime() > maxAgeHours * 3_600_000;
}
