/**
 * The DeepL credit, read as the one-time credit it is (§NNN).
 *
 * §464 and §479 assumed DeepL API Free: 500 000 characters a month, spent and renewed on the
 * first. The key the club put on both deployments on 2026-09-27 is DeepL's Developer plan, whose
 * allowance is **a credit given once** — 1 000 000 characters, 0 used that afternoon — that no
 * month refills. A line projecting "this month's characters" against a monthly ceiling therefore
 * said the wrong thing twice: that the allowance comes back, and that half a million is the
 * ceiling. The figure the club needs is the credit's own: how much of it is used, how much is
 * left, and whether it is running out — from DeepL's meter (`GET /v2/usage`), never from our
 * count, because only DeepL knows what it billed.
 *
 * Pure, so every threshold is pinned by a unit test. The same four words drive Costuri's line,
 * the translation panel, the `/admin/tasks` row and the press's own refusal.
 */

/** Past this share of the credit used, the line says to watch it (the eighty percent every other card warns at). */
export const CREDIT_WATCH_SHARE = 0.8;
/** Past this share the credit is low: the row asks the Administrator to plan a new key or a paid plan. */
export const CREDIT_LOW_SHARE = 0.95;

/**
 * - `ok` — under eighty percent used;
 * - `watch` — eighty percent or more used;
 * - `low` — ninety-five percent or more used;
 * - `spent` — nothing left: DeepL refuses every translation (HTTP 456) until a new credit or key.
 */
export type CreditLevel = "ok" | "watch" | "low" | "spent";

export type TranslationCredit = {
  used: number;
  limit: number;
  remaining: number;
  /** Used over the limit, 0–1; 1 when the limit is 0 (a key that may translate nothing). */
  share: number;
  level: CreditLevel;
};

export function translationCredit(usage: { used: number; limit: number }): TranslationCredit {
  const used = Math.max(0, Math.floor(usage.used));
  const limit = Math.max(0, Math.floor(usage.limit));
  const remaining = Math.max(0, limit - used);
  const share = limit === 0 ? 1 : Math.min(used / limit, 1);
  const level: CreditLevel = remaining === 0 ? "spent" : share >= CREDIT_LOW_SHARE ? "low" : share >= CREDIT_WATCH_SHARE ? "watch" : "ok";
  return { used, limit, remaining, share, level };
}

/**
 * Whether a press of `asked` characters fits what is left of the credit. DeepL counts the words
 * it translates and the club counts what it sends, tags included (`charactersToSend`), so ours is
 * the larger figure and a press this lets through is never one DeepL would refuse for the credit.
 */
export function creditAllows(credit: TranslationCredit, asked: number): boolean {
  return credit.level !== "spent" && asked <= credit.remaining;
}

/**
 * Whether a credit reading says the key can translate nothing (§NNN): DeepL's meter at 100 %
 * (`spent`), or the usage read itself answered 456 (`quota`) — DeepL's own word that the credit
 * is gone, even without figures. The editors grey the whole-record button and hide the per-box
 * ones on either. Any other unread answer is not a spent credit: the buttons stay and the
 * press's own answer decides.
 */
export function creditIsSpent(reading: { ok: true; credit: TranslationCredit } | { ok: false; reason: string }): boolean {
  return reading.ok ? reading.credit.level === "spent" : reading.reason === "quota";
}

/** What `/api/health` publishes about the credit (§NNN): a word and a note, never a figure. */
export type CreditHealth = { level: CreditLevel | "unknown" | "unconfigured"; note: string | null };

/**
 * The credit as `/api/health` says it (§NNN, after §335 and §447): the level only — the used and
 * left characters are the club's own account figures and belong on Costuri, not on a public,
 * unauthenticated answer — and a note once the credit is low or spent, so a monitor's log shows
 * why translation stopped. It never changes the endpoint's status: translation stops nothing a
 * visitor or a runner needs, and the `/admin/tasks` row is where it turns red.
 */
export function creditHealth(reading: { ok: true; credit: TranslationCredit } | { ok: false; reason: string }): CreditHealth {
  if (!reading.ok) return { level: reading.reason === "unconfigured" ? "unconfigured" : "unknown", note: null };
  const { level } = reading.credit;
  return {
    level,
    note:
      level === "spent"
        ? "the DeepL credit is spent: translation refuses every press until a new credit or key"
        : level === "low"
          ? "the DeepL credit is nearly spent: get a new credit or key ready"
          : null,
  };
}
