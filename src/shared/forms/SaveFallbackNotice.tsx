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
 * The line above the page after the simple way was tried (§436): the network blocked the scripted
 * request, the person pressed «Trimite pe calea simplă», the form left as a plain POST, and this is
 * the page the answer drew. The layout reads the cookie that button set (`SAVE_FALLBACK_COOKIE`)
 * and this island clears it, the way `ToastProvider` clears the flash — a refresh shows nothing.
 *
 * It says the path was *tried*, never that the save landed: a cookie set as the POST leaves cannot
 * know whether it arrived. The §384 toast is what says it landed, so the sentence pairs with it —
 * the confirmation means saved; no confirmation means check the page and try another network.
 * The close button is 44 px (BR-REQ-041-01).
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
