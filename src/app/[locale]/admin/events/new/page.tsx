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
import CourseBox from "@/modules/content/events/ui/boxes/CourseBox";
import CoHostsBox from "@/modules/content/events/ui/boxes/CoHostsBox";
import KindBox from "@/modules/content/events/ui/boxes/KindBox";
import LinksBox from "@/modules/content/events/ui/boxes/LinksBox";
import PlaceBox from "@/modules/content/events/ui/boxes/PlaceBox";
import ProgrammeBox from "@/modules/content/events/ui/boxes/ProgrammeBox";
import PromotionBox from "@/modules/content/events/ui/boxes/PromotionBox";
import RegistrationBox from "@/modules/content/events/ui/boxes/RegistrationBox";
import StatusBox from "@/modules/content/events/ui/boxes/StatusBox";
import { AddressBox, DescriptionBox, RulesBox, TitleSummaryBox } from "@/modules/content/events/ui/boxes/TextBoxes";
import WhenBox from "@/modules/content/events/ui/boxes/WhenBox";
import CreateAndPublishButton from "@/modules/content/events/ui/CreateAndPublishButton";
import CreateDraftLine, { TickedLine } from "@/modules/content/events/ui/CreateDraftLine";
import EventEditorLayout, { EditorGroup } from "@/modules/content/events/ui/EventEditorLayout";
import { eventFormFieldLabels, identicalTextLabels } from "@/modules/content/events/ui/field-labels";
import { MissingForPublishCount, MissingForPublishList } from "@/modules/content/events/ui/MissingForPublish";
import RepeatFields from "@/modules/content/events/ui/RepeatFields";
import RepeatToggle from "@/modules/content/events/ui/RepeatToggle";
import { blankTranslation } from "@/modules/content/events/ui/TranslationFields";
import { daysPhrase } from "@/modules/deadlines/domain/duration-words";
import { deadlinesForThisRequest } from "@/modules/deadlines/request";
import { groupRunDeclarationsInForce, listApprovedVersions } from "@/modules/legal-documents/repository";
import { canCreateEvent, canTransition } from "@/modules/staff-identity/domain/roles";
import { requireStaff } from "@/modules/staff-identity/session";
import { THEN_FIELD, THEN_PUBLISH } from "@/modules/content/events/form-names";
import { confirmWords } from "@/shared/feedback/confirm-words";
import { refusalMessages } from "@/shared/forms/refusal-messages";
import ActionForm from "@/shared/forms/ActionForm";
import GlyphSubmitButton from "@/shared/ui/GlyphSubmitButton";
import Panel from "@/shared/ui/Panel";
import { createEventAction } from "../../actions";

type Props = {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ error?: string }>;
};

export const dynamic = "force-dynamic";

/**
 * A new event (BR-REQ-050-01), on the editor's own page (§350).
 *
 * **The same page as the editor, minus what needs a saved event** — the owner asked for "a
 * WordPress-like editor" and then for create and edit to stop drifting apart ("this event create
 * page is a bit inconsistent with the event edit"). So it is the editor's layout
 * (`EventEditorLayout`): the side column with Publicare and Recurență, first on a phone, and the
 * main column's boxes in the same three groups, under the same titles, with the same field names
 * and the same Română | English tabs — "Ce fel de eveniment" holding the same three cards, the
 * status, the course and the links (§358). The status card is the one that is read-only here: it
 * says "Programat" and that the status can be changed once the event exists, and a hidden
 * `SCHEDULED` is what posts, so "Anulat" is never offered for an event that does not exist. What
 * the page leaves out cannot exist before the event does: allocation and printing, the series'
 * details, the registrations, copy and delete. Nothing stands in for what is left out.
 *
 * Both languages are asked for here rather than "Romanian now, English later": publication
 * requires a complete translation in every locale (`DECISIONS.md` §28).
 *
 * **Recurrence first** (BR-REQ-050-02 criterion 7): the Recurență box is the side column's second
 * box, first in the document, open, and a single switch until it is ticked. Its "Publică datele
 * noi automat" posts as `repeat.publish`.
 *
 * **The weekly group run in a minute**: the type is already a group run, the page address fills
 * itself from the title (`SlugFromTitle`), so it is the title, the summary, the date, the place,
 * the repeat tick and "Creează și publică".
 *
 * **A refusal keeps every box** (§315): the whole grid is inside one `ActionForm`, and every
 * input reads the recalled values. A named box three folds deep opens itself.
 *
 * **Create and publish in one press**, for a role that may publish (§315): the second button
 * dims and names the first gap by its box and tab, from the same check the Publicare box's list
 * runs (`missingForPublish`).
 */
export default async function NewEventPage({ params, searchParams }: Props) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);

  const staffUser = await requireStaff();
  // The action asserts this again; hiding the form from an Author is the courtesy half.
  if (!canCreateEvent(staffUser.role)) notFound();
  // Whether the second button is offered at all: the service asks the same question again.
  const mayPublish = canTransition(staffUser.role, "IN_REVIEW", "PUBLISHED", false);

  const { error } = await searchParams;
  const declarations = await listApprovedVersions(getDb(), "EVENT_DECLARATION", locale);
  // The club's deadlines (§377): the reminder an event left "as usual" gets, and how far ahead a series is created.
  const deadlines = await deadlinesForThisRequest();
  const horizon = daysPhrase(locale, deadlines.seriesHorizonDays);
  const t = await getTranslations("Admin");
  // The language endonyms are shared with the public switcher and the editor's tabs.
  const tSite = await getTranslations("Site");
  const messages = await refusalMessages(await eventFormFieldLabels());

  const languages = routing.locales.map((contentLocale) => ({
    translation: blankTranslation(contentLocale),
    mayEdit: true,
    label: tSite(`languageName.${contentLocale}`),
  }));
  const localeCodes = [...routing.locales];
  const gapLabels = {
    boxes: {
      titleSummary: t("editor.boxes.titleSummary.title"),
      place: t("editor.boxes.place.title"),
      address: t("editor.boxes.address.title"),
    },
    fields: {
      title: t("editor.fields.title"),
      excerpt: t("editor.boxes.summaryLabel"),
      locationName: t("editor.fields.locationName"),
      slug: t("editor.fields.slug"),
    },
    languages: Object.fromEntries(routing.locales.map((contentLocale) => [contentLocale, tSite(`languageName.${contentLocale}`)])),
  };
  // Which group-run declarations the club has approved (§NNN): the route card's checkbox asks.
  const box = { event: null, mayEditSettings: true, groupRunDeclarations: await groupRunDeclarationsInForce(getDb(), new Date()) } as const;
  /*
    "Creează și publică" puts an event on the site in one press (§384): it asks first, as the
    editor's "Publică" does. The plain create makes a draft nobody sees and asks nothing — the
    question is chosen by the button that was pressed (`then=publish`).
  */
  const words = await confirmWords();
  const publishConfirm = mayPublish
    ? [{ when: [{ field: THEN_FIELD, equals: THEN_PUBLISH }], title: t("confirm.createPublishTitle"), body: t("confirm.publishBody"), confirmLabel: t("editor.createAndPublish"), cancelLabel: words.cancel }]
    : undefined;

  return (
    <Stack spacing={3}>
      <Typography variant="body2">
        <Link href="/admin">{t("backToEvents")}</Link>
      </Typography>

      <Typography variant="h2" sx={{ fontSize: "1.35rem" }}>
        {t("editor.newTitle")}
      </Typography>

      {error && <Alert severity="error">{t(`errors.${error}`)}</Alert>}

      <ActionForm action={createEventAction} messages={messages} confirm={publishConfirm} id="event-create-form" data-testid="event-create-form">
        <input type="hidden" name="uiLocale" value={locale} />
        {/* An event that does not exist yet is scheduled (§350): the status card shows it, read-only,
            and this is what posts (§358). */}
        <input type="hidden" name="event.eventStatus" value="SCHEDULED" />

        <EventEditorLayout
          side={
            <>
              {/* S1 — folded: five empty-field lines at the top of a phone would be noise; its
                  closed line counts them, live. */}
              <Panel
                collapsible
                id="box-publication"
                title={t("editor.publicationSection")}
                aside={
                  <MissingForPublishCount
                    locales={localeCodes}
                    template={t.raw("editor.publication.createSummary") as string}
                    ready={t("editor.publication.createReady")}
                  />
                }
              >
                <Stack spacing={1.5}>
                  <Typography variant="body2">{t("editor.publication.createDraft")}</Typography>
                  <MissingForPublishList
                    locales={localeCodes}
                    labels={gapLabels}
                    title={t("editor.publication.missingTitle")}
                    complete={t("editor.publication.nothingMissing")}
                    // The Romanian pasted into the English box, as it is typed (§354): a warning, never a refusal.
                    identical={{ labels: await identicalTextLabels(), title: t("editor.identical.listTitle") }}
                  />
                </Stack>
              </Panel>

              {/* S2 — recurrence first (BR-REQ-050-02 criterion 7): open, and a single switch
                  until it is ticked. The copies are drafts like the event itself, or live with it. */}
              <Panel collapsible openWhen={{ primary: true }} id="box-recurrence" title={t("editor.boxes.recurrence.title")} aside={<TickedLine name="repeat.on" off={t("editor.boxes.recurrence.none")} on={t("editor.boxes.recurrence.on")} />}>
                <Stack spacing={1.5}>
                  <RepeatToggle name="repeat.on" label={t("editor.repeatOn")}>
                    <RepeatFields prefix="repeat." draftSource />
                  </RepeatToggle>
                  <Panel collapsible level={3} title={t("editor.repeatHelpSummary")}>
                    <Typography variant="body2" color="text.secondary">
                      {t("editor.repeatHelp", { horizon })}
                    </Typography>
                  </Panel>
                </Stack>
              </Panel>
            </>
          }
          main={
            <Stack spacing={2}>
              <EditorGroup label={t("editor.groups.event")} />
              {/* 1 — the type, and the editor's same three cards inside it (§358); the status one
                  read-only, "Programat". */}
              <KindBox {...box} locale={locale}>
                <StatusBox {...box} />
                <CourseBox {...box} languages={languages} />
                <LinksBox {...box} locale={locale} />
              </KindBox>
              <TitleSummaryBox languages={languages} creating />
              <DescriptionBox languages={languages} />

              <EditorGroup label={t("editor.groups.day")} />
              <WhenBox {...box} />
              <PlaceBox {...box} languages={languages} />
              <ProgrammeBox {...box} languages={languages} />
              <RulesBox languages={languages} />
              <RegistrationBox {...box} declarations={declarations} locale={locale} clubDeadlines={deadlines} languages={languages} />

              <EditorGroup label={t("editor.groups.details")} />
              <CoHostsBox {...box} locale={locale} />
              <PromotionBox {...box} />
              <AddressBox languages={languages} slugLocked={false} creating />

              {/* 15 — always open: what the press makes, and the two buttons. */}
              <Panel static id="box-save" title={t("editor.boxes.save.title")}>
                <CreateDraftLine repeatName="repeat.on" draft={t("editor.boxes.save.createDraft")} withSeries={t("editor.boxes.save.createWithSeries", { horizon })} />
                <Box
                  sx={{
                    position: "sticky",
                    bottom: 44,
                    zIndex: 2,
                    bgcolor: "background.paper",
                    pt: 1.5,
                    mt: 1,
                  }}
                >
                  <Stack direction={{ xs: "column", sm: "row" }} spacing={2} sx={{ alignItems: { sm: "flex-start" } }}>
                    <GlyphSubmitButton label={t("editor.create")} pendingLabel={t("editor.saving")} icon="add" incompleteHintNamed={t.raw("forms.incompleteFirst") as string} size="medium" />
                    {mayPublish && (
                      <CreateAndPublishButton
                        label={t("editor.createAndPublish")}
                        pendingLabel={t("editor.publishing")}
                        notReadyHint={t.raw("editor.notReadyToPublish") as string}
                        locales={localeCodes}
                        labels={gapLabels}
                      />
                    )}
                  </Stack>
                </Box>
              </Panel>
            </Stack>
          }
        />
      </ActionForm>
    </Stack>
  );
}
