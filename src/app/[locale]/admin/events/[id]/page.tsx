import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import Divider from "@mui/material/Divider";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import CheckboxField from "@/shared/ui/CheckboxField";
import { hasLocale } from "next-intl";
import { getFormatter, getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { getDb } from "@/db/client";
import { getPathname, Link } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";
import { findEventForEditing, listSeriesDates } from "@/modules/content/events/repository";
import { editionDifference, usualOf } from "@/modules/events/domain/series";
import { SeriesScopeBox, SeriesScopeChips, SeriesScopeProvider } from "@/modules/content/events/ui/SeriesScope";
import { editionNote } from "@/modules/events/ui/series-sentence";
import {
  describeIncompleteLocales,
  missingPublicEventFields,
} from "@/modules/content/events/service";
import EditorPanel from "@/modules/content/events/ui/EditorPanel";
import EventFieldsForm from "@/modules/content/events/ui/EventFieldsForm";
import LocaleTabPanels from "@/shared/ui/LocaleTabPanels";
import RepeatToggle from "@/modules/content/events/ui/RepeatToggle";
import TranslationFieldsForm from "@/modules/content/events/ui/TranslationFieldsForm";
import { listApprovedVersions } from "@/modules/legal-documents/repository";
import { areTestRegistrationsAvailable } from "@/modules/registrations/test-registrations";
import {
  allowedTransitions,
  canDeleteEvent,
  canEditEventFields,
  canEditTranslation,
  canManageRegistrations,
  canReadRegistrations,
  canManageTestRegistrations,
  isLiveContent,
} from "@/modules/staff-identity/domain/roles";
import {
  EDITORIAL_STATUS_LABEL,
  EDITORIAL_TRANSITION_LABEL,
} from "@/modules/staff-identity/domain/staff-labels";
import { requireStaff } from "@/modules/staff-identity/session";
import ConfirmSubmitButton from "@/shared/ui/ConfirmSubmitButton";
import SubmitIconButton from "@/shared/ui/SubmitIconButton";
import type { ActionIconName } from "@/shared/ui/action-icons";
import { DISCLOSURE_SX } from "@/shared/ui/disclosure";
import RepeatFields from "@/modules/content/events/ui/RepeatFields";
import { listBibs } from "@/modules/registrations/bibs";
import { countInterests } from "@/modules/registrations/interest";
import { countEligibleWaitlisted, countRegistrationsForEvent, countTestRegistrationsForEvent } from "@/modules/registrations/repository";
import QueuePanel from "@/modules/registrations/ui/QueuePanel";
import SubmitButton from "@/shared/ui/SubmitButton";
import {
  addTestRegistrationsAction,
  deleteEventAction,
  assignBibNumbersAction,
  sendEventThanksAction,
  duplicateEventAction,
  repeatEventAction,
  removeTestRegistrationsAction,
  saveEventAndTranslationsAction,
  withdrawInterestAction,
  stopRepeatAction,
  transitionEventAction,
} from "../../actions";
import { upcomingRegistrationOpening } from "@/modules/events/domain/registration-window";
import { readRepeatRule } from "@/modules/events/domain/repeat";
import { wallClockWeekday } from "@/modules/events/domain/zoned-time";
import { ruleSentence } from "@/modules/events/ui/series-sentence";
import { findEventTitle } from "@/modules/content/events/repository";

type Props = {
  params: Promise<{ locale: string; id: string }>;
  searchParams: Promise<{ error?: string; saved?: string; assigned?: string; total?: string; created?: string; applied?: string; offered?: string; notConfirmed?: string; test?: string }>;
};

export const dynamic = "force-dynamic";

/**
 * The glyph on each publication verb (§170), by name — an element may not cross the
 * server/client boundary as a prop (`shared/ui/action-icons.ts`). Keyed on the state the
 * transition leads to, which is what the button is named after.
 */
const TRANSITION_ICON: Record<string, ActionIconName> = {
  DRAFT: "draft",
  IN_REVIEW: "review",
  PUBLISHED: "publish",
  ARCHIVED: "archive",
};

/**
 * The one editing screen (BR-REQ-050-01, BR-REQ-051-01), in three parts and one save.
 *
 *   **Publication** — the workflow buttons, unchanged. Publication sits on the event rather than
 *   on either language (`DECISIONS.md` §28), so they are here once and the page says plainly
 *   when a language is not yet complete enough to publish.
 *
 *   **Settings** — every language-neutral column an organizer owns: the kind, the status, the
 *   times and the timezone, the coordinates and the map link, the featured flag, and the whole
 *   registration block.
 *
 *   **Content** — one tabbed panel per language, Romanian first.
 *
 * Those last two are one `<form>` with one button, and the save is one transaction
 * (`saveEventAndTranslations`). What it replaced was a settings form and one form per language:
 * three saves, three version guards, and two of them going stale the moment the first
 * succeeded. Every guard still carries the version its own panel was rendered from, and a stale
 * one anywhere fails the whole save as a CONFLICT rather than writing half of it.
 *
 * Test registrations, Duplicate and Delete stay outside that form on purpose: they are commands
 * rather than edits, and a "delete this event" button inside the form that saves it is how
 * somebody deletes an event they meant to save.
 *
 * No rich text: the canonical body is validated Tiptap JSON by AGENTS.md §11.3 and event bodies
 * are plain fields, so an editor for them would be an M5 content type built early and half.
 *
 * The interface hides what a role may not do, and that is a courtesy rather than the rule —
 * every button here is checked again in the action behind it. An Author sees no publish button
 * and no settings panel; an Author who posts either anyway is refused by the server
 * (BR-REQ-060-01).
 */
export default async function EditEventPage({ params, searchParams }: Props) {
  const { locale, id } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);

  const staffUser = await requireStaff();
  const { error, saved, assigned, total, notConfirmed, test, created, applied, offered } = await searchParams;

  const db = getDb();
  const record = await findEventForEditing(db, id);
  if (!record) notFound();
  const { event, translations } = record;
  // How many numbers this event has, for the sentence beside the button; the sheet reads the
  // same list. Only where the section that shows it renders.
  const bibs =
    canReadRegistrations(staffUser.role) && event.registrationMode === "INTERNAL"
      ? await listBibs(db, event.id)
      : [];

  const declarations = await listApprovedVersions(db, "EVENT_DECLARATION", locale);
  const t = await getTranslations("Admin");
  const format = await getFormatter();
  const now = new Date();
  // The language endonyms are shared with the public switcher: "Română" is what a Romanian
  // speaker looks for in either interface, and two catalogues of the same two words would drift.
  const tSite = await getTranslations("Site");

  const transitions = allowedTransitions(
    staffUser.role,
    event.editorialStatus,
    translations.some((translation) => translation.authorStaffUserId === staffUser.id),
  );
  const live = isLiveContent(event.editorialStatus);
  const slugLocked = event.publishedAt !== null;
  const incomplete = describeIncompleteLocales(translations);
  // The meeting point is the event's now, not each language's, so "not ready to publish" has a
  // second half that is not about either tab (`DECISIONS.md` §36).
  const missingOnEvent = missingPublicEventFields(event);
  const maySaveSettings = canEditEventFields(staffUser.role);

  // Administrator only, and never in production — the second half is the environment, and it is
  // asserted again in the service and once more at the insert.
  // Only where there is a queue to fill: a group run has none (§111; the owner: "test
  // registrations do not make sense for group runs!").
  const mayFillTheQueue =
    canManageTestRegistrations(staffUser.role) && areTestRegistrationsAvailable() && event.registrationMode === "INTERNAL";

  // "Anunță-mă" (§146): while the window is ahead, how many addresses wait for the announcement,
  // and the one verb the notice promises — withdrawal before the message goes. Administrator,
  // like the queue it stands under; the count is the only thing shown, never an address.
  const interestsWaiting =
    canManageRegistrations(staffUser.role) && upcomingRegistrationOpening(event, now) !== null ? await countInterests(db, event.id) : null;

  // The waiting list's length, read once for the queue panel and for the sentence under
  // "Număr de locuri" (§147): raising the number offers these people places at once.
  const waiting =
    event.registrationMode === "INTERNAL" && (maySaveSettings || canReadRegistrations(staffUser.role))
      ? await countEligibleWaitlisted(db, event.id)
      : 0;

  /**
   * Why Delete is, or is not, offered (§170; the owner: "aparent nu pot șterge evenimente").
   *
   * The list has explained this for a while — "eleven people have registered" replaces the
   * button — and the editor did not: it offered the button and let the service's refusal arrive
   * afterwards as `VALIDATION_ERROR`, a code that names nothing. The same count, in the same
   * words, and the test rows counted separately because those have a button of their own.
   */
  const registered = canDeleteEvent(staffUser.role)
    ? {
        total: await countRegistrationsForEvent(db, event.id),
        test: await countTestRegistrationsForEvent(db, event.id),
      }
    : null;

  /**
   * "Not ready to publish", in the words on the screen (§170; the owner: "aparent nu pot
   * publica un eveniment").
   *
   * The alert said `Lipsesc: RO: excerpt · EN: excerpt` — a column name, for a box labelled
   * "Rezumat" that the organizer had never been shown. Every key these two functions return is
   * a field in `editor.fields`, so the label is simply looked up; a language that has no row at
   * all says so instead.
   */
  const fieldLabel = (field: string) =>
    field === "translation" ? t("editor.tabMissing") : t(`editor.fields.${field}`);

  /**
   * Romanian first, then English — `routing.locales` order, which is the order the club works
   * in, rather than whatever order the database returned the rows in.
   */
  const orderedTranslations = routing.locales
    .map((contentLocale) => translations.find((row) => row.locale === contentLocale))
    .filter((row) => row !== undefined);

  const mayEditTranslation = (translation: (typeof translations)[number]) =>
    canEditTranslation(
      staffUser.role,
      { editorialStatus: event.editorialStatus, authorStaffUserId: translation.authorStaffUserId },
      staffUser.id,
    );

  const maySaveAnything =
    maySaveSettings || orderedTranslations.some((translation) => mayEditTranslation(translation));

  // A standing series (§122): the rule on the source, or the source of this date.
  const repeatRule = readRepeatRule(event.repeatRule);
  const ruleWords = repeatRule ? await ruleSentence(repeatRule, event, event.timezone, locale) : null;
  const ruleEnded = repeatRule?.until ? new Date(`${repeatRule.until}T23:59:59`).getTime() < now.getTime() : false;
  const seriesTitle = event.repeatOf ? await findEventTitle(db, event.repeatOf, locale) : null;
  const inSeries = event.repeatOf !== null || repeatRule !== null;

  // Which date is open, and the others one press away (§131; the owner: "it must be clear
  // which edition I am editing; the recurring ones must be easier to edit"). Every date of the
  // series as a chip, this one filled, the ones unlike the others marked as on the card (§122).
  const seriesDates = inSeries ? await listSeriesDates(db, event.repeatOf ?? event.id) : [];
  const usual = usualOf(seriesDates);
  const dateChips = await Promise.all(
    seriesDates.map(async (member) => ({
      id: member.id,
      href: getPathname({ locale, href: { pathname: "/admin/events/[id]", params: { id: member.id } } }),
      label: format.dateTime(member.startsAt, { timeZone: member.timezone, weekday: "short", day: "numeric", month: "short" }),
      note: await editionNote(editionDifference(member, usual)),
    })),
  );
  const position = seriesDates.findIndex((member) => member.id === event.id);
  const previousDate = position > 0 ? seriesDates[position - 1] : null;
  const nextDate = position >= 0 && position < seriesDates.length - 1 ? seriesDates[position + 1] : null;
  const dateWords = (member: { startsAt: Date; timezone: string }) =>
    format.dateTime(member.startsAt, { timeZone: member.timezone, weekday: "long", day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false });

  return (
    <SeriesScopeProvider dates={dateChips} currentId={event.id}>
    <Stack spacing={4}>
      <Box>
        <Typography variant="body2">
          <Link href="/admin">{t("backToEvents")}</Link>
        </Typography>
      </Box>

      <Box id="admin-alert" tabIndex={-1} sx={{ scrollMarginTop: 16 }}>
        {error && <Alert severity="error">{t(`errors.${error}`)}</Alert>}
        {saved === "bibsAssigned" && (
          /*
            Nothing assigned is an answer too (§286). A number follows the declaration and never
            precedes it, and a test row never wears one — so an event whose entrants are all still
            confirming their email reported "0 numere alocate" and read as a broken button.
          */
          <Alert severity={assigned === "0" ? "info" : "success"}>
            {assigned === "0"
              ? t("bibs.assignedNone", { notConfirmed: notConfirmed ?? "0", test: test ?? "0" })
              : t("bibs.assigned", { assigned: assigned ?? "0", total: total ?? "0" })}
          </Alert>
        )}
        {saved === "created" && created && (
          <Alert severity="success">{t("editor.createdWithSeries", { created })}</Alert>
        )}
        {saved === "eventsRepeated" && (
          <Alert severity="success">{t("events.eventsRepeated", { created: created ?? "0" })}</Alert>
        )}
        {saved === "repeatStopped" && <Alert severity="success">{t("editor.repeatStopped")}</Alert>}
        {saved === "interestRemoved" && <Alert severity="success">{t("queue.interestRemoved")}</Alert>}
        {saved === "interestNotFound" && <Alert severity="info">{t("queue.interestNotFound")}</Alert>}
        {saved === "eventSeries" && (
          <Alert severity="success">
            {offered ? t("editor.savedSeriesOffered", { applied: applied ?? "0", offered }) : t("editor.savedSeries", { applied: applied ?? "0" })}
          </Alert>
        )}
        {saved === "event" && offered && <Alert severity="success">{t("editor.savedOffered", { offered })}</Alert>}
        {saved && !["bibsAssigned", "eventsRepeated", "repeatStopped", "eventSeries", "interestRemoved", "interestNotFound"].includes(saved) && !(saved === "created" && created) && !(saved === "event" && offered) && (
          <Alert severity="success">{t("saved")}</Alert>
        )}
      </Box>

      {/*
        Two columns from `md` up (§170; the owner: "Publicare + repeat + the series chips in a
        'Publicare' panel — top on a phone, right-hand column from md up"): the words and the
        settings on the left, everything about whether this event is live on the right. On a
        phone the order is reversed — publication first, because on a phone it is the thing you
        came to check, and a column of forty fields above it is a scroll nobody makes.

        The two are **siblings**, never nested: the save is one `<form>` and every publication
        verb is a form of its own, and a form inside a form is not a thing HTML has.
      */}
      <Box
        sx={{
          display: "grid",
          gap: { xs: 3, md: 4 },
          gridTemplateColumns: { xs: "1fr", md: "minmax(0, 1fr) minmax(260px, 340px)" },
          alignItems: "start",
        }}
      >
      <Box sx={{ order: { xs: 2, md: 1 }, minWidth: 0 }}>
      {/* Settings and content: one form, one save. */}
      <form action={saveEventAndTranslationsAction}>
        <input type="hidden" name="uiLocale" value={locale} />
        <input type="hidden" name="eventId" value={event.id} />
        {/*
          The event row's version, and its presence is also the signal that this save touches the
          event row at all: an Author sees no settings panel, so this field is absent and the
          service writes no event row rather than assuming a version it was never given.
        */}
        {maySaveSettings && (
          <input type="hidden" name="event.expectedVersion" value={event.version} />
        )}

        <Stack spacing={3}>
          {/* The words first (§170): this is what somebody opened the editor to write. */}
          <EditorPanel
            title={t("editor.contentSection")}
            help={t("editor.contentHelp")}
            headingId="panel-content"
          >
            <LocaleTabPanels
              panels={orderedTranslations.map((translation) => ({
                locale: translation.locale,
                label: tSite(`languageName.${translation.locale}`),
                incompleteLabel: incomplete.some((entry) => entry.locale === translation.locale)
                  ? t("editor.tabIncomplete")
                  : undefined,
                content: (
                  <TranslationFieldsForm
                    translation={translation}
                    eventId={event.id}
                    eventType={event.type}
                    slugLocked={slugLocked}
                    mayEdit={mayEditTranslation(translation)}
                  />
                ),
              }))}
            />
          </EditorPanel>

          {maySaveSettings ? (
            <EventFieldsForm event={event} declarations={declarations} waiting={waiting} />
          ) : (
            <Alert severity="info">{t("editor.eventFieldsReadOnly")}</Alert>
          )}

          {maySaveAnything && (
            <Box component="section">
              {/*
                What this save covers, for the role whose save covers half the form (§289's
                sibling; the owner: "e un pic confusing faptul ca pot edita dar nu mi se salveaza
                modificarile ca si Organizator").

                One form and one button carry the event row and both languages (§36). An
                Organizer may write the first and not the second, so the green "Modificările au
                fost salvate" is true and reads as a lie: they had just been told, on the
                Conținut tab, that they could not edit the text. Said here, beside the button,
                before the press — the tab's own alert now names the rule instead of guessing at
                publication or authorship, which was never the reason.
              */}
              {maySaveSettings && !orderedTranslations.some((translation) => mayEditTranslation(translation)) && (
                <Alert severity="info" sx={{ mb: 2 }}>
                  {t("editor.saveCoversSettingsOnly")}
                </Alert>
              )}
              {/* BR-REQ-051-01 criterion 4, once for the whole save now that there is one save.
                  Binding three times over: `required`, so the browser refuses the submit and
                  names the box; the dimmed button with its sentence, so the organizer sees why
                  before pressing; and the service, which refuses a save of a published event
                  without it whatever the browser did ("I shouldn't be able to save without
                  ticking it" — the owner, 2026-09-17). In the flow, not in the sticky bar
                  (§152): on a phone the bar had grown to a third of the screen. */}
              {live && (
                <Box sx={{ mb: 2 }}>
                  <CheckboxField name="acknowledgeLiveEdit" required>
                    {t("editor.acknowledgeLive")}
                  </CheckboxField>
                </Box>
              )}
              {/* A date of a series (§130, §134): the dates ticked in the header, said in words,
                  with the three presets — this date, this and the following, all — as one
                  exclusive control. Only what changed travels; the service says how. */}
              {inSeries && maySaveSettings && (
                <Box sx={{ mb: 2 }}>
                  <SeriesScopeBox />
                </Box>
              )}
              {/*
                Only the button is sticky at the bottom of the window while the long form
                scrolls (the owner: "this save button should be sticky at the bottom", then
                "the bottom save footer takes too much space on mobile"), above the footer's
                own 44px bar; it settles into place once the end of the form is in view.
              */}
              <Box
                sx={{
                  position: "sticky",
                  bottom: 44,
                  zIndex: 2,
                  bgcolor: "background.default",
                  py: 1,
                  borderTop: 1,
                  borderColor: "divider",
                }}
              >
                <SubmitButton
                  label={t("editor.save")}
                  pendingLabel={t("editor.saving")}
                  incompleteHint={live ? t("editor.acknowledgeLiveHint") : undefined}
                  size="medium"
                />
              </Box>
            </Box>
          )}
        </Stack>
      </form>
      </Box>

      <Stack spacing={3} sx={{ order: { xs: 1, md: 2 }, minWidth: 0, position: { md: "sticky" }, top: { md: 16 } }}>
      {/* Publication, for the whole event. Its own forms: a transition is not an edit, and it
          carries only the event's version. */}
      <EditorPanel title={t("editor.publicationSection")} headingId="panel-publication">
        <Stack direction="row" spacing={1} sx={{ mb: 2, flexWrap: "wrap", gap: 1 }}>
          <Chip size="small" label={EDITORIAL_STATUS_LABEL[event.editorialStatus]} />
          <Chip size="small" variant="outlined" label={t("editor.version", { version: event.version })} />
        </Stack>

        {live && <Alert severity="warning" sx={{ mb: 2 }}>{t("editor.liveWarning")}</Alert>}

        {(incomplete.length > 0 || missingOnEvent.length > 0) && (
          <Alert severity="info" sx={{ mb: 2 }}>
            {t("editor.incompleteForPublication", {
              detail: [
                ...missingOnEvent.map((field) => `${t("editor.panels.when")}: ${fieldLabel(field)}`),
                ...incomplete.map(
                  (entry) =>
                    `${tSite(`languageName.${entry.locale as "ro" | "en"}`)}: ${entry.missing.map(fieldLabel).join(", ")}`,
                ),
              ].join(" · "),
            })}
          </Alert>
        )}

        {transitions.length > 0 ? (
          <Stack direction="row" spacing={1} sx={{ flexWrap: "wrap", gap: 1 }}>
            {transitions.map((to) => (
              <form action={transitionEventAction} key={to}>
                <input type="hidden" name="uiLocale" value={locale} />
                <input type="hidden" name="eventId" value={event.id} />
                <input type="hidden" name="expectedVersion" value={event.version} />
                <input type="hidden" name="to" value={to} />
                {/* Archiving takes the event off the public site in both languages; the other
                    transitions are a click away from being undone. Each wears its verb's glyph
                    (§170), by name — a Server Component may not hand an element across. */}
                {to === "ARCHIVED" ? (
                  <ConfirmSubmitButton
                    label={EDITORIAL_TRANSITION_LABEL[to]}
                    icon={TRANSITION_ICON[to]}
                    title={t("confirm.archiveTitle")}
                    body={t("confirm.archiveBody")}
                    confirmLabel={EDITORIAL_TRANSITION_LABEL[to]}
                    cancelLabel={t("confirm.cancel")}
                  />
                ) : (
                  <SubmitIconButton label={EDITORIAL_TRANSITION_LABEL[to]} icon={TRANSITION_ICON[to]} />
                )}
              </form>
            ))}
          </Stack>
        ) : (
          <Alert severity="info">{t("editor.noTransitions")}</Alert>
        )}
      </EditorPanel>

      {/*
        Repeat, right under publication (the owner: "repeating the event should be more on the
        top"): the weekly run is made once, and the person making it should not scroll past the
        registrations, the queue and the test data to find the button. Three states (§122): one
        date of a series (a note and the way back), a source with a rule (how it repeats, and
        stop), or the form that makes a series.
      */}
      {inSeries && (
        <Box component="section" sx={{ p: 2, border: 2, borderColor: "primary.main", borderRadius: 2 }}>
          <Typography variant="overline" component="p" sx={{ lineHeight: 1.6 }}>
            {t("editor.series.kicker", { title: seriesTitle ?? orderedTranslations[0]?.title ?? "…" })}
          </Typography>
          <Typography variant="h2" sx={{ fontSize: "1.25rem", mb: 0.5 }}>
            {t("editor.series.editing", { date: dateWords(event) })}
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
            {t("editor.series.position", { position: String(position + 1), count: String(seriesDates.length) })}
            {event.repeatOf ? ` ${t("editor.repeatOfNote")}` : ""}
          </Typography>
          <SeriesScopeChips />
          <Stack direction="row" spacing={2} sx={{ mt: 1.5, flexWrap: "wrap", gap: 1 }}>
            {previousDate && (
              <Link href={{ pathname: "/admin/events/[id]", params: { id: previousDate.id } }}>
                {t("editor.series.previous", { date: dateWords(previousDate) })}
              </Link>
            )}
            {nextDate && (
              <Link href={{ pathname: "/admin/events/[id]", params: { id: nextDate.id } }}>
                {t("editor.series.next", { date: dateWords(nextDate) })}
              </Link>
            )}
            {event.repeatOf && (
              <Link href={{ pathname: "/admin/events/[id]", params: { id: event.repeatOf } }}>{t("editor.repeatOfLink")}</Link>
            )}
          </Stack>
        </Box>
      )}
      {event.repeatOf ? null : repeatRule && ruleWords ? (
        <Box component="section">
          <Typography variant="h2" sx={{ fontSize: "1.25rem", mb: 1 }}>
            {t("editor.repeatRuleTitle")}
          </Typography>
          <Typography variant="body1" sx={{ mb: 1.5 }}>
            {repeatRule.until
              ? t(ruleEnded ? "editor.repeatRuleEnded" : "editor.repeatRuleUntil", {
                  sentence: ruleWords,
                  until: format.dateTime(new Date(`${repeatRule.until}T12:00:00Z`), { timeZone: "UTC", day: "numeric", month: "long", year: "numeric" }),
                })
              : t("editor.repeatRuleForever", { sentence: ruleWords })}
          </Typography>
          {maySaveSettings && (
            <form action={stopRepeatAction}>
              <input type="hidden" name="uiLocale" value={locale} />
              <input type="hidden" name="eventId" value={event.id} />
              <Stack direction="row" spacing={2} sx={{ alignItems: "center", flexWrap: "wrap", gap: 1 }}>
                <ConfirmSubmitButton
                  label={t("editor.repeatStop")}
                  title={t("editor.repeatStop")}
                  body={t("editor.repeatStopHelp")}
                  confirmLabel={t("editor.repeatStop")}
                  cancelLabel={t("confirm.cancel")}
                  color="warning"
                />
                <Typography variant="body2" color="text.secondary">
                  {t("editor.repeatStopHelp")}
                </Typography>
              </Stack>
            </form>
          )}
        </Box>
      ) : (
      <EditorPanel title={t("editor.repeatSection")} headingId="panel-repeat">
        <form action={repeatEventAction}>
          <input type="hidden" name="uiLocale" value={locale} />
          <input type="hidden" name="eventId" value={event.id} />
          {/* The tick first, the frequency after it (§170; the owner: "repetă evenimentul
              trebuie să fie o bifă și abia apoi pot să setez frecvența"). What the series
              actually does is folded under it: six lines of explanation open on every event
              was six lines of explanation about something most events are not. */}
          <RepeatToggle name="repeatOn" label={t("editor.repeatOn")}>
            <Box component="details" sx={{ ...DISCLOSURE_SX, mb: 1 }}>
              <Typography component="summary" variant="body2">
                {t("editor.repeatHelpSummary")}
              </Typography>
              <Typography variant="body2" color="text.secondary" sx={{ pb: 1 }}>
                {t("editor.repeatHelp")}
              </Typography>
            </Box>
            <RepeatFields ownWeekday={wallClockWeekday(event.startsAt, event.timezone)} />
            {live && (
              <Box sx={{ mt: 1 }}>
                <CheckboxField name="publish">{t("editor.repeatPublish")}</CheckboxField>
              </Box>
            )}
            <Box sx={{ mt: 2 }}>
              <ConfirmSubmitButton
                label={t("editor.repeat")}
                icon="repeat"
                title={t("confirm.repeatTitle")}
                body={t("confirm.repeatBody")}
                confirmLabel={t("editor.repeat")}
                cancelLabel={t("confirm.cancel")}
              />
            </Box>
          </RepeatToggle>
        </form>
      </EditorPanel>
      )}
      </Stack>
      </Box>

      {/* The other way in to BR-REQ-037-05, from the event somebody is actually looking at.
          Only for an event with a queue to put anybody in, and for whoever may read that queue
          — the Organizer since §289. Everything in this block is a read except "Alocă
          numerele", which asks for itself below. */}
      {canReadRegistrations(staffUser.role) && event.registrationMode === "INTERNAL" && (
        <Box component="section">
          <Divider sx={{ mb: 3 }} />
          <Typography variant="h2" sx={{ fontSize: "1.25rem", mb: 2 }}>
            {t("nav.registrations")}
          </Typography>
          <Stack direction="row" spacing={2} sx={{ flexWrap: "wrap", gap: 1 }}>
            <Button
              component="a"
              href={`${getPathname({ locale, href: "/admin/registrations/new" })}?eventId=${event.id}`}
              variant="outlined"
              size="small"
              sx={{ minHeight: 44 }}
            >
              {t("registrations.new")}
            </Button>
            <Button
              component="a"
              href={`${getPathname({ locale, href: "/admin/registrations" })}?eventId=${event.id}`}
              variant="text"
              size="small"
              sx={{ minHeight: 44 }}
            >
              {t("registrations.viewForEvent")}
            </Button>
            {/* The declarations (§95): every signed one as the club's archive; the blank one to print. */}
            <Button component="a" href={`/api/admin/events/${event.id}/declarations?locale=${locale}`} variant="text" size="small" sx={{ minHeight: 44 }}>
              {t("registrations.declarationsPdf")}
            </Button>
            <Button component="a" href={`/api/admin/events/${event.id}/declaration-form?locale=${locale}`} variant="text" size="small" sx={{ minHeight: 44 }}>
              {t("registrations.declarationForm")}
            </Button>
            {/* The desk for this event (BR-REQ-037-08): where race morning happens. */}
            <Button
              component="a"
              href={`${getPathname({ locale, href: "/admin/checkin" })}?eventId=${event.id}`}
              variant="text"
              size="small"
              sx={{ minHeight: 44 }}
            >
              {t("desk.title")}
            </Button>
          </Stack>

          {/*
            Race numbers (BR-REQ-038-01): assign to every confirmed registration without one,
            then download the sheet — all numbers, or a range for a reprint or the late batch.
            Assigning is a POST with a confirmation; the sheet is a GET that reads what it
            assigned and writes nothing.
          */}
          <Typography variant="h3" sx={{ fontSize: "1rem", mt: 3, mb: 0.5 }}>
            {t("bibs.title")}
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
            {/* Why there is nothing here (§170; the owner: "partea cu numerele de concurs nu
                prea funcționează"). A queue made entirely of test rows gets no numbers and
                never will — `AGENTS.md` §12.6 — and the screen said only "no numbers yet",
                which reads as a broken button rather than a rule. */}
            {bibs.length === 0
              ? registered && registered.total > 0 && registered.test === registered.total
                ? t("editor.bibsOnlyTest")
                : t("bibs.helpNone")
              : t("bibs.helpSome", { total: bibs.length })}
          </Typography>
          <Stack direction={{ xs: "column", sm: "row" }} spacing={2} sx={{ alignItems: { sm: "center" } }}>
            {/* Giving the field its numbers is a write, and `assignBibNumbers` refuses anybody
                below ADMIN (§289). Downloading the sheet beside it is a read and is not gated. */}
            {canManageRegistrations(staffUser.role) && (
              <form action={assignBibNumbersAction}>
                <input type="hidden" name="uiLocale" value={locale} />
                <input type="hidden" name="eventId" value={event.id} />
                <ConfirmSubmitButton
                  label={t("bibs.assign")}
                  title={t("confirm.bibsTitle")}
                  body={t("confirm.bibsBody")}
                  confirmLabel={t("bibs.assign")}
                  cancelLabel={t("confirm.cancel")}
                />
              </form>
            )}
            {bibs.length > 0 && (
              <form action={`/api/admin/events/${event.id}/bibs`} method="get">
                <input type="hidden" name="locale" value={locale} />
                <Stack direction="row" spacing={1} sx={{ alignItems: "center", flexWrap: "wrap", gap: 1 }}>
                  <TextField
                    name="from"
                    type="number"
                    label={t("bibs.from")}
                    size="small"
                    slotProps={{ htmlInput: { min: 1 } }}
                    sx={{ width: 100 }}
                  />
                  <TextField
                    name="to"
                    type="number"
                    label={t("bibs.to")}
                    size="small"
                    slotProps={{ htmlInput: { min: 1 } }}
                    sx={{ width: 100 }}
                  />
                  {/* Two submit buttons, one form: the second names the layout it asks for. */}
                  <Button type="submit" variant="outlined" size="small" sx={{ minHeight: 44 }}>
                    {t("bibs.download")}
                  </Button>
                  <Button type="submit" name="layout" value="one" variant="text" size="small" sx={{ minHeight: 44 }}>
                    {t("bibs.downloadOnePerPage")}
                  </Button>
                </Stack>
              </form>
            )}
          </Stack>

          {/* Every bib as it will print, on its own page (§94): drawn on request, not on every visit here. */}
          {bibs.length > 0 && (
            <Typography variant="body2" sx={{ mt: 2 }}>
              <Link href={{ pathname: "/admin/events/[id]/bibs", params: { id: event.id } }}>
                {t("bibs.preview", { count: bibs.length })}
              </Link>
            </Typography>
          )}
        </Box>
      )}

      {/*
        After the race (§82): the thank-you to everyone who was checked in, once, by hand, with
        an optional link to the results or the photos. Offered once the event has started;
        gone once it was sent — the date says when.
      */}
      {canManageRegistrations(staffUser.role) &&
        event.registrationMode === "INTERNAL" &&
        event.startsAt.getTime() <= now.getTime() && (
          <Box component="section">
            <Divider sx={{ mb: 3 }} />
            <Typography variant="h2" sx={{ fontSize: "1.25rem", mb: 1 }}>
              {t("thanks.title")}
            </Typography>
            {event.thanksSentAt ? (
              <Typography variant="body2" color="text.secondary">
                {t("thanks.sentOn", { date: format.dateTime(event.thanksSentAt, { dateStyle: "long", timeStyle: "short", hourCycle: "h23" }) })}
              </Typography>
            ) : (
              <form action={sendEventThanksAction}>
                <input type="hidden" name="uiLocale" value={locale} />
                <input type="hidden" name="eventId" value={event.id} />
                <Stack spacing={1.5} sx={{ maxWidth: 560 }}>
                  <Typography variant="body2" color="text.secondary">
                    {t("thanks.help")}
                  </Typography>
                  <TextField
                    name="url"
                    type="url"
                    label={t("thanks.url")}
                    helperText={t("thanks.urlHelp")}
                    size="small"
                    slotProps={{ htmlInput: { pattern: "https://.*", maxLength: 2048 } }}
                  />
                  <Box>
                    <ConfirmSubmitButton
                      label={t("thanks.send")}
                      title={t("thanks.confirmTitle")}
                      body={t("thanks.confirmBody")}
                      confirmLabel={t("thanks.send")}
                      cancelLabel={t("confirm.cancel")}
                      variant="contained"
                    />
                  </Box>
                </Stack>
              </form>
            )}
          </Box>
        )}

      {/* The queue as the allocator sees it, and the waiting list in its order (§92) — a read,
          so the Organizer has it too (§289). The one verb inside is "Anunță-mă", whose own
          count is Administrator-gated above and which therefore never renders below that. */}
      {canReadRegistrations(staffUser.role) && event.registrationMode === "INTERNAL" && (
        <Box component="section">
          <Divider sx={{ mb: 3 }} />
          <Typography variant="h2" sx={{ fontSize: "1.25rem", mb: 2 }}>
            {t("queue.title")}
          </Typography>
          <QueuePanel db={db} event={{ id: event.id, capacity: event.capacity }} waiting={waiting} now={now} />

          {interestsWaiting !== null && (
            <Box sx={{ mt: 3 }}>
              <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
                {t("queue.interestTitle", { count: interestsWaiting })}
              </Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
                {t("queue.interestHelp")}
              </Typography>
              <form action={withdrawInterestAction}>
                <input type="hidden" name="uiLocale" value={locale} />
                <input type="hidden" name="eventId" value={event.id} />
                <Stack direction="row" spacing={1} sx={{ alignItems: "center", flexWrap: "wrap", rowGap: 1 }}>
                  <TextField name="email" type="email" label={t("queue.interestEmail")} required size="small" sx={{ minWidth: 260 }} />
                  <Button type="submit" variant="outlined" size="small" sx={{ minHeight: 44 }}>
                    {t("queue.interestRemove")}
                  </Button>
                </Stack>
              </form>
            </Box>
          )}
        </Box>
      )}

      {mayFillTheQueue && (
        <Box component="section">
          <Divider sx={{ mb: 3 }} />
          <Typography variant="h2" sx={{ fontSize: "1.25rem", mb: 1 }}>
            {t("testRegistrations.title")}
          </Typography>
          <Alert severity="info" sx={{ mb: 2 }}>
            {t("testRegistrations.explanation")}
          </Alert>

          <Stack direction={{ xs: "column", sm: "row" }} spacing={2} sx={{ alignItems: "flex-start" }}>
            <form action={addTestRegistrationsAction}>
              <input type="hidden" name="uiLocale" value={locale} />
              <input type="hidden" name="eventId" value={event.id} />
              <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
                <TextField
                  name="count"
                  label={t("testRegistrations.count")}
                  defaultValue="3"
                  inputMode="numeric"
                  size="small"
                  sx={{ width: 120 }}
                />
                <Button type="submit" variant="outlined" size="small" sx={{ minHeight: 44 }}>
                  {t("testRegistrations.add")}
                </Button>
              </Stack>
            </form>

            <form action={removeTestRegistrationsAction}>
              <input type="hidden" name="uiLocale" value={locale} />
              <input type="hidden" name="eventId" value={event.id} />
              <ConfirmSubmitButton
                label={t("testRegistrations.remove")}
                title={t("confirm.removeTestTitle")}
                body={t("confirm.removeTestBody")}
                confirmLabel={t("testRegistrations.remove")}
                cancelLabel={t("confirm.cancel")}
                color="warning"
              />
            </form>
          </Stack>
        </Box>
      )}

      {/* Commands, not edits: their own forms, outside the save above. */}
      <Box component="section">
        <Divider sx={{ mb: 3 }} />
        <Typography variant="h2" sx={{ fontSize: "1.25rem", mb: 2 }}>
          {t("editor.copySection")}
        </Typography>

        <Stack direction="row" spacing={2} sx={{ flexWrap: "wrap", gap: 1 }}>
          <form action={duplicateEventAction}>
            <input type="hidden" name="uiLocale" value={locale} />
            <input type="hidden" name="eventId" value={event.id} />
            <ConfirmSubmitButton
              label={t("editor.duplicate")}
              icon="duplicate"
              title={t("confirm.duplicateTitle")}
              body={t("confirm.duplicateBody")}
              confirmLabel={t("editor.duplicate")}
              cancelLabel={t("confirm.cancel")}
            />
          </form>

          {/*
            Deletion is the Administrator's alone, and the service refuses any event that has a
            registration against it — archive is the answer for an event that happened.

            The count replaces the button rather than the refusal arriving afterwards as an
            error code (§170): the list has explained it this way since §114, and this screen
            offered the button and let `VALIDATION_ERROR` explain nothing. When every row in the
            way is test data, the sentence says so and the button that clears them is one
            section above.
          */}
          {canDeleteEvent(staffUser.role) &&
            (registered && registered.total > 0 ? (
              <Alert severity="info" sx={{ flex: "1 1 320px" }}>
                {registered.test === registered.total
                  ? t("editor.deleteBlockedByTest", { count: registered.total })
                  : t("events.deleteBlocked", { count: registered.total })}
              </Alert>
            ) : (
              <form action={deleteEventAction}>
                <input type="hidden" name="uiLocale" value={locale} />
                <input type="hidden" name="eventId" value={event.id} />
                <ConfirmSubmitButton
                  label={t("editor.delete")}
                  icon="delete"
                  title={t("confirm.deleteTitle")}
                  body={t("confirm.deleteBody")}
                  confirmLabel={t("editor.delete")}
                  cancelLabel={t("confirm.cancel")}
                  color="error"
                />
              </form>
            ))}
        </Stack>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
          {t("editor.deleteHelp")}
        </Typography>

      </Box>
    </Stack>
    </SeriesScopeProvider>
  );
}
