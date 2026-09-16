import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { routing } from "@/i18n/routing";
import PageFieldsForm from "@/modules/content/pages/ui/PageFieldsForm";
import { canCreateEvent } from "@/modules/staff-identity/domain/roles";
import { requireStaff } from "@/modules/staff-identity/session";
import { createPageAction } from "../actions";

type Props = {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ error?: string }>;
};

export const dynamic = "force-dynamic";

/** A new standing page, created as a draft in both languages (BR-REQ-050-03). */
export default async function NewPagePage({ params, searchParams }: Props) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);

  const actor = await requireStaff();
  if (!canCreateEvent(actor.role)) notFound();

  const { error } = await searchParams;
  const t = await getTranslations("Admin");

  return (
    <Stack spacing={3}>
      <Box id="admin-alert" tabIndex={-1} sx={{ scrollMarginTop: 16 }}>
        {error && <Alert severity="error">{t(`errors.${error}`)}</Alert>}
      </Box>

      <Typography variant="h2" sx={{ fontSize: "1.25rem" }}>
        {t("pages.create")}
      </Typography>

      {/* Plain <form> around a <Stack>: `<Stack component="form">` crashes in MUI 9. */}
      <form action={createPageAction}>
        <Stack spacing={3}>
          <input type="hidden" name="uiLocale" value={locale} />
          <PageFieldsForm navOrder={0} translations={[]} slugLocked={false} />
          <Box>
            <Button type="submit" variant="contained" sx={{ minHeight: 44 }}>
              {t("pages.create")}
            </Button>
          </Box>
        </Stack>
      </form>
    </Stack>
  );
}
