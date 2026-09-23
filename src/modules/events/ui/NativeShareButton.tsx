"use client";

import IosShareIcon from "@mui/icons-material/IosShare";
import Button from "@mui/material/Button";
import { useSyncExternalStore } from "react";
import { SHARE_ICON_SX, SHARE_PILL_SX } from "./share-pill";

/**
 * The phone's own share sheet (`DECISIONS.md` §140): where `navigator.share` exists — every
 * phone, and desktop Safari — one press reaches whatever app the person shares with, which
 * is how a run actually gets passed around. Rendered only once the browser has said it can,
 * so the server's HTML and the first client render agree (no hydration mismatch), and a
 * browser without it never sees a button that does nothing.
 *
 * `navigator.share` is called in the click itself — no `await` before it, nothing fetched
 * first. iOS Safari counts the call against the tap that caused it and refuses one made after
 * the activation has lapsed; a handler that is synchronous up to the call is the one shape it
 * always accepts. The network anchors beside this button (`ShareLinks`) need no script at all.
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
      sx={SHARE_PILL_SX}
      onClick={() => {
        navigator.share({ url, title, text }).catch(() => {
          /* the person closed the sheet; nothing to say */
        });
      }}
    >
      <IosShareIcon sx={SHARE_ICON_SX} aria-hidden="true" />
      {label}
    </Button>
  );
}
