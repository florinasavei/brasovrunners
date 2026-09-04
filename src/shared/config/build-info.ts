/**
 * What build is this, and when was the code behind it last changed.
 *
 * The values are inlined by `next.config.ts` at build time; this module only reads and
 * formats them. Kept separate from `env.ts` deliberately: those are operator-supplied
 * configuration a deployment must get right, validated with zod and fatal when wrong. These
 * are build facts nobody types, and a missing one is a badge that says "dev", never a
 * deployment that refuses to start.
 */

export type BuildInfo = {
  /** The documentation baseline, e.g. `BR-V1.16-2026-09-04`, or empty when unknown. */
  baseline: string;
  /** Short commit hash, or empty when the build had no git checkout. */
  commit: string;
  /** ISO-8601 commit date, or empty when unknown. */
  committedAt: string;
};

export const buildInfo: BuildInfo = {
  baseline: process.env.BUILD_BASELINE ?? "",
  commit: process.env.BUILD_COMMIT ?? "",
  committedAt: process.env.BUILD_COMMITTED_AT ?? "",
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
 * differently, and the platform already knows both. Day and month only — an hour on a badge
 * invites the question of whose timezone it is, which nobody asking "is this the new one?"
 * needs answered.
 */
export function formatLastUpdated(locale: string, info: BuildInfo = buildInfo): string | null {
  if (!info.committedAt) return null;

  const date = new Date(info.committedAt);
  if (Number.isNaN(date.getTime())) return null;

  return new Intl.DateTimeFormat(locale === "ro" ? "ro-RO" : "en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "Europe/Bucharest",
  }).format(date);
}
