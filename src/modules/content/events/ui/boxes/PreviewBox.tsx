import { getTranslations } from "next-intl/server";
import { getPathname } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";
import type { RefusalMessages } from "@/shared/forms/ActionFormIsland";
import Panel from "@/shared/ui/Panel";
import EventDraftPreview, { type EventDraftPreviewLabels } from "../EventDraftPreview";

type Locale = (typeof routing.locales)[number];

/** One value per language, in the order the club works in. */
function perLocale<T>(make: (locale: Locale) => T): Record<Locale, T> {
  return Object.fromEntries(routing.locales.map((locale) => [locale, make(locale)])) as Record<Locale, T>;
}

/**
 * «Previzualizare» (§579, amending §406): the editor's card that shows the event as the site will —
 * the listing card, the whole page and the registration form (§586), in Română or English, on a
 * phone or a desktop — from the
 * save form's values as they stand, before anything is saved or published. Closed by default, its
 * closed line saying what it is for; a card like every other of the editor, apart from the page's
 * sections because it is not one of them.
 *
 * The words are the backoffice's, both languages (§354); the refusal's box names are the save's own
 * (`refusal.fields`, `eventFormFieldLabels`), so a box the save would refuse is named the same way
 * in both places. Offered only to a role that may preview (`canPreviewEventDraft`): the action
 * behind it asks again (BR-REQ-060-01).
 */
export default async function PreviewBox({ formId, refusal }: { formId: string; refusal: RefusalMessages }) {
  const t = await getTranslations("Admin");
  const tSite = await getTranslations("Site");
  const labels: EventDraftPreviewLabels = {
    run: t("editor.draftPreview.run"),
    running: t("editor.draftPreview.running"),
    views: t("editor.draftPreview.views"),
    card: t("editor.draftPreview.card"),
    page: t("editor.draftPreview.page"),
    form: t("editor.draftPreview.form"),
    language: t("editor.draftPreview.language"),
    width: t("editor.draftPreview.width"),
    phone: t("editor.draftPreview.phone"),
    desktop: t("editor.draftPreview.desktop"),
    idle: t("editor.draftPreview.idle"),
    asOfPress: t("editor.draftPreview.asOfPress"),
    // Its two placeholders are filled in the browser, with the language and the boxes it lacks.
    incomplete: t.raw("editor.draftPreview.incomplete") as string,
    complete: t("editor.draftPreview.complete"),
    refused: t("editor.draftPreview.refused"),
    failed: t("editor.draftPreview.failed"),
    forbidden: t("editor.draftPreview.forbidden"),
    frameTitle: t("editor.draftPreview.frameTitle"),
  };
  return (
    <Panel
      glyph="preview"
      collapsible
      id="box-preview"
      title={t("editor.boxes.preview.title")}
      aside={t("editor.boxes.preview.summary")}
      intro={t("editor.draftPreview.intro")}
    >
      <EventDraftPreview
        formId={formId}
        // The frame in each language, at its own address: its words and its dates are that language's.
        frameSrc={perLocale((locale) => getPathname({ locale, href: "/preview/draft" }))}
        // The site's locale switcher's words, «RO» | «EN».
        languageCodes={perLocale((locale) => tSite(`languageCode.${locale}`))}
        languageNames={perLocale((locale) => tSite(`languageName.${locale}`))}
        fieldLabels={refusal.fields}
        errors={refusal.errors}
        labels={labels}
      />
    </Panel>
  );
}
