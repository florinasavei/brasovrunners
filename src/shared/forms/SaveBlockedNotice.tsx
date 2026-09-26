"use client";

import Alert from "@mui/material/Alert";
import AlertTitle from "@mui/material/AlertTitle";
import Box from "@mui/material/Box";
import MuiLink from "@mui/material/Link";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";

/**
 * What a blocked save says when even the plain POST could not be sent (§NNN): nothing was saved,
 * the boxes still hold what was typed, try another network, and the page that names what to ask
 * IT to allow. Drawn by `ActionFormIsland` inside the form, above its refusal summary, and by the
 * admin error boundary for a plain form — only in the browser, after a failure, so a page that
 * never meets one never loads a word of it.
 */
export default function SaveBlockedNotice({ kept = true }: { kept?: boolean }) {
  const t = useTranslations("Network");
  return (
    <Alert severity="warning" sx={{ mb: 3 }} data-testid="save-blocked">
      <AlertTitle>{t("blocked.title")}</AlertTitle>
      <Box component="p" sx={{ m: 0 }}>
        {kept ? t("blocked.kept") : t("blocked.notKept")}
      </Box>
      <Box component="p" sx={{ m: 0, mt: 1 }}>
        <MuiLink component={Link} href="/admin/network" color="inherit" sx={{ display: "inline-flex", alignItems: "center", minHeight: 44 }}>
          {t("check")}
        </MuiLink>
      </Box>
    </Alert>
  );
}
