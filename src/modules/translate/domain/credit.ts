/**
 * The DeepL key's allowance, read as a one-time credit that no month refills (§497), from DeepL's
 * meter (`GET /v2/usage`) rather than our count — only DeepL knows what it billed. The level drives
 * Costuri, the translation panel, the `/admin/tasks` row and the press's refusal.
 */

export const CREDIT_WATCH_SHARE = 0.8;
export const CREDIT_LOW_SHARE = 0.95;

/** `spent`: DeepL refuses every translation (HTTP 456) until a new credit or key. */
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

/** Our count (`charactersToSend`, tags included) exceeds DeepL's, so a press let through is never refused for the credit. */
export function creditAllows(credit: TranslationCredit, asked: number): boolean {
  return credit.level !== "spent" && asked <= credit.remaining;
}

/**
 * Spent (§497): the meter at 100 %, or the usage read itself answered 456. Any other failed read
 * is not a spent credit: the buttons stay and the press's own answer decides.
 */
export function creditIsSpent(reading: { ok: true; credit: TranslationCredit } | { ok: false; reason: string }): boolean {
  return reading.ok ? reading.credit.level === "spent" : reading.reason === "quota";
}

export type CreditHealth = { level: CreditLevel | "unknown" | "unconfigured"; note: string | null };

/**
 * The credit on `/api/health` (§497): the level only — the figures are the club's account data,
 * not for a public answer — plus a note when low or spent. It never changes the endpoint's status:
 * translation stops nothing a visitor or runner needs.
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
