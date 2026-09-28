import { emailLeavesWords } from "@/modules/notifications/domain/email-wait";

/**
 * A family's reserved places, in words (§NNN, amending §446 and §519; the owner, 2026-09-28: «să
 * rezerv 3 locuri și așa să se calculeze pe site»). Pure: one phrase for the screen after the form and
 * for the family's one email, so the two never name one deadline two ways.
 *
 * The instant is written as every leaving time is (`emailLeavesWords`, §536): the bare «HH:MM» on the
 * club's clock today, which the sentence introduces with «la» / "until"; on another day the long
 * weekday and month with its own «la» before the hour (§452: no «la» before a weekday).
 */
export type ReservedUntilWords = { key: "reservedToday" | "reservedOn"; at: string };

export function reservedUntilWords(until: Date, now: Date, locale: string): ReservedUntilWords {
  const words = emailLeavesWords(until, now, locale, "prose");
  return { key: words.key === "leavesToday" ? "reservedToday" : "reservedOn", at: words.at };
}

/** The phrase after «loc rezervat» / "place reserved" in the email: «până la 12:40», «până marți, 29 septembrie, la 10:00». */
export function reservedUntilPhrase(until: Date, now: Date, locale: "ro" | "en"): string {
  const words = reservedUntilWords(until, now, locale);
  if (locale === "en") return `until ${words.at}`;
  return words.key === "reservedToday" ? `până la ${words.at}` : `până ${words.at}`;
}
