import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Checkbox from "@mui/material/Checkbox";
import Chip from "@mui/material/Chip";
import Divider from "@mui/material/Divider";
import FormControlLabel from "@mui/material/FormControlLabel";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { getDb } from "@/db/client";
import { getPathname, Link } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";
import { findEventForEditing } from "@/modules/content/events/repository";
import {
  describeIncompleteLocales,
  missingPublicEventFields,
} from "@/modules/content/events/service";
import EventFieldsForm from "@/modules/content/events/ui/EventFieldsForm";
import LocaleTabPanels from "@/modules/content/events/ui/LocaleTabPanels";
import TranslationFieldsForm from "@/modules/content/events/ui/TranslationFieldsForm";
import { listApprovedVersions } from "@/modules/legal-documents/repository";
import { areTestRegistrationsAvailable } from "@/modules/registrations/test-registrations";
import {
  allowedTransitions,
  canDeleteEvent,
  canEditEventFields,
  canEditTranslation,
  canManageTestRegistrations,
  isLiveContent,
} from "@/modules/staff-identity/domain/roles";
import {
  EDITORIAL_STATUS_LABEL,
  EDITORIAL_TRANSITION_LABEL,
} from "@/modules/staff-identity/domain/staff-labels";
import { requireStaff } from "@/modules/staff-identity/session";
import ConfirmSubmitButton from "@/shared/ui/ConfirmSubmitButton";
import {
  addTestRegistrationsAction,
  deleteEventAction,
  duplicateEventAction,
  removeTestRegistrationsAction,
  saveEventAndTranslationsAction,
  transitionEventAction,
} from "../../actions";

type Props = {
  params: Promise<{ locale: string; id: string }>;
  searchParams: Promise<{ error?: string; saved?: string }>;
};

export const dynamic = "force-dynamic";

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
  const { error, saved } = await searchParams;

  const db = getDb();
  const record = await findEventForEditing(db, id);
  if (!record) notFound();
  const { event, translations } = record;

  const declarations = await listApprovedVersions(db, "EVENT_DECLARATION", locale);
  const t = await getTranslations("Admin");
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
  const mayFillTheQueue =
    canManageTestRegistrations(staffUser.role) && areTestRegistrationsAvailable();

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

  return (
    <Stack spacing={4}>
      <Box>
        <Typography variant="body2">
          <Link href="/admin">{t("backToEvents")}</Link>
        </Typography>
      </Box>

      <Box id="admin-alert" tabIndex={-1} sx={{ scrollMarginTop: 16 }}>
        {error && <Alert severity="error">{t(`errors.${error}`)}</Alert>}
        {saved && <Alert severity="success">{t("saved")}</Alert>}
      </Box>

      {/* Publication, for the whole event. Its own forms: a transition is not an edit, and it
          carries only the event's version. */}
      <Box component="section">
        <Stack direction="row" spacing={1} sx={{ mb: 2, flexWrap: "wrap", gap: 1 }}>
          <Typography variant="h2" sx={{ fontSize: "1.25rem" }}>
            {t("editor.publicationSection")}
          </Typography>
          <Chip size="small" label={EDITORIAL_STATUS_LABEL[event.editorialStatus]} />
          <Chip size="small" variant="outlined" label={t("editor.version", { version: event.version })} />
        </Stack>

        {live && <Alert severity="warning" sx={{ mb: 2 }}>{t("editor.liveWarning")}</Alert>}

        {(incomplete.length > 0 || missingOnEvent.length > 0) && (
          <Alert severity="info" sx={{ mb: 2 }}>
            {t("editor.incompleteForPublication", {
              detail: [
                ...missingOnEvent.map((field) => `${t("editor.settingsSection")}: ${field}`),
                ...incomplete.map(
                  (entry) => `${entry.locale.toUpperCase()}: ${entry.missing.join(", ")}`,
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
                    transitions are a click away from being undone. */}
                {to === "ARCHIVED" ? (
                  <ConfirmSubmitButton
                    label={EDITORIAL_TRANSITION_LABEL[to]}
                    title={t("confirm.archiveTitle")}
                    body={t("confirm.archiveBody")}
                    confirmLabel={EDITORIAL_TRANSITION_LABEL[to]}
                    cancelLabel={t("confirm.cancel")}
                  />
                ) : (
                  <Button type="submit" size="small" variant="outlined" sx={{ minHeight: 44 }}>
                    {EDITORIAL_TRANSITION_LABEL[to]}
                  </Button>
                )}
              </form>
            ))}
          </Stack>
        ) : (
          <Alert severity="info">{t("editor.noTransitions")}</Alert>
        )}
      </Box>

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

        <Stack spacing={4}>
          <Box component="section">
            <Typography variant="h2" sx={{ fontSize: "1.25rem", mb: 2 }}>
              {t("editor.settingsSection")}
            </Typography>

            {maySaveSettings ? (
              <EventFieldsForm event={event} declarations={declarations} />
            ) : (
              <Alert severity="info">{t("editor.eventFieldsReadOnly")}</Alert>
            )}
          </Box>

          <Box component="section">
            <Typography variant="h2" sx={{ fontSize: "1.25rem", mb: 1 }}>
              {t("editor.contentSection")}
            </Typography>
            {/* What the two tabs are, and what they are not: the same event, in two languages,
                and only the words differ — everything factual is in Settings above. */}
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
              {t("editor.contentHelp")}
            </Typography>

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
                    slugLocked={slugLocked}
                    mayEdit={mayEditTranslation(translation)}
                  />
                ),
              }))}
            />
          </Box>

          {maySaveAnything && (
            <Box component="section">
              <Divider sx={{ mb: 2 }} />
              {/* BR-REQ-051-01 criterion 4, once for the whole save now that there is one save.
                  The service refuses the save if the event is published and this is not ticked, so
                  the warning is binding rather than decorative. */}
              {live && (
                <FormControlLabel
                  control={<Checkbox name="acknowledgeLiveEdit" />}
                  label={t("editor.acknowledgeLive")}
                  sx={{ mb: 2, display: "flex" }}
                />
              )}
              <Button type="submit" variant="contained" sx={{ minHeight: 44 }}>
                {t("editor.save")}
              </Button>
            </Box>
          )}
        </Stack>
      </form>

      {/* The other way in to BR-REQ-037-05, from the event somebody is actually looking at.
          Only for an event with a queue to put anybody in, and only for the role that may. */}
      {canManageTestRegistrations(staffUser.role) && event.registrationMode === "INTERNAL" && (
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
          </Stack>
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
              title={t("confirm.duplicateTitle")}
              body={t("confirm.duplicateBody")}
              confirmLabel={t("editor.duplicate")}
              cancelLabel={t("confirm.cancel")}
            />
          </form>

          {/* Deletion is the Administrator's alone, and the service refuses any event that has
              a registration against it — archive is the answer for an event that happened. */}
          {canDeleteEvent(staffUser.role) && (
            <form action={deleteEventAction}>
              <input type="hidden" name="uiLocale" value={locale} />
              <input type="hidden" name="eventId" value={event.id} />
              <ConfirmSubmitButton
                label={t("editor.delete")}
                title={t("confirm.deleteTitle")}
                body={t("confirm.deleteBody")}
                confirmLabel={t("editor.delete")}
                cancelLabel={t("confirm.cancel")}
                color="error"
              />
            </form>
          )}
        </Stack>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
          {t("editor.deleteHelp")}
        </Typography>
      </Box>
    </Stack>
  );
}
