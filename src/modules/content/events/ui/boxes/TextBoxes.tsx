import { getLocale, getTranslations } from "next-intl/server";
import type { ReactNode } from "react";
import { getPathname } from "@/i18n/navigation";
import { type Locale, routing } from "@/i18n/routing";
import LocaleTabPanels, { type RequiredCountWords, type TabWatch } from "@/shared/ui/LocaleTabPanels";
import Panel from "@/shared/ui/Panel";
import {
  addressSummary,
  BLANK,
  type BlankTest,
  descriptionSummary,
  identicalLocales,
  incompleteLocales,
  rulesSummary,
  type SummaryTranslation,
  titleSummarySummary,
} from "../box-summaries";
import { missingForPublish, missingInLanguage, type PublishGapBox, storedPublishReader } from "../publish-check";
import SlugFromTitle from "../SlugFromTitle";
import { AddressFields, DescriptionFields, RulesFields, TitleSummaryFields } from "../TranslationFields";
import { type LanguageEntry, requiredLine, summaryWords } from "./box-kit";

/**
 * The four boxes of the event editor that are only words (§350): the title and summary, the
 * description, the rules, the page address. Each has its own Română | English tabs — five strips on
 * one page with the programme's, so each carries its box's `idPrefix` — and each tab says what it
 * lacks by its own rule: a count of the boxes publication needs still empty here (the title and
 * the summary, the address — «Română · 2 obligatorii lipsă», «English · complet», §NNN), or
 * "· incomplet" for an optional text written in the other language and not in this one (the
 * description, the rules).
 */

const summaryOf = (entry: LanguageEntry): SummaryTranslation => entry.translation;

/**
 * One strip of tabs, its marks computed from what is stored and then from what is typed.
 *
 * `identical` names the long texts of the strip to compare across languages (§354, bilingual
 * everywhere): the same words in both is an amber line over the panels and a mark on the English
 * tab — computed here from what is stored for the first paint, re-read in the browser as typed.
 *
 * `required` names the card's publication gaps (§NNN): each tab then counts the boxes publication
 * needs that its language still lacks, first from `missingForPublish` over what the strip was drawn
 * with — the check the card's closed line and Publicare read — then as it is typed.
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
      }
    : undefined;
  return (
    <LocaleTabPanels
      idPrefix={idPrefix}
      // Only the languages the reader may write are re-read as they type; a read-only one has no box.
      watch={mayType ? watch : undefined}
      live={mayType}
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
 * "Titlu și rezumat" (§350): open on create, where it is the first thing a new event is asked —
 * the page's own verb (`primary`, fold.ts), not a warning — and on the editor while a language
 * lacks either (`attention`: something inside asks for action). Its closed line starts with what
 * publication still needs from it (§NNN).
 */
export async function TitleSummaryBox({ languages, creating, heading }: { languages: readonly LanguageEntry[]; creating: boolean; heading?: string }) {
  const t = await getTranslations("Admin");
  const { words } = await summaryWords();
  const translations = languages.map(summaryOf);
  const incomplete = incompleteLocales(translations, "required", BLANK.titleSummary);
  const required = await requiredLine("titleSummary", null, languages);
  return (
    <Panel
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
    <Panel collapsible id="box-description" title={heading ?? t("editor.boxes.description.title")} aside={descriptionSummary(words, languages.map(summaryOf))}>
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

/** "Regulamentul". */
export async function RulesBox({ languages, heading }: { languages: readonly LanguageEntry[]; heading?: string }) {
  const t = await getTranslations("Admin");
  const { words } = await summaryWords();
  return (
    <Panel collapsible id="box-rules" title={heading ?? t("editor.boxes.rules.title")} aside={rulesSummary(words, languages.map(summaryOf))}>
      <LanguageTabs
        idPrefix="rules"
        languages={languages}
        watch={{ names: ["rules"], rule: "parity" }}
        blank={BLANK.rules}
        identical={["rules"]}
        render={(entry) => <RulesFields translation={entry.translation} mayEdit={entry.mayEdit} />}
      />
    </Panel>
  );
}

/**
 * "Adresa paginii și motoarele de căutare": open while any address is blank — so open on create,
 * where the address also fills itself from the title until it is typed (`SlugFromTitle`). Not a
 * section of the page — it is the page's address — so it sits with the cards that are not (§NNN).
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
  // "/ro/evenimente", "/en/events": each language's own path to an event, without the address.
  const paths = Object.fromEntries(
    languages.map((entry) => {
      const locale = entry.translation.locale as Locale;
      const path = getPathname({ locale, href: { pathname: "/events/[slug]", params: { slug: "x" } } });
      return [locale, path.slice(0, path.lastIndexOf("/"))];
    }),
  );
  const required = await requiredLine("address", null, languages);
  return (
    <Panel
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
