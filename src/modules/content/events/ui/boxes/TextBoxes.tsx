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
  incompleteLocales,
  rulesSummary,
  type SummaryTranslation,
  titleSummarySummary,
} from "../box-summaries";
import SlugFromTitle from "../SlugFromTitle";
import { AddressFields, DescriptionFields, RulesFields, TitleSummaryFields } from "../TranslationFields";
import { type LanguageEntry, summaryWords } from "./box-kit";

/**
 * The four boxes of the event editor that are only words (§NNN): the title and summary, the
 * description, the rules, the page address. Each has its own Română | English tabs — six strips on
 * one page, so each carries its box's `idPrefix` — and each tab says "· incomplet" by its own rule:
 * a required text missing here (the title, the summary, the address), or an optional one written
 * in the other language and not in this one (the description, the rules).
 */

const summaryOf = (entry: LanguageEntry): SummaryTranslation => entry.translation;

/** One strip of tabs, its marks computed from what is stored and then from what is typed. */
export async function LanguageTabs({
  idPrefix,
  languages,
  watch,
  blank,
  render,
}: {
  idPrefix: string;
  languages: readonly LanguageEntry[];
  watch: TabWatch;
  blank: BlankTest | readonly BlankTest[];
  render: (entry: LanguageEntry) => ReactNode;
}) {
  const t = await getTranslations("Admin");
  const incomplete = incompleteLocales(languages.map(summaryOf), watch.rule, blank);
  return (
    <LocaleTabPanels
      idPrefix={idPrefix}
      // Only the languages the reader may write are re-read as they type; a read-only one has no box.
      watch={languages.some((entry) => entry.mayEdit) ? watch : undefined}
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

/** Box 2, "Titlu și rezumat": open on create, and on the editor while a language lacks either. */
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
      openWhen={{ attention: creating || incomplete.length > 0 }}
    >
      <LanguageTabs
        idPrefix="title"
        languages={languages}
        watch={{ names: ["title", "excerptBody"], rule: "required" }}
        blank={BLANK.titleSummary}
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
