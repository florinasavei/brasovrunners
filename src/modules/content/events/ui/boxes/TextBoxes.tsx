import { getTranslations } from "next-intl/server";
import type { ReactNode } from "react";
import { getPathname } from "@/i18n/navigation";
import type { Locale } from "@/i18n/routing";
import LocaleTabPanels, { type TabWatch } from "@/shared/ui/LocaleTabPanels";
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
import SlugFromTitle from "../SlugFromTitle";
import { AddressFields, DescriptionFields, RulesFields, TitleSummaryFields } from "../TranslationFields";
import { type LanguageEntry, summaryWords } from "./box-kit";

/**
 * The four boxes of the event editor that are only words (§350): the title and summary, the
 * description, the rules, the page address. Each has its own Română | English tabs — six strips on
 * one page, so each carries its box's `idPrefix` — and each tab says "· incomplet" by its own rule:
 * a required text missing here (the title, the summary, the address), or an optional one written
 * in the other language and not in this one (the description, the rules).
 */

const summaryOf = (entry: LanguageEntry): SummaryTranslation => entry.translation;

/**
 * One strip of tabs, its marks computed from what is stored and then from what is typed.
 *
 * `identical` names the long texts of the strip to compare across languages (§NNN, bilingual
 * everywhere): the same words in both is an amber line over the panels and a mark on the English
 * tab — computed here from what is stored for the first paint, re-read in the browser as typed.
 */
export async function LanguageTabs({
  idPrefix,
  languages,
  watch,
  blank,
  identical,
  render,
}: {
  idPrefix: string;
  languages: readonly LanguageEntry[];
  watch: TabWatch;
  blank: BlankTest | readonly BlankTest[];
  identical?: readonly string[];
  render: (entry: LanguageEntry) => ReactNode;
}) {
  const t = await getTranslations("Admin");
  const incomplete = incompleteLocales(languages.map(summaryOf), watch.rule, blank);
  const mayType = languages.some((entry) => entry.mayEdit);
  return (
    <LocaleTabPanels
      idPrefix={idPrefix}
      // Only the languages the reader may write are re-read as they type; a read-only one has no box.
      watch={mayType ? watch : undefined}
      live={mayType}
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
        content: render(entry),
      }))}
    />
  );
}

/**
 * Box 2, "Titlu și rezumat": open on create, where it is the first thing a new event is asked —
 * the page's own verb (`primary`, fold.ts), not a warning — and on the editor while a language
 * lacks either (`attention`: something inside asks for action).
 */
export async function TitleSummaryBox({ languages, creating }: { languages: readonly LanguageEntry[]; creating: boolean }) {
  const t = await getTranslations("Admin");
  const { words } = await summaryWords();
  const translations = languages.map(summaryOf);
  const incomplete = incompleteLocales(translations, "required", BLANK.titleSummary);
  return (
    <Panel
      collapsible
      id="box-title"
      title={t("editor.boxes.titleSummary.title")}
      aside={creating ? undefined : titleSummarySummary(words, translations)}
      openWhen={{ primary: creating, attention: !creating && incomplete.length > 0 }}
    >
      <LanguageTabs
        idPrefix="title"
        languages={languages}
        watch={{ names: ["title", "excerptBody"], rule: "required" }}
        blank={BLANK.titleSummary}
        identical={["excerptBody"]}
        render={(entry) => <TitleSummaryFields translation={entry.translation} mayEdit={entry.mayEdit} />}
      />
    </Panel>
  );
}

/** Box 3, "Descrierea evenimentului": folded on both pages; the heaviest editor mounts on opening. */
export async function DescriptionBox({ languages }: { languages: readonly LanguageEntry[] }) {
  const t = await getTranslations("Admin");
  const { words } = await summaryWords();
  return (
    <Panel collapsible id="box-description" title={t("editor.boxes.description.title")} aside={descriptionSummary(words, languages.map(summaryOf))}>
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

/** Box 7, "Regulamentul". */
export async function RulesBox({ languages }: { languages: readonly LanguageEntry[] }) {
  const t = await getTranslations("Admin");
  const { words } = await summaryWords();
  return (
    <Panel collapsible id="box-rules" title={t("editor.boxes.rules.title")} aside={rulesSummary(words, languages.map(summaryOf))}>
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
 * Box 14, "Adresa paginii și motoarele de căutare": open while any address is blank — so open on
 * create, where the address also fills itself from the title until it is typed (`SlugFromTitle`).
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
  return (
    <Panel
      collapsible
      id="box-address"
      title={t("editor.boxes.address.title")}
      aside={addressSummary(words, translations, paths, slugLocked)}
      openWhen={{ attention: blank.length > 0 }}
    >
      {creating && <SlugFromTitle locales={languages.map((entry) => entry.translation.locale)} />}
      <LanguageTabs
        idPrefix="address"
        languages={languages}
        watch={{ names: ["slug"], rule: "required" }}
        blank={BLANK.address}
        render={(entry) => <AddressFields translation={entry.translation} mayEdit={entry.mayEdit} slugLocked={slugLocked} />}
      />
    </Panel>
  );
}
