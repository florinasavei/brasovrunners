import Stack from "@mui/material/Stack";
import { getLocale, getTranslations } from "next-intl/server";
import type { ReactNode } from "react";
import { capitalizeFirst } from "@/i18n/dates";
import { getPathname } from "@/i18n/navigation";
import { type Locale, routing } from "@/i18n/routing";
import { effectiveMinimumAge, MIN_PARTICIPANT_AGE } from "@/modules/registrations/domain/age";
import { textFieldConstraints } from "@/shared/forms/constraints";
import RecallField from "@/shared/forms/recall";
import LocaleTabPanels, { type RequiredCountWords, type TabWatch } from "@/shared/ui/LocaleTabPanels";
import Panel from "@/shared/ui/Panel";
import { eventInputConstraints } from "../../constraints";
import type { EditableEvent } from "../../repository";
import {
  addressSummary,
  BLANK,
  type BlankTest,
  descriptionSummary,
  identicalLocales,
  incompleteLocales,
  minAgeSummary,
  rulesSummary,
  type SummaryTranslation,
  titleSummarySummary,
} from "../box-summaries";
import OnlyForType from "../OnlyForType";
import { missingForPublish, missingInLanguage, type PublishGapBox, storedPublishReader } from "../publish-check";
import SlugFromTitle from "../SlugFromTitle";
import { AddressFields, DescriptionFields, RulesFields, TitleSummaryFields } from "../TranslationFields";
import { BoxNote, type LanguageEntry, requiredLine, summaryWords } from "./box-kit";

/**
 * The editor boxes that are only words (§350): title and summary, description, rules, page
 * address. Each has its own RO | EN tabs (each with its box's `idPrefix`), and each tab says what
 * it lacks: a count of required boxes still empty (§406), or "· incomplet" for an optional text
 * written only in the other language.
 */

const summaryOf = (entry: LanguageEntry): SummaryTranslation => entry.translation;

/**
 * One strip of tabs, marked from what is stored and then as typed. `identical` lists the texts to
 * compare across languages (§354): identical words get an amber line and a mark on the English
 * tab. `required` names the card's publication gaps (§406), counted per language with
 * `missingForPublish`, the check the closed line and Publicare read.
 */
export async function LanguageTabs({
  idPrefix,
  languages,
  watch,
  blank,
  identical,
  required,
  render,
}: {
  idPrefix: string;
  languages: readonly LanguageEntry[];
  watch: TabWatch;
  blank: BlankTest | readonly BlankTest[];
  identical?: readonly string[];
  required?: PublishGapBox;
  render: (entry: LanguageEntry) => ReactNode;
}) {
  const t = await getTranslations("Admin");
  const incomplete = incompleteLocales(languages.map(summaryOf), watch.rule, blank);
  const mayType = languages.some((entry) => entry.mayEdit);
  const gaps = required
    ? missingForPublish(
        storedPublishReader(
          { locationName: null, locationToBeAnnounced: false },
          languages.map((entry) => entry.translation),
        ),
        routing.locales,
      )
    : [];
  const requiredCount: RequiredCountWords | undefined = required
    ? {
        one: t.raw("editor.required.tab.one") as string,
        few: t.raw("editor.required.tab.few") as string,
        other: t.raw("editor.required.tab.other") as string,
        complete: t("editor.required.complete"),
        locale: await getLocale(),
        box: required,
      }
    : undefined;
  return (
    <LocaleTabPanels
      idPrefix={idPrefix}
      // Only languages the reader may write are re-read as typed.
      watch={mayType ? watch : undefined}
      live={mayType}
      // «Tradu cardul: RO → EN» at the end of the tab row (§514); the address card's words are its two SEO texts.
      translateCard
      requiredCount={requiredCount}
      identical={
        identical
          ? {
              names: identical,
              warning: t("editor.identical.warning"),
              mark: t("editor.identical.tab"),
              initial: identicalLocales(languages.map(summaryOf), identical).length > 0,
            }
          : undefined
      }
      markLabel={t("editor.tabIncomplete")}
      panels={languages.map((entry) => ({
        locale: entry.translation.locale,
        label: entry.label,
        incompleteLabel: incomplete.includes(entry.translation.locale) ? t("editor.tabIncomplete") : undefined,
        missingCount: required ? missingInLanguage(gaps, required, entry.translation.locale) : undefined,
        content: render(entry),
      }))}
    />
  );
}

/** A closed line of two parts: what publication needs, then what the box holds. */
function lineOf(required: ReactNode, summary: string | undefined): ReactNode {
  return summary ? (
    <>
      {required}
      {" · "}
      {summary}
    </>
  ) : (
    required
  );
}

/**
 * "Titlu și rezumat" (§350): open on create (`primary`, the page's own verb) and on the editor
 * while a language lacks either (`attention`). The closed line starts with what publication needs (§406).
 */
export async function TitleSummaryBox({ languages, creating, heading }: { languages: readonly LanguageEntry[]; creating: boolean; heading?: string }) {
  const t = await getTranslations("Admin");
  const { words } = await summaryWords();
  const translations = languages.map(summaryOf);
  const incomplete = incompleteLocales(translations, "required", BLANK.titleSummary);
  const required = await requiredLine("titleSummary", null, languages);
  return (
    <Panel glyph="title"
      collapsible
      id="box-title"
      title={heading ?? t("editor.boxes.titleSummary.title")}
      aside={lineOf(required, creating ? undefined : titleSummarySummary(words, translations))}
      openWhen={{ primary: creating, attention: !creating && incomplete.length > 0 }}
    >
      <LanguageTabs
        idPrefix="title"
        languages={languages}
        watch={{ names: ["title", "excerptBody"], rule: "required" }}
        blank={BLANK.titleSummary}
        identical={["excerptBody"]}
        required="titleSummary"
        render={(entry) => <TitleSummaryFields translation={entry.translation} mayEdit={entry.mayEdit} />}
      />
    </Panel>
  );
}

/** "Descrierea evenimentului": folded on both pages; the heaviest editor mounts on opening. */
export async function DescriptionBox({ languages, heading }: { languages: readonly LanguageEntry[]; heading?: string }) {
  const t = await getTranslations("Admin");
  const { words } = await summaryWords();
  return (
    <Panel glyph="description" collapsible id="box-description" title={heading ?? t("editor.boxes.description.title")} aside={descriptionSummary(words, languages.map(summaryOf))}>
      <LanguageTabs
        idPrefix="description"
        languages={languages}
        watch={{ names: ["body"], rule: "parity" }}
        blank={BLANK.description}
        identical={["body"]}
        render={(entry) => <DescriptionFields translation={entry.translation} mayEdit={entry.mayEdit} />}
      />
    </Panel>
  );
}

/**
 * "Regulamentul" (`#box-rules`, §481): the rules per language, then the one `event.minAge` for
 * every type (§505). A group run keeps its note that only an age above eighteen changes its
 * adults-only self-declaration (§440). A settings reader sees the number; the server refuses a
 * change anyway (`canEditEventFields`, BR-REQ-060-01).
 */
export async function RulesBox({
  languages,
  event,
  mayEditSettings,
}: {
  languages: readonly LanguageEntry[];
  event: EditableEvent | null;
  mayEditSettings: boolean;
}) {
  const t = await getTranslations("Admin");
  const { words } = await summaryWords();
  const locale = await getLocale();
  // Never under fourteen (§515): an older, lower value opens at fourteen.
  const minAge = effectiveMinimumAge(event?.minAge);
  const aside = [rulesSummary(words, languages.map(summaryOf)), minAgeSummary(words, minAge, locale)].join(words.separator);
  return (
    <Panel glyph="rules" collapsible level={3} id="box-rules" title={t("editor.boxes.rules.title")} aside={aside}>
      <LanguageTabs
        idPrefix="rules"
        languages={languages}
        watch={{ names: ["rules"], rule: "parity" }}
        blank={BLANK.rules}
        identical={["rules"]}
        render={(entry) => <RulesFields translation={entry.translation} mayEdit={entry.mayEdit} />}
      />
      <Stack spacing={1} sx={{ mt: 2 }} data-testid="min-age-card">
        {mayEditSettings ? (
          <RecallField
            name="event.minAge"
            label={t("editor.minAge")}
            helperText={t("editor.minAgeHelp", { default: MIN_PARTICIPANT_AGE })}
            defaultValue={minAge}
            {...textFieldConstraints(eventInputConstraints("minAge"), { inputMode: "numeric" })}
            sx={{ width: { sm: 220 } }}
          />
        ) : (
          <BoxNote testId="min-age-read-only">{t("editor.minAgeReadOnly", { age: capitalizeFirst(minAgeSummary(words, minAge, locale), locale) })}</BoxNote>
        )}
        {/* A group run's self-declaration is for adults (§440): the note says which numbers change it. */}
        <OnlyForType type="GROUP_RUN" selectName="event.type" initialType={event?.type ?? "GROUP_RUN"}>
          <BoxNote testId="group-run-min-age-note">{t("editor.groupRunDeclaration.minAgeHelp")}</BoxNote>
        </OnlyForType>
      </Stack>
    </Panel>
  );
}

/**
 * "Adresa paginii și motoarele de căutare": open while any address is blank (so on create, where
 * `SlugFromTitle` fills it). Not a page section, so it sits with those cards (§406).
 */
export async function AddressBox({
  languages,
  slugLocked,
  creating,
}: {
  languages: readonly LanguageEntry[];
  slugLocked: boolean;
  creating: boolean;
}) {
  const t = await getTranslations("Admin");
  const { words } = await summaryWords();
  const translations = languages.map(summaryOf);
  const blank = incompleteLocales(translations, "required", BLANK.address);
  // Each language's path to an event, without the address.
  const paths = Object.fromEntries(
    languages.map((entry) => {
      const locale = entry.translation.locale as Locale;
      const path = getPathname({ locale, href: { pathname: "/events/[slug]", params: { slug: "x" } } });
      return [locale, path.slice(0, path.lastIndexOf("/"))];
    }),
  );
  const required = await requiredLine("address", null, languages);
  return (
    <Panel glyph="address"
      collapsible
      id="box-address"
      title={t("editor.boxes.address.title")}
      aside={lineOf(required, addressSummary(words, translations, paths, slugLocked))}
      openWhen={{ attention: blank.length > 0 }}
    >
      {creating && <SlugFromTitle locales={languages.map((entry) => entry.translation.locale)} />}
      <LanguageTabs
        idPrefix="address"
        languages={languages}
        watch={{ names: ["slug"], rule: "required" }}
        blank={BLANK.address}
        required="address"
        render={(entry) => <AddressFields translation={entry.translation} mayEdit={entry.mayEdit} slugLocked={slugLocked} />}
      />
    </Panel>
  );
}
