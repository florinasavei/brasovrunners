import Stack from "@mui/material/Stack";
import { getTranslations } from "next-intl/server";
import { hasProgramme } from "@/modules/events/domain/event-type";
import Panel from "@/shared/ui/Panel";
import { programmeSummary, rulesSummary } from "../box-summaries";
import { type BoxProps, type LanguageEntry, summaryWords } from "./box-kit";
import DeclarationCard, { declarationLine } from "./DeclarationCard";
import ProgrammeBox from "./ProgrammeBox";
import type { DeclarationOption } from "./RegistrationBox";
import { RulesBox } from "./TextBoxes";

/**
 * «Program, regulament și declarație» (§NNN; the owner, 2026-09-27: "Programul, regulamentul și
 * declarația la fel pe același card"): one card for what a runner reads the night before and signs
 * — the page's `#schedule` and `#rules`, one under the other — holding three named cards, in the
 * page's order:
 *
 * 1. «Programul zilei și ce să aduci» (`#box-schedule`, §350, §405): the timed rows, the notes and
 *    what to bring, with its «i» help fold and its Română | English tabs;
 * 2. «Regulamentul» (`#box-rules`): the rules, on their own tabs;
 * 3. «Declarația pe propria răspundere» (`#box-declaration`, §448): what the participant signs.
 *
 * Each keeps its fields, names, ids, closed line and refusals; this card only holds them. Its own
 * closed line says the three in a row. It opens itself while a saved event that registers on the
 * site has no declaration chosen (the declaration card inside opens too), and with people
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
  const line = await declarationLine(event, declarations, words);
  // Awaited, not nested: each element is ready when the card is (`requiredLine` does the same).
  const programme = await ProgrammeBox({ event, mayEditSettings, risk, languages });
  const rules = await RulesBox({ languages });
  const declaration = await DeclarationCard({ event, mayEditSettings, groupRunDeclarations, declarations, words });

  return (
    <Panel
      collapsible
      id="box-programme"
      title={heading ?? t("editor.boxes.programmeRules.title")}
      aside={[
        programmeSummary(words, event, hasProgramme(initialType), translations, locale),
        // «regulamentul: RO: completat · EN: gol» — the rules' own line, named, among the other two.
        t("editor.boxes.programmeRules.rulesLine", { state: rulesSummary(words, translations) }),
        line.text,
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
      </Stack>
    </Panel>
  );
}
