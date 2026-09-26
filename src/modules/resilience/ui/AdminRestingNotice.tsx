import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { getTranslations } from "next-intl/server";
import { getPathname } from "@/i18n/navigation";
import type { Locale } from "@/i18n/routing";
import GlyphButton from "@/shared/ui/GlyphButton";
import { TAP_TARGET } from "@/shared/ui/tap-target";

/**
 * What the backoffice shows when its layout could not read the signed-in staff member because the
 * database is away (§NNN) — a compute that could not start, or Neon refusing for the rest of the
 * month on its quota.
 *
 * The layout reads the staff row on every page, and an error thrown there is not caught by the same
 * segment's `error.tsx` (a boundary catches its children, not its own layout), so staff met Next's
 * framework page. The layout now catches the away-error itself and renders this instead: the
 * backoffice's own sentence (the words `AdminErrorPage` says), a way to try again — a plain link to
 * the backoffice, which asks the database afresh — and the sign-out button, which needs no database.
 * A Server Component: no data, and the one island is the shell's own sign-out button, by name.
 */
export default async function AdminRestingNotice({
  locale,
  signOut,
}: {
  locale: Locale;
  signOut: (form: FormData) => Promise<void>;
}) {
  const t = await getTranslations("Error");
  const tAdmin = await getTranslations("Admin");
  return (
    <Box component="main" id="main" sx={{ py: { xs: 2, sm: 4 }, px: 2, maxWidth: 720, mx: "auto" }} data-testid="admin-resting">
      <Typography variant="h1" gutterBottom>
        {t("staffTitle")}
      </Typography>
      <Alert severity="warning" sx={{ mb: 3 }} data-testid="admin-error-notice">
        {t("staffBody")}
      </Alert>
      <Stack direction={{ xs: "column", sm: "row" }} spacing={2} sx={{ alignItems: { sm: "center" } }}>
        {/* A plain anchor: the page is drawn without the database, and this asks it again. */}
        <Box component="a" href={getPathname({ locale, href: "/admin" })} sx={{ ...TAP_TARGET, display: "inline-flex", alignItems: "center" }}>
          {t("retry")}
        </Box>
        <form action={signOut}>
          <input type="hidden" name="uiLocale" value={locale} />
          <GlyphButton icon="signOut" type="submit" size="small" variant="outlined">
            {tAdmin("signOut")}
          </GlyphButton>
        </form>
      </Stack>
    </Box>
  );
}
