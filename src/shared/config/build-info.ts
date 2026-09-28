/**
 * Build facts inlined by `next.config.ts`; a missing one reads "dev", never a failed start
 * (unlike `env.ts`). Imports only `i18n/dates.ts`, so nothing reachable opens a connection or
 * reads a cookie — `api/build-id` depends on that.
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
   * Opaque twelve-character identity of this deployment (not the commit: a redeploy with new
   * variables is a different site), or empty. Derived in `next.config.ts`; compared by tabs via
   * `/api/build-id` (`shared/ui/new-build.ts`).
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
 * The version half of the badge: baseline (`README.md` § Versioning) then commit. The
 * baseline's date suffix is dropped because the badge shows its own date.
 */
export function formatVersion(info: BuildInfo = buildInfo): string {
  const baseline = info.baseline.replace(/-\d{4}-\d{2}-\d{2}$/, "");
  if (baseline && info.commit) return `${baseline} · ${info.commit}`;
  return baseline || info.commit || "dev";
}

/**
 * The build's moment as `YYYY-MM-DD HH:MM` for the public badge. ISO so it reads as a build
 * stamp, not the site's last update; the time distinguishes two releases on one day. The
 * recorded offset is kept (`…T11:40:00+03:00` shows `11:40`), not converted to UTC.
 */
export function formatBuildDate(info: BuildInfo = buildInfo): string | null {
  if (!info.committedAt) return null;
  if (Number.isNaN(new Date(info.committedAt).getTime())) return null;

  const asRecorded = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/.exec(info.committedAt);
  if (asRecorded) return `${asRecorded[1]} ${asRecorded[2]}`;

  // Unrecognised by the regex but valid for `Date`: fall back to UTC.
  return new Date(info.committedAt).toISOString().slice(0, 16).replace("T", " ");
}

export function formatLastUpdated(locale: string, info: BuildInfo = buildInfo): string | null {
  if (!info.committedAt) return null;

  const date = new Date(info.committedAt);
  if (Number.isNaN(date.getTime())) return null;

  // A chip on /devs: the short form with the time (§349).
  return formatDay(date, { locale, timeZone: CLUB_TIME_ZONE, style: "short", withTime: true });
}
