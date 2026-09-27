"use client";

import CloseIcon from "@mui/icons-material/Close";
import Alert from "@mui/material/Alert";
import IconButton from "@mui/material/IconButton";
import Snackbar from "@mui/material/Snackbar";
import { HEADER_CLEARANCE_PX } from "@/theme/brand";
import { type NoticeKind, TOAST_AUTO_HIDE_MS } from "./notice";

/** One toast as drawn: its sentence already in the reader's language, and an id that changes with every toast. */
export type DrawnToast = { id: number; kind: NoticeKind; sentence: string; autoHideMs?: number };

/** Where every toast is anchored: top centre, just under the sticky site header (`HEADER_CLEARANCE_PX`). */
export const TOAST_ANCHOR = { vertical: "top", horizontal: "center" } as const;
export const TOAST_TOP_PX = HEADER_CLEARANCE_PX;

/**
 * The toast as drawn, and the live region around it (`DECISIONS.md` §384) — one component for
 * the backoffice's `ToastProvider` and the public site's `FlashToast` (§427), so a toast looks,
 * sits and is announced the same wherever it appears.
 *
 * `role="status"`: a polite live region, mounted empty with its island and filled afterwards —
 * a region inserted already holding its sentence is one many screen readers never announce,
 * while a change inside a region they already know is. Nothing steals the focus.
 *
 * **Where it sits.** At the top, centred, just under the sticky site header (§NNN; the owner,
 * 2026-09-27: «toast-urile trebuie să apară în partea de sus») — where the eye is after a press
 * at the top of an editor, and away from the footer's sticky bar and the event editor's sticky
 * save row at the bottom: the toast never covers the primary button of the form that produced it
 * (measured at 320 px by `tests/e2e/toasts-and-confirms.spec.ts`).
 *
 * Strings only: the sentence and the close button's name come translated, so this file reads no
 * catalogue and a public page that draws it ships no words for it (§353).
 */
export default function ToastRegion({
  toast,
  closeLabel,
  onDismiss,
}: {
  toast: DrawnToast | null;
  closeLabel: string;
  onDismiss: () => void;
}) {
  return (
    <div role="status" aria-live="polite" data-testid="toast-live">
      {toast && (
        <Snackbar
          key={toast.id}
          open
          autoHideDuration={toast.autoHideMs ?? TOAST_AUTO_HIDE_MS}
          // The clock runs whether or not this window has the focus: a volunteer who glanced at
          // another app must not come back to a stale "it worked" from five minutes ago.
          disableWindowBlurListener
          onClose={(_event, reason) => {
            // A click elsewhere never dismisses it: the next press on the page must not lose the
            // sentence about the last one.
            if (reason === "clickaway") return;
            onDismiss();
          }}
          anchorOrigin={TOAST_ANCHOR}
          // At the top (§NNN), just under the sticky site header — the one pair the theme's
          // `scroll-padding-top` also reads (`HEADER_CLEARANCE_PX`) — so it never covers the
          // header's way out, nor the footer's bar or the editor's sticky save row at the bottom.
          sx={{ top: { xs: TOAST_TOP_PX.xs, sm: TOAST_TOP_PX.sm } }}
          data-testid="toast"
        >
          <Alert
            // Not a live region of its own: the one around it announces the sentence, once.
            role="presentation"
            severity={toast.kind}
            variant="filled"
            // The close button drawn here rather than through `onClose`: MUI's own is 28 px, and a
            // thumb's target is 44 (BR-REQ-041-01 criterion 6).
            action={
              <IconButton aria-label={closeLabel} color="inherit" onClick={onDismiss} sx={{ minWidth: 44, minHeight: 44 }}>
                <CloseIcon fontSize="small" />
              </IconButton>
            }
            sx={{ width: "100%", alignItems: "center", boxShadow: 6, "& .MuiAlert-action": { pt: 0, alignSelf: "center" } }}
          >
            {toast.sentence}
          </Alert>
        </Snackbar>
      )}
    </div>
  );
}
