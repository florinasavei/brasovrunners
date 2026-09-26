"use client";

import CloseIcon from "@mui/icons-material/Close";
import Alert from "@mui/material/Alert";
import IconButton from "@mui/material/IconButton";
import MuiLink from "@mui/material/Link";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { Link } from "@/i18n/navigation";
import { SAVE_FALLBACK_COOKIE } from "./save-fallback";

/**
 * The line above the page after a save went the simple way (§NNN): the network blocked the
 * scripted request, the form was sent as a plain POST, and this is the page it landed on. The
 * layout reads the cookie the replay set (`SAVE_FALLBACK_COOKIE`) and this island clears it, the
 * way `ToastProvider` clears the flash — a refresh shows nothing. It says what happened, what to
 * do if a save fails, and where the network check is; the close button is 44 px (BR-REQ-041-01).
 */
export default function SaveFallbackNotice({ shown }: { shown: boolean }) {
  const t = useTranslations("Network");
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    if (!shown) return;
    try {
      document.cookie = `${SAVE_FALLBACK_COOKIE}=; Max-Age=0; path=/`;
    } catch {
      // A refused write shows the line once more on refresh; the cookie expires in a minute anyway.
    }
  }, [shown]);

  if (!shown || dismissed) return null;
  return (
    <Alert
      severity="info"
      sx={{ mb: 3, alignItems: "center" }}
      data-testid="save-fallback"
      action={
        <IconButton aria-label={t("close")} color="inherit" onClick={() => setDismissed(true)} sx={{ minWidth: 44, minHeight: 44 }}>
          <CloseIcon fontSize="small" />
        </IconButton>
      }
    >
      {t("fallback")}{" "}
      <MuiLink component={Link} href="/admin/network" color="inherit" sx={{ display: "inline-flex", alignItems: "center", minHeight: 44 }}>
        {t("check")}
      </MuiLink>
    </Alert>
  );
}
