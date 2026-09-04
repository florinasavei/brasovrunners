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
import { Link } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";
import { findEventForEditing } from "@/modules/content/events/repository";
import { describeIncompleteLocales } from "@/modules/content/events/service";
import EventFieldsForm from "@/modules/content/events/ui/EventFieldsForm";
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
import { requireStaff } from "@/modules/staff-identity/session";
import {
  addTestRegistrationsAction,
  deleteEventAction,
  duplicateEventAction,
  removeTestRegistrationsAction,
  saveEventAction,
  saveTranslationAction,
  transitionEventAction,
} from "../../actions";

type Props = {
  params: Promise<{ locale: string; id: string }>;
  searchParams: Promise<{ error?: string; saved?: string }>;
};

export const dynamic = "force-dynamic";

/**
 * The one editing screen (BR-REQ-050-01, BR-REQ-051-01).
 *
 * Plain fields: the event row with every column an organizer owns, then one form per language.
 * No rich text — the canonical body is validated Tiptap JSON by AGENTS.md §11.3, and event
 * bodies are plain fields, so an editor for them would be an M5 content type built early and
 * half.
 *
 * Publication sits on the event rather than on either language (`DECISIONS.md` §28), so the
 * workflow buttons are here, once, and the page says plainly when a language is not yet
 * complete enough to publish.
 *
 * The interface hides what a role may not do, and that is a courtesy rather than the rule —
 * every button here is checked again in the action behind it. An Author sees no publish
 * button; an Author who posts one anyway is refused by the server (BR-REQ-060-01).
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

  const transitions = allowedTransitions(
    staffUser.role,
    event.editorialStatus,
    translations.some((translation) => translation.authorStaffUserId === staffUser.id),
  );
  const live = isLiveContent(event.editorialStatus);
  const slugLocked = event.publishedAt !== null;
  const incomplete = describeIncompleteLocales(translations);

  // Administrator only, and never in production — the second half is the environment, and it is
  // asserted again in the service and once more at the insert.
  const mayFillTheQueue =
    canManageTestRegistrations(staffUser.role) && areTestRegistrationsAvailable();

  return (
    <Stack spacing={4}>
      <Box>
        <Typography variant="body2">
          <Link href="/admin">{t("backToEvents")}</Link>
        </Typography>
      </Box>

      {error && <Alert severity="error">{t(`errors.${error}`)}</Alert>}
      {saved && <Alert severity="success">{t("saved")}</Alert>}

      {/* Publication, for the whole event. */}
      <Box component="section">
        <Stack direction="row" spacing={1} sx={{ mb: 2, flexWrap: "wrap", gap: 1 }}>
          <Typography variant="h2" sx={{ fontSize: "1.25rem" }}>
            {t("editor.publicationSection")}
          </Typography>
          <Chip size="small" label={t(`status.${event.editorialStatus}`)} />
          <Chip size="small" variant="outlined" label={t("editor.version", { version: event.version })} />
        </Stack>

        {live && <Alert severity="warning" sx={{ mb: 2 }}>{t("editor.liveWarning")}</Alert>}

        {incomplete.length > 0 && (
          <Alert severity="info" sx={{ mb: 2 }}>
            {t("editor.incompleteForPublication", {
              detail: incomplete
                .map((entry) => `${entry.locale.toUpperCase()}: ${entry.missing.join(", ")}`)
                .join(" · "),
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
                <Button type="submit" size="small" variant="outlined">
                  {t(`transition.${to}`)}
                </Button>
              </form>
            ))}
          </Stack>
        ) : (
          <Alert severity="info">{t("editor.noTransitions")}</Alert>
        )}
      </Box>

      {/* The event row: every column an organizer owns. */}
      <Box component="section">
        <Typography variant="h2" sx={{ fontSize: "1.25rem", mb: 2 }}>
          {t("editor.eventSection")}
        </Typography>

        {canEditEventFields(staffUser.role) ? (
          // A plain form around the Stack: `<Stack component="form" action={...}>` crashes in
          // MUI 9.
          <form action={saveEventAction}>
            <input type="hidden" name="uiLocale" value={locale} />
            <input type="hidden" name="eventId" value={event.id} />
            {/* The version this form was rendered from. A save carrying a stale one is a
                conflict, not an overwrite (BR-REQ-051-01 criterion 5). */}
            <input type="hidden" name="expectedVersion" value={event.version} />

            <Stack spacing={2}>
              <EventFieldsForm event={event} declarations={declarations} />
              <Box>
                <Button type="submit" variant="contained">
                  {t("editor.saveEvent")}
                </Button>
              </Box>
            </Stack>
          </form>
        ) : (
          <Alert severity="info">{t("editor.eventFieldsReadOnly")}</Alert>
        )}
      </Box>

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
                <Button type="submit" variant="outlined" size="small">
                  {t("testRegistrations.add")}
                </Button>
              </Stack>
            </form>

            <form action={removeTestRegistrationsAction}>
              <input type="hidden" name="uiLocale" value={locale} />
              <input type="hidden" name="eventId" value={event.id} />
              <Button type="submit" variant="outlined" size="small" color="warning">
                {t("testRegistrations.remove")}
              </Button>
            </form>
          </Stack>
        </Box>
      )}

      {translations.map((translation) => {
        const mayEdit = canEditTranslation(
          staffUser.role,
          {
            editorialStatus: event.editorialStatus,
            authorStaffUserId: translation.authorStaffUserId,
          },
          staffUser.id,
        );

        return (
          // Each locale is a named region, so a screen reader — and an end-to-end test —
          // can tell the Romanian form from the English one.
          <Box
            component="section"
            key={translation.id}
            aria-labelledby={`translation-${translation.locale}`}
          >
            <Divider sx={{ mb: 3 }} />

            <Stack direction="row" spacing={1} sx={{ mb: 2, flexWrap: "wrap", gap: 1 }}>
              <Typography
                id={`translation-${translation.locale}`}
                variant="h2"
                sx={{ fontSize: "1.25rem" }}
              >
                {t("editor.translationSection", { locale: translation.locale.toUpperCase() })}
              </Typography>
              <Chip
                size="small"
                variant="outlined"
                label={t("editor.version", { version: translation.version })}
              />
            </Stack>

            <Typography variant="body2" sx={{ mb: 2 }}>
              <Link
                locale={translation.locale}
                href={{ pathname: "/preview/events/[id]", params: { id: event.id } }}
              >
                {t("events.preview")}
              </Link>
            </Typography>

            {mayEdit ? (
              <form action={saveTranslationAction}>
                <input type="hidden" name="uiLocale" value={locale} />
                <input type="hidden" name="eventId" value={event.id} />
                <input type="hidden" name="translationId" value={translation.id} />
                <input type="hidden" name="expectedVersion" value={translation.version} />
                {/* A locked slug is not sent by the disabled field, so it is sent here. */}
                {slugLocked && <input type="hidden" name="slug" value={translation.slug} />}

                <Stack spacing={2}>
                  <TextField
                    name="title"
                    label={t("editor.fields.title")}
                    defaultValue={translation.title}
                    required
                  />
                  <TextField
                    name="slug"
                    label={t("editor.fields.slug")}
                    defaultValue={translation.slug}
                    helperText={slugLocked ? t("editor.slugLocked") : t("editor.slugHelp")}
                    disabled={slugLocked}
                    required={!slugLocked}
                  />
                  <TextField
                    name="excerpt"
                    label={t("editor.fields.excerpt")}
                    defaultValue={translation.excerpt ?? ""}
                    multiline
                    minRows={2}
                  />
                  <TextField
                    name="locationName"
                    label={t("editor.fields.locationName")}
                    defaultValue={translation.locationName}
                    required
                  />
                  <TextField
                    name="locationAddress"
                    label={t("editor.fields.locationAddress")}
                    defaultValue={translation.locationAddress ?? ""}
                  />
                  <TextField
                    name="difficultyLabel"
                    label={t("editor.fields.difficultyLabel")}
                    defaultValue={translation.difficultyLabel ?? ""}
                  />
                  <TextField
                    name="costText"
                    label={t("editor.fields.costText")}
                    helperText={t("editor.costHelp")}
                    defaultValue={translation.costText ?? ""}
                  />
                  <TextField
                    name="seoTitle"
                    label={t("editor.fields.seoTitle")}
                    defaultValue={translation.seoTitle ?? ""}
                  />
                  <TextField
                    name="seoDescription"
                    label={t("editor.fields.seoDescription")}
                    defaultValue={translation.seoDescription ?? ""}
                    multiline
                    minRows={2}
                  />

                  {/* BR-REQ-051-01 criterion 4: warn before a save that changes live content. */}
                  {live && (
                    <FormControlLabel
                      control={<Checkbox name="acknowledgeLiveEdit" />}
                      label={t("editor.acknowledgeLive")}
                    />
                  )}

                  <Box>
                    <Button type="submit" variant="contained">
                      {t("editor.saveTranslation")}
                    </Button>
                  </Box>
                </Stack>
              </form>
            ) : (
              <Alert severity="info">{t("editor.translationReadOnly")}</Alert>
            )}
          </Box>
        );
      })}

      <Box component="section">
        <Divider sx={{ mb: 3 }} />
        <Typography variant="h2" sx={{ fontSize: "1.25rem", mb: 2 }}>
          {t("editor.copySection")}
        </Typography>

        <Stack direction="row" spacing={2} sx={{ flexWrap: "wrap", gap: 1 }}>
          <form action={duplicateEventAction}>
            <input type="hidden" name="uiLocale" value={locale} />
            <input type="hidden" name="eventId" value={event.id} />
            <Button type="submit" variant="outlined" size="small">
              {t("editor.duplicate")}
            </Button>
          </form>

          {/* Deletion is the Administrator's alone, and the service refuses any event that has
              a registration against it — archive is the answer for an event that happened. */}
          {canDeleteEvent(staffUser.role) && (
            <form action={deleteEventAction}>
              <input type="hidden" name="uiLocale" value={locale} />
              <input type="hidden" name="eventId" value={event.id} />
              <Button type="submit" variant="outlined" size="small" color="error">
                {t("editor.delete")}
              </Button>
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
