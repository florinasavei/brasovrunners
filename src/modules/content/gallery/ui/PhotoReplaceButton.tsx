"use client";

import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Typography from "@mui/material/Typography";
import { useRouter } from "next/navigation";
import { type ChangeEvent, useState } from "react";
import { prepareImageUpload } from "@/modules/media/browser-shrink";
import { readRemembered } from "@/modules/media/ui/ImageQualityChoice";
import { ACTION_ICONS } from "@/shared/ui/action-icons";

// A client island, so it makes the element itself (§318).
const ReplaceGlyph = ACTION_ICONS.replace;

export type PhotoReplaceLabels = {
  /** «Înlocuiește» / «Replace». */
  replace: string;
  replacing: string;
  replaced: string;
  /** The photo was removed or replaced by someone else meanwhile: a retry cannot help. */
  changed: string;
  /** The uploader's own refusal, raw with `{names}` (the same words as an upload). */
  failed: string;
};

/**
 * «Înlocuiește» on one photo of an album (§673): the uploader's file input for one file, shrunk in
 * the browser at the quality chosen beside «Încarcă fotografii» (the one remembered choice, §414,
 * §437), posted to the album's upload route with the photo it replaces. The server keeps the
 * photo's place and its cover role; the page then re-renders with the new picture.
 */
export default function PhotoReplaceButton({
  uploadUrl,
  itemId,
  labels,
}: {
  uploadUrl: string;
  itemId: string;
  labels: PhotoReplaceLabels;
}) {
  const router = useRouter();
  const [state, setState] = useState<"idle" | "replacing" | "replaced" | "changed" | "failed">("idle");
  const [failedName, setFailedName] = useState("");
  const inputId = `photo-replace-${itemId}`;

  const onChoose = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    // The same file chosen twice in a row must still fire a change.
    event.target.value = "";
    if (!file) return;
    setState("replacing");
    try {
      const quality = readRemembered();
      const prepared = await prepareImageUpload(file, quality);
      const body = new FormData();
      body.append("file", prepared.blob, file.name.replace(/\.[^.]+$/, "") + ".webp");
      body.append("originalFilename", file.name);
      body.append("quality", quality);
      body.append("replaceItemId", itemId);
      const response = await fetch(uploadUrl, { method: "POST", body });
      // Removed or replaced by someone else since the page was drawn (404, 409): the same file again
      // would meet the same answer, so the page is drawn again and says so, not "could not upload".
      if (response.status === 404 || response.status === 409) {
        setState("changed");
        router.refresh();
        return;
      }
      if (!response.ok) throw new Error(String(response.status));
      setState("replaced");
      router.refresh();
    } catch {
      setFailedName(file.name);
      setState("failed");
    }
  };

  return (
    <Box>
      <Button
        component="label"
        htmlFor={inputId}
        size="small"
        variant="outlined"
        disabled={state === "replacing"}
        startIcon={<ReplaceGlyph fontSize="small" />}
        sx={{ minHeight: 44 }}
        data-testid="photo-replace"
      >
        {state === "replacing" ? labels.replacing : labels.replace}
        <input id={inputId} type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={(event) => void onChoose(event)} />
      </Button>
      {state !== "idle" && state !== "replacing" && (
        <Typography
          variant="caption"
          color={state === "replaced" ? "text.secondary" : "error"}
          sx={{ display: "block", mt: 0.5 }}
          aria-live="polite"
          data-testid="photo-replace-note"
        >
          {state === "failed" ? labels.failed.replace("{names}", failedName) : state === "changed" ? labels.changed : labels.replaced}
        </Typography>
      )}
    </Box>
  );
}
