import Stack from "@mui/material/Stack";
import { getTranslations } from "next-intl/server";
import { hasProgramme } from "@/modules/events/domain/event-type";
import Panel from "@/shared/ui/Panel";
import { effectiveMinimumAge } from "@/modules/registrations/domain/age";
import { minAgeSummary, programmeSummary, rulesSummary, startListSummary } from "../box-summaries";
import { type BoxProps, type LanguageEntry, summaryWords } from "./box-kit";
import DeclarationCard, { declarationLine } from "./DeclarationCard";
import ProgrammeBox from "./ProgrammeBox";
import type { DeclarationOption } from "./RegistrationBox";
import StartListBox from "./StartListBox";
import { RulesBox } from "./TextBoxes";

/**
 * «Program, regulament și declarație» (§481, §512): one card holding, in page order, the
 * programme (`#box-schedule`), the rules with the minimum age (`#box-rules`, §505), the
 * declaration (`#box-declaration`, §448) and the public list (`#box-start-list`). Each inner
 * card keeps its own fields, ids and refusals. Opens itself while a site-registering event has
 * no declaration or a group run's self-declaration has no approved text (§483); amber when
 * people are registered (§350).
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
  const startList = await StartListBox({ event, mayEditSettings });

  return (
    <Panel glyph="rules"
      collapsible
      id="box-programme"
      title={heading ?? t("editor.boxes.programmeRules.title")}
      aside={[
        programmeSummary(words, event, hasProgramme(initialType), translations, locale),
        // The rules' own line, named, among the others.
        t("editor.boxes.programmeRules.rulesLine", { state: rulesSummary(words, translations) }),
        // The minimum age is a box of «Regulamentul» (§505).
        minAgeSummary(words, effectiveMinimumAge(event?.minAge), locale),
        line.text,
        // The public list's own line, last (§512).
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
        {startList}
      </Stack>
    </Panel>
  );
}
