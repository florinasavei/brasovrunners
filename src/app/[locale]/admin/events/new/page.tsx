import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Divider from "@mui/material/Divider";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { getDb } from "@/db/client";
import { Link } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";
import EventFieldsForm from "@/modules/content/events/ui/EventFieldsForm";
import { listApprovedVersions } from "@/modules/legal-documents/repository";
import { canCreateEvent } from "@/modules/staff-identity/domain/roles";
import { requireStaff } from "@/modules/staff-identity/session";
import { createEventAction } from "../../actions";

type Props = {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ error?: string }>;
};

export const dynamic = "force-dynamic";

/**
 * A new event (BR-REQ-050-01).
 *
 * Both languages are asked for here rather than "Romanian now, English later": publication
 * requires a complete translation in every locale (`DECISIONS.md` §28), and a form that lets
 * one language be skipped produces an event that cannot be published and nobody remembers why.
 *
 * The rest of the fields are the same component the editor uses, so nothing is configurable
 * after creation that could not be set at creation — `src/db/seeds/pilot.ts` stopped being how
 * an event is configured the moment this existed.
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
          <EventFieldsForm event={null} declarations={declarations} />

          {routing.locales.map((contentLocale) => (
            <Box key={contentLocale}>
              <Divider sx={{ mb: 2 }} />
              <Typography variant="h3" sx={{ fontSize: "1rem", mb: 2 }}>
                {t("editor.translationSection", { locale: contentLocale.toUpperCase() })}
              </Typography>
              <Stack spacing={2}>
                <TextField
                  name={`${contentLocale}.title`}
                  label={t("editor.fields.title")}
                  required
                />
                <TextField
                  name={`${contentLocale}.slug`}
                  label={t("editor.fields.slug")}
                  helperText={t("editor.slugHelp")}
                  required
                />
                <TextField
                  name={`${contentLocale}.locationName`}
                  label={t("editor.fields.locationName")}
                  required
                />
                <TextField
                  name={`${contentLocale}.excerpt`}
                  label={t("editor.fields.excerpt")}
                  helperText={t("editor.excerptHelp")}
                  multiline
                  minRows={2}
                />
              </Stack>
            </Box>
          ))}

          <Box>
            <Button type="submit" variant="contained">
              {t("editor.create")}
            </Button>
          </Box>
        </Stack>
      </form>
    </Stack>
  );
}
