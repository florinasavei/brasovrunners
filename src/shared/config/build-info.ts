/**
 * What build is this, and when was the code behind it last changed.
 *
 * The values are inlined by `next.config.ts` at build time; this module only reads and
 * formats them. Kept separate from `env.ts` deliberately: those are operator-supplied
 * configuration a deployment must get right, validated with zod and fatal when wrong. These
 * are build facts nobody types, and a missing one is a badge that says "dev", never a
 * deployment that refuses to start.
 *
 * Its one import is `i18n/dates.ts`, which imports nothing itself — so nothing reachable from
 * here can open a connection or read a cookie (`api/build-id` depends on that).
 */

import { CLUB_TIME_ZONE, formatDay } from "@/i18n/dates";

export type BuildInfo = {
  /** The documentation baseline, e.g. `BR-V1.16-2026-09-04`, or empty when unknown. */
  baseline: string;
  /** Short commit hash, or empty when the build had no git checkout. */
  commit: string;
  /** ISO-8601 commit date, or empty when unknown. */
  committedAt: string;
  /**
   * An opaque twelve-character identity for **this deployment**, or empty when the build had
   * nothing to derive one from.
   *
   * Not the commit: the club redeploys the same commit with changed environment variables, and
   * that is a different running site. `next.config.ts` explains how it is derived and why it is
   * a hash. Read by `/api/build-id`, which is what a tab compares itself against
   * (`shared/ui/new-build.ts`).
   */
  id: string;
};

export const buildInfo: BuildInfo = {
  baseline: process.env.BUILD_BASELINE ?? "",
  commit: process.env.BUILD_COMMIT ?? "",
  committedAt: process.env.BUILD_COMMITTED_AT ?? "",
  id: process.env.BUILD_ID ?? "",
};

/**
 * The version half of the badge.
 *
 * The baseline is the identifier this repository actually versions by (`README.md` §
 * Versioning), so it leads; the commit disambiguates two builds of the same baseline, which
 * is the common case while a milestone is in progress. The date suffix of the baseline is
 * dropped here because the badge shows a date of its own, and two dates that can disagree —
 * the baseline was cut on one day, the commit landed on another — read as a bug.
 */
export function formatVersion(info: BuildInfo = buildInfo): string {
  const baseline = info.baseline.replace(/-\d{4}-\d{2}-\d{2}$/, "");
  if (baseline && info.commit) return `${baseline} · ${info.commit}`;
  return baseline || info.commit || "dev";
}

/**
 * The "last updated" half, in the reader's own language.
 *
 * `Intl` rather than a hand-written month table: Romanian and English name months
 * differently, and the platform already knows both.
 *
 * The time is shown as well as the date, and always in the club's own timezone — the same one
 * every event time on this site is formatted in. Two deploys on the same afternoon are the
 * ordinary case while a milestone is in progress, and a badge that reads the same for both
 * cannot answer the only question it exists to answer.
 */
/**
 * The build's moment as `YYYY-MM-DD HH:MM`, for the badge every visitor can see.
 *
 * ISO rather than a locale format, on the owner's instruction of 2026-09-17: "17 sept. 2026"
 * beside a version string was read as *the site's* last update — as though the club had not
 * posted anything since — when it is the moment this code was built. An ISO stamp next to
 * "app-ver" reads as a build stamp, which is what it is, and it reads identically in Romanian
 * and English, which a month name does not.
 *
 * **The time is part of it**, restored on the same day it was dropped: two releases on one
 * afternoon share a date, so a date alone cannot answer "is this the build I just shipped?" —
 * which is the only question this stamp exists to answer.
 *
 * The recorded offset is kept rather than converted to UTC. `committedAt` is the commit's own
 * timestamp, so `2026-09-17T11:40:00+03:00` shows as `11:40` — the time on the clock of
 * whoever made the build. Converting it to `08:40` would be correct and unrecognisable.
 * `/devs` keeps the readable form: its audience is one administrator looking at a deployment.
 */
export function formatBuildDate(info: BuildInfo = buildInfo): string | null {
  if (!info.committedAt) return null;
  if (Number.isNaN(new Date(info.committedAt).getTime())) return null;

  const asRecorded = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/.exec(info.committedAt);
  if (asRecorded) return `${asRecorded[1]} ${asRecorded[2]}`;

  // Anything the regex does not recognise but `Date` does — fall back to UTC rather than
  // dropping the stamp entirely.
  return new Date(info.committedAt).toISOString().slice(0, 16).replace("T", " ");
}

export function formatLastUpdated(locale: string, info: BuildInfo = buildInfo): string | null {
  if (!info.committedAt) return null;

  const date = new Date(info.committedAt);
  if (Number.isNaN(date.getTime())) return null;

  // A chip on /devs: the short form with the time (§NNN).
  return formatDay(date, { locale, timeZone: CLUB_TIME_ZONE, style: "short", withTime: true });
}
