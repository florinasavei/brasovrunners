import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { getDb } from "@/db/client";
import { Link } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";
import EditorPanel from "@/modules/content/events/ui/EditorPanel";
import EventFieldsForm from "@/modules/content/events/ui/EventFieldsForm";
import RepeatFields from "@/modules/content/events/ui/RepeatFields";
import RepeatToggle from "@/modules/content/events/ui/RepeatToggle";
import TranslationFieldsForm, { blankTranslation } from "@/modules/content/events/ui/TranslationFieldsForm";
import { listApprovedVersions } from "@/modules/legal-documents/repository";
import { canCreateEvent } from "@/modules/staff-identity/domain/roles";
import { requireStaff } from "@/modules/staff-identity/session";
import LocaleTabPanels from "@/shared/ui/LocaleTabPanels";
import GlyphSubmitButton from "@/shared/ui/GlyphSubmitButton";
import { createEventAction } from "../../actions";

type Props = {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ error?: string }>;
};

export const dynamic = "force-dynamic";

/**
 * A new event (BR-REQ-050-01), out of the editor's own pieces.
 *
 * Both languages are asked for here rather than "Romanian now, English later": publication
 * requires a complete translation in every locale (`DECISIONS.md` §28), and a form that lets
 * one language be skipped produces an event that cannot be published and nobody remembers why.
 *
 * **The same panels as the editor, in the same order** — the owner, screenshot in hand: "this
 * event create page is a bit inconsistent with the event edit: there is no rich text editor??
 * per language content should be tabbed". It used to render its own two stacked "Conținut"
 * sections with a title, a slug and a plain one-line excerpt, and the editor had long since
 * moved on to tabs, a rich summary and folds. So the languages are `LocaleTabPanels` over
 * `TranslationFieldsForm` now, each handed a blank translation, and the settings are
 * `EventFieldsForm` as they always were; what the two pages post is read by the same two
 * readers in `admin/actions.ts`, so they cannot drift again. Only the panels that need data
 * an unsaved event does not have are absent: publication, the queue, the bibs.
 *
 * **Recurrence first.** The owner: "«Repetă evenimentul» ar trebui să apară sus de tot, la
 * început" — whether this is one date or a series is the first thing decided, before the date
 * itself, and it stood at the very bottom. A tick, then the frequency (§170), as on the editor.
 *
 * The type defaults to a group run, as `EventFieldsForm` does, so the programme notes and the
 * registration panel follow the type select from the same starting point on both pages.
 */
export default async function NewEventPage({ params, searchParams }: Props) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);

  const staffUser = await requireStaff();
  // The action asserts this again; hiding the form from an Author is the courtesy half.
  if (!canCreateEvent(staffUser.role)) notFound();

  const { error } = await searchParams;
  const declarations = await listApprovedVersions(getDb(), "EVENT_DECLARATION", locale);
  const t = await getTranslations("Admin");
  // The language endonyms are shared with the public switcher and the editor's tabs.
  const tSite = await getTranslations("Site");

  return (
    <Stack spacing={3}>
      <Typography variant="body2">
        <Link href="/admin">{t("backToEvents")}</Link>
      </Typography>

      <Typography variant="h2" sx={{ fontSize: "1.25rem" }}>
        {t("editor.newTitle")}
      </Typography>

      {error && <Alert severity="error">{t(`errors.${error}`)}</Alert>}
      <Alert severity="info">{t("editor.newHelp")}</Alert>

      <form action={createEventAction}>
        <input type="hidden" name="uiLocale" value={locale} />

        <Stack spacing={3}>
          {/* Recurrence, first (BR-REQ-050-02 criterion 7). The copies are drafts like the
              event itself; the list publishes them together. A tick first, the frequency after
              it (§170) — the select's "does not repeat" option existed only because the control
              was always shown. */}
          <EditorPanel title={t("editor.repeatSection")} headingId="panel-repeat">
            <RepeatToggle name="repeat.on" label={t("editor.repeatOn")}>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                {t("editor.repeatOnCreateHelp")}
              </Typography>
              <RepeatFields prefix="repeat." />
            </RepeatToggle>
          </EditorPanel>

          {/* The words, as the editor asks for them (§170, §260): one tab per language,
              Romanian first, the rich summary and the folds. Blank rows: no id, no version, so
              the panel posts neither and the action reads the fields directly. */}
          <EditorPanel
            title={t("editor.contentSection")}
            help={t("editor.contentHelp")}
            headingId="panel-content"
          >
            <LocaleTabPanels
              panels={routing.locales.map((contentLocale) => ({
                locale: contentLocale,
                label: tSite(`languageName.${contentLocale}`),
                content: (
                  <TranslationFieldsForm
                    translation={blankTranslation(contentLocale)}
                    eventType="GROUP_RUN"
                    slugLocked={false}
                    mayEdit
                  />
                ),
              }))}
            />
          </EditorPanel>

          <EventFieldsForm event={null} declarations={declarations} />

          <Box>
            <GlyphSubmitButton label={t("editor.create")} pendingLabel={t("editor.saving")} icon="add" size="medium" />
          </Box>
        </Stack>
      </form>
    </Stack>
  );
}
