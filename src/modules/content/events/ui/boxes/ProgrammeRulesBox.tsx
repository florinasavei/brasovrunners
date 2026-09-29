import Stack from "@mui/material/Stack";
import { getTranslations } from "next-intl/server";
import { hasProgramme, takesRegistrations } from "@/modules/events/domain/event-type";
import Panel from "@/shared/ui/Panel";
import { effectiveMinimumAge } from "@/modules/registrations/domain/age";
import { healthNoteSummary, minAgeSummary, programmeSummary, rulesSummary, startListSummary } from "../box-summaries";
import { type BoxProps, type LanguageEntry, summaryWords } from "./box-kit";
import ConditionsBox from "./ConditionsBox";
import DeclarationCard, { declarationLine } from "./DeclarationCard";
import ProgrammeBox from "./ProgrammeBox";
import type { DeclarationOption } from "./RegistrationBox";
import StartListBox from "./StartListBox";
import { RulesBox } from "./TextBoxes";

/**
 * «Program, regulament și declarație» (§481; the owner, 2026-09-27: "Programul, regulamentul și
 * declarația la fel pe același card"): one card for what a runner reads the night before and signs
 * — the page's `#schedule` and `#rules`, one under the other — holding four named cards, in the
 * page's order:
 *
 * 1. «Programul zilei și ce să aduci» (`#box-schedule`, §350, §405): the timed rows, the notes and
 *    what to bring, with its «i» help fold and its Română | English tabs;
 * 2. «Regulamentul» (`#box-rules`): the rules, on their own tabs, and the minimum age — one box
 *    for every type since §505;
 * 3. «Declarația pe propria răspundere» (`#box-declaration`, §448): what the participant signs;
 * 3b. «Condiții de participare» (`#box-conditions`, §557): whether the form asks the health note;
 * 4. «Lista publică a participanților» (`#box-start-list`, §32, §512): whether the page draws the
 *    list, which it does last, under the rules — so it is the last card here, not a card of its own.
 *
 * Each keeps its fields, names, ids, closed line and refusals; this card only holds them. Its own
 * closed line says the four in a row. It opens itself while a saved event that registers on the
 * site has no declaration chosen, or while a group run offering its self-declaration has no
 * approved, not-withdrawn text for its surface (§483) — the declaration card inside opens too —
 * and with people
 * registered it is amber — the programme is one of the boxes a change reaches (§350).
 */
export default async function ProgrammeRulesBox({
  event,
  mayEditSettings,
  risk,
  heading,
  languages,
  groupRunDeclarations,
  declarations,
}: BoxProps & { languages: readonly LanguageEntry[]; declarations: readonly DeclarationOption[] }) {
  const t = await getTranslations("Admin");
  const { words } = await summaryWords();
  const translations = languages.map((entry) => entry.translation);
  const locale = translations[0]?.locale ?? "ro";
  const initialType = event?.type ?? "GROUP_RUN";
  const line = await declarationLine(event, declarations, words, groupRunDeclarations);
  // Awaited, not nested: each element is ready when the card is (`requiredLine` does the same).
  const programme = await ProgrammeBox({ event, mayEditSettings, risk, languages });
  // The rules card holds the minimum age too, for every type (§505).
  const rules = await RulesBox({ languages, event, mayEditSettings });
  const declaration = await DeclarationCard({ event, mayEditSettings, groupRunDeclarations, declarations, words });
  const conditions = await ConditionsBox({ event, mayEditSettings });
  const startList = await StartListBox({ event, mayEditSettings });
  // The health note's line only where there is a form to ask it on (§557, §111).
  const asksOnForm = takesRegistrations(initialType) && event?.registrationMode === "INTERNAL";

  return (
    <Panel glyph="rules"
      collapsible
      id="box-programme"
      title={heading ?? t("editor.boxes.programmeRules.title")}
      aside={[
        programmeSummary(words, event, hasProgramme(initialType), translations, locale),
        // «regulamentul: RO: completat · EN: gol» — the rules' own line, named, among the other two.
        t("editor.boxes.programmeRules.rulesLine", { state: rulesSummary(words, translations) }),
        // «vârsta minimă 14 ani» — the age is a box of «Regulamentul» since §505.
        minAgeSummary(words, effectiveMinimumAge(event?.minAge), locale),
        line.text,
        asksOnForm ? healthNoteSummary(words, event?.askHealthNote ?? false) : null,
        // «lista publică: Ascunsă» — the public list's own line, named, last (§512).
        t("editor.boxes.programmeRules.startListLine", { state: startListSummary(words, event?.participantListVisibility) }),
      ]
        .filter(Boolean)
        .join(words.separator)}
      openWhen={{ attention: line.missing }}
      tone={risk ? "risk" : "default"}
    >
      <Stack spacing={2}>
        {programme}
        {rules}
        {declaration}
        {conditions}
        {startList}
      </Stack>
    </Panel>
  );
}
