import Stack from "@mui/material/Stack";
import { getLocale, getTranslations } from "next-intl/server";
import type { ReactNode } from "react";
import { capitalizeFirst } from "@/i18n/dates";
import { getPathname } from "@/i18n/navigation";
import { type Locale, routing } from "@/i18n/routing";
import { effectiveMinimumAge, MIN_PARTICIPANT_AGE } from "@/modules/registrations/domain/age";
import { isStorageConfigured } from "@/modules/media/storage";
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
import CoverBox, { coverPicture } from "./CoverBox";

/**
 * The four boxes of the event editor that are only words (§350): the title and summary, the
 * description, the rules, the page address. Each has its own Română | English tabs — five strips on
 * one page with the programme's, so each carries its box's `idPrefix` — and each tab says what it
 * lacks by its own rule: a count of the boxes publication needs still empty here (the title and
 * the summary, the address — «Română · 2 obligatorii lipsă», «English · complet», §406), or
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
 * `required` names the card's publication gaps (§406): each tab then counts the boxes publication
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
        box: required,
      }
    : undefined;
  return (
    <LocaleTabPanels
      idPrefix={idPrefix}
      // Only the languages the reader may write are re-read as they type; a read-only one has no box.
      watch={mayType ? watch : undefined}
      live={mayType}
      // «Tradu cardul: RO → EN» at the end of the card's tab row (§514). Every card here has words:
      // the address card's are the two search-engine texts beside the `slug`, which is not one.
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
 * Card 2, "Titlu și rezumat" (§350): open on create, where it is the first thing a new event is
 * asked — the page's own verb (`primary`, fold.ts), not a warning — and on the editor while a
 * language lacks either (`attention`: something inside asks for action).
 *
 * **Two named cards in it since §NNN** (the owner, 2026-10-13: «practic vreau mai puține carduri și
 * mai mult nesting, nu trebuie să fie un card separat»), after the title's own tabs: «Adresa paginii și
 * motoarele de căutare» (`AddressBox`, `#box-address`) — the address and the search title are made
 * from the title — and «Copertă» (`CoverBox`, `#box-cover`), the picture that travels with the title
 * wherever the event is shown as a card or shared. Both were cards of their own among those not on
 * the page (§406); their fields, names and ids are as they were.
 *
 * Its closed line starts with what publication still needs from it (§406) — the title's and the
 * summary's, and since §NNN the address's, which is inside it now («lipsesc: Titlu (EN) · Adresa
 * paginii (EN)») — then the titles and whether there is a cover. It opens itself while an address is
 * blank too, as the address card did, so the card that asks for it is never shut around it.
 */
export async function TitleSummaryBox({
  languages,
  creating,
  heading,
  event,
  mayEditSettings,
  slugLocked,
}: {
  languages: readonly LanguageEntry[];
  creating: boolean;
  heading?: string;
  /** The event, for its cover (null on the create page). */
  event: EditableEvent | null;
  /** Whether the reader may change the event row: the cover is a setting (§NNN). */
  mayEditSettings: boolean;
  /** The address is kept once the page was published (§36). */
  slugLocked: boolean;
}) {
  const t = await getTranslations("Admin");
  const { words } = await summaryWords();
  const translations = languages.map(summaryOf);
  const incomplete = incompleteLocales(translations, "required", BLANK.titleSummary);
  const blankAddress = incompleteLocales(translations, "required", BLANK.address);
  // The title's gaps and the address's, in one line: the address is a card of this one (§NNN).
  const required = await requiredLine(["titleSummary", "address"], null, languages);
  // Awaited, not nested: each element is ready when the card is (`requiredLine` does the same).
  const address = await AddressBox({ languages, slugLocked, creating });
  const picture = await coverPicture(event);
  const cover = await CoverBox({ event, mayEditSettings, picture });
  // Only where a cover can be chosen: with no media store the card says so, and «De făcut» asks for none (§749, §NNN).
  const coverState = isStorageConfigured()
    ? t("editor.boxes.titleSummary.coverLine", { state: picture ? t("editor.cover.set") : t("editor.cover.missing") })
    : null;
  return (
    <Panel glyph="title"
      collapsible
      id="box-title"
      title={heading ?? t("editor.boxes.titleSummary.title")}
      aside={lineOf(required, creating ? undefined : [titleSummarySummary(words, translations), coverState].filter(Boolean).join(words.separator))}
      openWhen={{ primary: creating, attention: !creating && (incomplete.length > 0 || blankAddress.length > 0) }}
    >
      <Stack spacing={2}>
        <LanguageTabs
          idPrefix="title"
          languages={languages}
          watch={{ names: ["title", "excerptBody"], rule: "required" }}
          blank={BLANK.titleSummary}
          identical={["excerptBody"]}
          required="titleSummary"
          render={(entry) => <TitleSummaryFields translation={entry.translation} mayEdit={entry.mayEdit} />}
        />
        {/* 2.1 — the page's address and the search engines' title, made from the title (§NNN). */}
        {address}
        {/* 2.2 — the cover (§709), the picture that goes with the title (§NNN). */}
        {cover}
      </Stack>
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
 * "Regulamentul" (`#box-rules`), a named card of «Participare, înscrieri și regulament» since §NNN
 * (`RegistrationBox`; of «Program, regulament și declarație» from §481): the rules in each language,
 * on their own tabs. The declaration (§448) is the card right after it — the minimum age below and
 * the declaration under it, read together.
 *
 * **The minimum age is here, one box for every type** (§505). It was two boxes — the race's in
 * «Participare și înscrieri» › «Condiții de participare» (§329), a group run's own in «Traseul»
 * (§440) — and neither was shown for a type that registers elsewhere or not at all. Now one
 * `event.minAge`, after the rules' tabs, on every event: who may take part is read with the rules.
 * A group run keeps §440's note under it — its self-declaration is for adults, so only a number
 * above eighteen changes what it asks. A role without settings rights reads the number instead of
 * the box; the server refuses its change regardless (`canEditEventFields`, BR-REQ-060-01).
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
  // Never under fourteen (§515): an event saved with less under §329 opens at fourteen, which the box accepts.
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
 * "Adresa paginii și motoarele de căutare": open while any address is blank — so open on create,
 * where the address also fills itself from the title until it is typed (`SlugFromTitle`). Not a
 * section of the page — it is the page's address — so it sat with the cards that are not (§406);
 * since §NNN it is a named card of «Titlu și rezumat» (`TitleSummaryBox`), whose title it is made
 * from, and that card opens with it while an address is blank.
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
    <Panel glyph="address"
      collapsible
      level={3}
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
