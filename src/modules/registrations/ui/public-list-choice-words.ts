import { getTranslations } from "next-intl/server";
import { type ListChoiceFacts, type ListChoiceState, listChoiceNamesResults, listChoiceState } from "@/modules/registrations/domain/list-choice";
import type { PublicListChoiceWords } from "@/modules/registrations/ui/PublicListChoice";

/**
 * «Lista publică și clasamentul»'s words (§NNN), worded on the server in the page's language: one place for the two pages that draw
 * the block — the manage page and «Înscrierile mele» — so a registration's block says one thing on both, from one rule
 * (`domain/list-choice.ts`). Read once per page; the function it returns words one registration's block.
 *
 * - The heading names the results only on an event that takes them (a race); elsewhere it is the list's own title, the one the
 *   confirmation email's page wears (`list.title`).
 * - The sentence is the state's own (`Registrations.list.choice.<state>`); off the list on a shown list, it names the row the public
 *   list prints instead of the name, in the list's own words (`Event.startList.anonymous`) — never typed twice.
 * - The button keeps the tick's own words both ways (§570, criterion 23): «Vreau / Nu vreau să apar pe lista de participanți &
 *   rezultate», as the confirmation email's page and the club's messages to the runners name it.
 */
export async function publicListChoiceWords(where: "manage" | "mine"): Promise<(facts: ListChoiceFacts) => PublicListChoiceWords> {
  const t = await getTranslations("Registrations");
  const tEvent = await getTranslations("Event");
  const anonymous = tEvent("startList.anonymous");
  const sentences = {
    listedWithResults: t("list.choice.listedWithResults"),
    listed: t("list.choice.listed"),
    notListedCountedWithResults: t("list.choice.notListedCountedWithResults", { anonymous }),
    notListedCounted: t("list.choice.notListedCounted", { anonymous }),
    notListedWithResults: t("list.choice.notListedWithResults"),
    notListed: t("list.choice.notListed"),
  } satisfies Record<ListChoiceState, string>;
  const words = {
    titleWithResults: t("list.choice.title"),
    title: t("list.title"),
    optIn: t("list.optIn"),
    optOut: t("list.optOut"),
    pressing: t("list.choice.saving"),
    help: where === "mine" ? t("list.choice.helpMine") : t("list.choice.help"),
    changed: t("list.changed"),
    failed: t("list.failed"),
  };
  return (facts) => ({
    title: listChoiceNamesResults(facts.eventType) ? words.titleWithResults : words.title,
    state: sentences[listChoiceState(facts)],
    press: facts.listed ? words.optOut : words.optIn,
    pressing: words.pressing,
    help: words.help,
    changed: words.changed,
    failed: words.failed,
  });
}
