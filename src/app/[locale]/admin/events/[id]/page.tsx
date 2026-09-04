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
import { toWallTimeInput } from "@/modules/events/domain/zoned-time";
import {
  allowedTransitions,
  canEditEventFields,
  canEditTranslation,
  isLiveContent,
} from "@/modules/staff-identity/domain/roles";
import { requireStaff } from "@/modules/staff-identity/session";
import { saveEventAction, saveTranslationAction, transitionAction } from "../../actions";

type Props = {
  params: Promise<{ locale: string; id: string }>;
  searchParams: Promise<{ error?: string; saved?: string }>;
};

export const dynamic = "force-dynamic";

/**
 * The one editing screen (BR-REQ-050-01, BR-REQ-051-01).
 *
 * Plain fields, one form per locale, and the event row above them. No rich text: the canonical
 * body is validated Tiptap JSON by AGENTS.md §11.3, and event bodies are plain fields, so an
 * editor for them would be an M5 content type built early and half.
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

  const record = await findEventForEditing(getDb(), id);
  if (!record) notFound();
  const { event, translations } = record;

  const t = await getTranslations("Admin");

  return (
    <Stack spacing={4}>
      <Box>
        <Typography variant="body2">
          <Link href="/admin">{t("backToEvents")}</Link>
        </Typography>
      </Box>

      {error && <Alert severity="error">{t(`errors.${error}`)}</Alert>}
      {saved && <Alert severity="success">{t("saved")}</Alert>}

      {/* The event row: the two times, the map link, and whether the site leads with it. */}
      <Box component="section">
        <Typography variant="h2" sx={{ fontSize: "1.25rem", mb: 2 }}>
          {t("editor.eventSection")}
        </Typography>

        {canEditEventFields(staffUser.role) ? (
          <form action={saveEventAction}>
            <input type="hidden" name="uiLocale" value={locale} />
            <input type="hidden" name="eventId" value={event.id} />

            <Stack spacing={2}>
              <TextField
                name="startsAtWallTime"
                type="datetime-local"
                label={t("editor.startsAt")}
                helperText={t("editor.startsAtHelp", { timezone: event.timezone })}
                defaultValue={toWallTimeInput(event.startsAt, event.timezone)}
                slotProps={{ inputLabel: { shrink: true } }}
                required
              />
              <TextField
                name="raceStartsAtWallTime"
                type="datetime-local"
                label={t("editor.raceStartsAt")}
                helperText={t("editor.raceStartsAtHelp")}
                defaultValue={toWallTimeInput(event.raceStartsAt, event.timezone)}
                slotProps={{ inputLabel: { shrink: true } }}
              />
              <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
                <TextField
                  name="latitude"
                  label={t("editor.latitude")}
                  defaultValue={event.latitude ?? ""}
                  inputMode="decimal"
                  sx={{ flex: 1 }}
                />
                <TextField
                  name="longitude"
                  label={t("editor.longitude")}
                  defaultValue={event.longitude ?? ""}
                  inputMode="decimal"
                  sx={{ flex: 1 }}
                />
              </Stack>
              <Typography variant="body2" color="text.secondary">
                {t("editor.coordinatesHelp")}
              </Typography>

              <TextField
                name="mapUrl"
                type="url"
                label={t("editor.mapUrl")}
                helperText={t("editor.mapUrlHelp")}
                defaultValue={event.mapUrl ?? ""}
                inputMode="url"
              />
              <FormControlLabel
                control={<Checkbox name="featured" defaultChecked={event.featured} />}
                label={t("editor.featured")}
              />
              <Typography variant="body2" color="text.secondary">
                {t("editor.featuredHelp")}
              </Typography>

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

      {translations.map((translation) => {
        const mayEdit = canEditTranslation(
          staffUser.role,
          {
            editorialStatus: translation.editorialStatus,
            authorStaffUserId: translation.authorStaffUserId,
          },
          staffUser.id,
        );
        const transitions = allowedTransitions(
          staffUser.role,
          translation.editorialStatus,
          translation.authorStaffUserId === staffUser.id,
        );
        const live = isLiveContent(translation.editorialStatus);
        const slugLocked = translation.publishedAt !== null;

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
              <Chip size="small" label={t(`status.${translation.editorialStatus}`)} />
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

            {/* BR-REQ-051-01 criterion 4: warn before a save that changes live content. */}
            {live && (
              <Alert severity="warning" sx={{ mb: 2 }}>
                {t("editor.liveWarning")}
              </Alert>
            )}

            {mayEdit ? (
              <form action={saveTranslationAction}>
                <input type="hidden" name="uiLocale" value={locale} />
                <input type="hidden" name="eventId" value={event.id} />
                <input type="hidden" name="translationId" value={translation.id} />
                {/* The version this form was rendered from. A save carrying a stale one is a
                    conflict, not an overwrite (BR-REQ-051-01 criterion 5). */}
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

            {transitions.length > 0 && (
              <Stack direction="row" spacing={1} sx={{ mt: 2, flexWrap: "wrap", gap: 1 }}>
                {transitions.map((to) => (
                  <form action={transitionAction} key={to}>
                    <input type="hidden" name="uiLocale" value={locale} />
                    <input type="hidden" name="eventId" value={event.id} />
                    <input type="hidden" name="translationId" value={translation.id} />
                    <input type="hidden" name="expectedVersion" value={translation.version} />
                    <input type="hidden" name="to" value={to} />
                    <Button type="submit" size="small" variant="outlined">
                      {t(`transition.${to}`)}
                    </Button>
                  </form>
                ))}
              </Stack>
            )}
          </Box>
        );
      })}
    </Stack>
  );
}
