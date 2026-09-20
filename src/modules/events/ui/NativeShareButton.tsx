"use client";

import IosShareIcon from "@mui/icons-material/IosShare";
import Button from "@mui/material/Button";
import { useSyncExternalStore } from "react";

/**
 * The phone's own share sheet (`DECISIONS.md` §140): where `navigator.share` exists — every
 * phone, and desktop Safari — one press reaches whatever app the person shares with, which
 * is how a run actually gets passed around. Rendered only once the browser has said it can,
 * so the server's HTML and the first client render agree (no hydration mismatch), and a
 * browser without it never sees a button that does nothing.
 */
export default function NativeShareButton({ url, title, text, label }: { url: string; title: string; text: string; label: string }) {
  // Server snapshot false, client snapshot the truth: the first client render matches the HTML.
  const available = useSyncExternalStore(
    () => () => {},
    () => typeof navigator.share === "function",
    () => false,
  );
  if (!available) return null;
  return (
    <Button
      variant="contained"
      size="small"
      // The same two sizes as the pills beside it (§170): a finger's 44, a pointer's 32.
      sx={{ minHeight: { xs: 44, sm: 32 }, gap: 0.5, px: { xs: 1.5, sm: 1.25 }, fontSize: { sm: "0.78rem" } }}
      onClick={() => {
        navigator.share({ url, title, text }).catch(() => {
          /* the person closed the sheet; nothing to say */
        });
      }}
    >
      <IosShareIcon sx={{ fontSize: 20 }} aria-hidden="true" />
      {label}
    </Button>
  );
}
