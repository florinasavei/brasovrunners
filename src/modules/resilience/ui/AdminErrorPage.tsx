"use client";

import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Link from "@mui/material/Link";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { useTranslations } from "next-intl";
import GlyphButton from "@/shared/ui/GlyphButton";
import { TAP_TARGET } from "@/shared/ui/tap-target";

/**
 * What a staff member sees when a backoffice page throws (§447) — most often because the database
 * is away: a compute that could not start, or Neon refusing for the rest of the month on its
 * quota. The public boundary (`[locale]/error.tsx`) says "go back to the first page", which is
 * the wrong door for a volunteer at the desk; this one says that nothing on the screen was saved
 * unless it said so, to try again in a minute, and that `/admin/tasks` → Costuri shows the month's
 * budget.
 *
 * A client component because Next requires it, and nothing else: no data, no repository. It
 * cannot tell an away-database from any other throw — in production a boundary gets only the
 * `digest`, never the message — so the sentence covers both honestly, and the digest is shown as
 * the public boundary shows it (§52).
 */
export default function AdminError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const t = useTranslations("Error");
  return (
    <Box sx={{ py: { xs: 2, sm: 4 } }}>
      <Typography variant="h1" gutterBottom>
        {t("staffTitle")}
      </Typography>
      <Alert severity="warning" sx={{ mb: 3 }} data-testid="admin-error-notice">
        {t("staffBody")}
      </Alert>
      <Stack direction={{ xs: "column", sm: "row" }} spacing={2} sx={{ mb: 3, alignItems: { sm: "center" } }}>
        <GlyphButton icon="reset" variant="contained" onClick={reset} sx={TAP_TARGET}>
          {t("retry")}
        </GlyphButton>
        {/* A plain anchor: the boundary may have caught a failure in the routing a localized href needs. */}
        <Link href="/admin/tasks">{t("staffTasks")}</Link>
      </Stack>
      {error.digest && (
        <Alert severity="info" icon={false}>
          <Typography variant="body2" sx={{ mb: 0.5 }}>
            {t("reference")}
          </Typography>
          <Box component="code" sx={{ fontFamily: "monospace", fontSize: "1rem" }}>
            {error.digest}
          </Box>
        </Alert>
      )}
    </Box>
  );
}
