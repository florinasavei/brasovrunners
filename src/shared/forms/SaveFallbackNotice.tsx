"use client";

import CloseIcon from "@mui/icons-material/Close";
import Alert from "@mui/material/Alert";
import IconButton from "@mui/material/IconButton";
import MuiLink from "@mui/material/Link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { Link } from "@/i18n/navigation";
import { SAVE_FALLBACK_COOKIE } from "./save-fallback";

/**
 * The line on the page a «Trimite pe calea simplă» POST landed on (§436); clears its cookie, so a
 * refresh shows nothing. It says the path was *tried* — only the §384 toast says the save landed.
 * The close button is 44 px (BR-REQ-041-01).
 *
 * Drawn by the layout, which a client navigation never re-renders, so it latches the first path
 * and stays gone once the path differs.
 */
export default function SaveFallbackNotice({ shown }: { shown: boolean }) {
  const t = useTranslations("Network");
  const pathname = usePathname();
  const [landedOn] = useState(pathname);
  const [dismissed, setDismissed] = useState(false);
  // Latched during render: returning to the landed path later keeps it gone.
  const [left, setLeft] = useState(false);
  if (!left && pathname !== landedOn) setLeft(true);

  useEffect(() => {
    if (!shown) return;
    try {
      document.cookie = `${SAVE_FALLBACK_COOKIE}=; Max-Age=0; path=/`;
    } catch {
      // The cookie expires in a minute anyway.
    }
  }, [shown]);

  if (!shown || dismissed || left || pathname !== landedOn) return null;
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
