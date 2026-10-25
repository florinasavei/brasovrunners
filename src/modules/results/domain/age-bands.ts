import type { SexChoice } from "@/modules/registrations/domain/sex";

/**
 * A race's age categories (§850): the ages at which each band **starts**, youngest first — `[18, 30, 40, 50, 60]` says
 * «sub 18», «18-29», «30-39», «40-49», «50-59», «60+». A category is a sex and a band (§808), so the club decides one list
 * of ages per race and gets twice as many categories. The list is the race's own (`events.result_age_bands`); null there
 * means the platform's bands — the club's statistics' (§787), so a race that never chose any ranks as every race did.
 *
 * Pure — no database, no React, no catalogue. The ranking (`ranking.ts`), the words (`../category-words.ts`), the filter's
 * order and the «Categorii» box on «Clasament» all read this one module, so none can disagree about who is in which band.
 */

/** The platform's bands: the ordinary ones of a road race, ten years wide from eighteen; a minor's band is its own (an event's minimum age is fourteen, §515). */
export const DEFAULT_AGE_BAND_STARTS: readonly number[] = [18, 30, 40, 50, 60];

/** How many bands a race may have: more than a dozen is a typing mistake. */
export const AGE_BAND_STARTS_MAX = 12;
/** An age a band may start at: one to ninety-nine. */
export const AGE_BAND_START_MIN = 1;
export const AGE_BAND_START_MAX = 99;

/**
 * The stored column read: an array of integer ages, ascending and within bounds, or the platform's bands for null and for anything
 * a later or an earlier version stored that this one cannot read — a ranking is never refused by a setting.
 */
export function ageBandStartsOf(stored: unknown): readonly number[] {
  if (!Array.isArray(stored)) return DEFAULT_AGE_BAND_STARTS;
  const starts = stored.filter((age): age is number => typeof age === "number");
  return starts.length === stored.length && isValidAgeBandStarts(starts) ? starts : DEFAULT_AGE_BAND_STARTS;
}

/** Whether a list is one the column may hold: one to twelve integers, each within bounds, strictly ascending. */
export function isValidAgeBandStarts(starts: readonly number[]): boolean {
  if (starts.length < 1 || starts.length > AGE_BAND_STARTS_MAX) return false;
  return starts.every((age, index) => Number.isInteger(age) && age >= AGE_BAND_START_MIN && age <= AGE_BAND_START_MAX && (index === 0 || age > starts[index - 1]));
}

export type AgeBandStartsProblem = "notNumbers" | "range" | "order" | "tooMany";

/**
 * The «Categorii de vârstă» box read: ages separated by a comma, a semicolon, a space or a new line («18, 35, 45, 55»). An empty box
 * is the platform's bands (`null`, so the column forgets the choice rather than storing a copy of the default). A problem names what to
 * correct; the box keeps what was typed (the form's rule, §315). The ages are read in any order and sorted — the club types them as it
 * thinks of them — but one typed twice is refused, since two bands cannot start at the same age.
 */
export function parseAgeBandStarts(typed: string): { ok: true; starts: number[] | null } | { ok: false; problem: AgeBandStartsProblem } {
  const parts = typed
    .split(/[\s,;]+/)
    .map((part) => part.trim())
    .filter((part) => part !== "");
  if (parts.length === 0) return { ok: true, starts: null };
  if (parts.length > AGE_BAND_STARTS_MAX) return { ok: false, problem: "tooMany" };
  const ages = parts.map((part) => (/^\d{1,3}$/.test(part) ? Number(part) : Number.NaN));
  if (ages.some((age) => Number.isNaN(age))) return { ok: false, problem: "notNumbers" };
  if (ages.some((age) => age < AGE_BAND_START_MIN || age > AGE_BAND_START_MAX)) return { ok: false, problem: "range" };
  const starts = [...ages].sort((a, b) => a - b);
  if (starts.some((age, index) => index > 0 && age === starts[index - 1])) return { ok: false, problem: "order" };
  return { ok: true, starts };
}

/** The box's text for a stored list: «18, 30, 40, 50, 60»; the platform's bands when the race chose none. */
export function formatAgeBandStarts(starts: readonly number[]): string {
  return starts.join(", ");
}

/** Whether two lists are the same bands. */
export function sameAgeBandStarts(a: readonly number[], b: readonly number[]): boolean {
  return a.length === b.length && a.every((age, index) => age === b[index]);
}

/**
 * The band an age falls in, as the key a category stores: `under18` below the first start, else `from<start>` of the last start the
 * age has reached — `from30` for a 35-year-old under the platform's bands. Null for no age (no birth date), and nothing is guessed.
 */
export function bandKeyOf(age: number | null | undefined, starts: readonly number[]): string | null {
  if (typeof age !== "number" || !Number.isFinite(age) || age < 0) return null;
  let found: string | null = null;
  for (const start of starts) if (age >= start) found = `from${start}`;
  return found ?? `under${starts[0]}`;
}

/**
 * A category's key from its two answers: the sex and the band of the age on the event's day (`ageOnRaceDay`), or null when either
 * is missing — `FEMALE:from30`. The one definition of a category: the ranking, the Excel's footer (under the platform's bands) and the
 * page read it.
 */
export function categoryKeyOf(sex: SexChoice | null | undefined, age: number | null | undefined, starts: readonly number[]): string | null {
  const band = bandKeyOf(age, starts);
  return sex && band ? `${sex}:${band}` : null;
}

/** The two halves of a stored category key, or null for a key that is not one (a row stored by another version). */
export function splitCategoryKey(key: string | null | undefined): { sex: SexChoice; band: string } | null {
  if (!key) return null;
  const [sex, band] = key.split(":");
  return (sex === "FEMALE" || sex === "MALE") && band ? { sex, band } : null;
}

/** The age a band's key starts at, for sorting: `under18` sorts before every `from…`; a key this version cannot read sorts last. */
export function bandStartOf(band: string): number {
  if (/^under\d+$/.test(band)) return -1;
  const match = /^from(\d+)$/.exec(band);
  return match ? Number(match[1]) : Number.MAX_SAFE_INTEGER;
}

/** The ages a band's key covers: `from` inclusive (null for the youngest band), `to` inclusive (null for the oldest); null for a key that is not one. */
export function bandBoundsOf(band: string, starts: readonly number[]): { from: number | null; to: number | null } | null {
  const under = /^under(\d+)$/.exec(band);
  if (under) return { from: null, to: Number(under[1]) - 1 };
  const from = /^from(\d+)$/.exec(band);
  if (!from) return null;
  const start = Number(from[1]);
  const next = starts.find((age) => age > start);
  return { from: start, to: next === undefined ? null : next - 1 };
}

/** The words a band is said in: the three sentences of the catalogue (`Admin.registrations.statistics`), with their placeholders. */
export type BandWords = {
  /** «sub {age} ani». */
  under: string;
  /** «{from}-{to} ani». */
  between: string;
  /** «{from}+ ani». */
  open: string;
};

/**
 * A band's key in words, under a race's bands: «sub 18 ani», «30-39 ani», «60+ ani». A key this version cannot read is the key itself,
 * so a cell is never blank by accident. The key stores only where the band starts, so the end comes from the list: the same `from30`
 * reads «30-39 ani» under the platform's bands and «30-44 ani» under a race whose next band starts at 45.
 */
export function bandLabelOf(band: string, starts: readonly number[], words: BandWords): string {
  const bounds = bandBoundsOf(band, starts);
  if (!bounds) return band;
  if (bounds.from === null) return words.under.replace("{age}", String((bounds.to ?? 0) + 1));
  if (bounds.to === null) return words.open.replace("{from}", String(bounds.from));
  return words.between.replace("{from}", String(bounds.from)).replace("{to}", String(bounds.to));
}

/** Every band's key of a list, youngest first: the «Categorii» box's preview and the awards' order. */
export function bandKeysOf(starts: readonly number[]): string[] {
  return [`under${starts[0]}`, ...starts.map((start) => `from${start}`)];
}
