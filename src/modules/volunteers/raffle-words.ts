import { catalogueOf } from "@/i18n/catalogue";
import { RAFFLE_KINDS, type RaffleGroups } from "./domain/raffle";

// The platform's words with the club's own laid over them (§887, `i18n/catalogue.ts`).
const en = catalogueOf("en");
const ro = catalogueOf("ro");

/**
 * What the privacy notice's `{{raffle}}` becomes (§NNN): the public form's own heading, quoted, in that language — „Înscrie-te la
 * tombolă” / “Sign up for the raffle” — read from the catalogue the form's page reads (`Event.raffle.title`), so the approved
 * sentence names what a visitor sees. Outside a request, like `notice-words.ts`, for the legal pages, the declaration and the
 * token legend.
 */
export function raffleClause(locale: string): string {
  return locale === "en" ? `“${en.Event.raffle.title}”` : `„${ro.Event.raffle.title}”`;
}

/**
 * What «Regulamentul tombolei»'s `{{raffleGroups}}` becomes (§NNN): the groups the event ticks in «Cine poate participa», in the
 * text's language and the house's order — «alergătorii confirmați, cu număr de concurs, elitele cursei și voluntarii confirmați, cu
 * număr de voluntar» — joined as a sentence joins them. "" when none is ticked: the gate opens no sign-up then, so no text is read.
 */
export function raffleGroupsPhrase(groups: RaffleGroups, locale: string): string {
  const words = locale === "en" ? en.Legal.raffleGroups : ro.Legal.raffleGroups;
  const named = RAFFLE_KINDS.filter((kind) => groups[kind]).map((kind) => words[kind]);
  if (named.length <= 1) return named.join("");
  // «a, b și c» — the last two joined by the language's own word, never a serial comma.
  return `${named.slice(0, -1).join(", ")} ${words.and} ${named[named.length - 1]}`;
}
