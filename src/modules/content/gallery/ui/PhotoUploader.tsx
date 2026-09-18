"use client";

import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import LinearProgress from "@mui/material/LinearProgress";
import Typography from "@mui/material/Typography";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { shrinkImageInBrowser } from "@/modules/media/browser-shrink";

/**
 * Photos in, from a phone, without the phone's file sizes.
 *
 * ## Why a client island, and why it resizes
 *
 * A photo from a phone is 3–8 MB; a request to a serverless function may carry 4.5 MB
 * (Vercel's limit); a bucket of originals would be twenty times the size of a bucket of what
 * the site actually shows. All three are solved in one place: the browser decodes each photo
 * (`createImageBitmap` with `imageOrientation: "from-image"`, so a portrait shot stays
 * upright), draws it onto a canvas no larger than 2000px on its long side, and posts that as
 * WebP — ~300–600 kB — one request per photo, so a failed upload is one photo to retry and not a
 * batch. The server re-checks everything and makes its own variants (`modules/media/images.ts`);
 * this is the part that has to happen where the original is.
 *
 * That is the case §1.5 asks a client island to make: nothing here is decoration, and there is
 * no server-only way to shrink a file before it is sent. With JavaScript off the control shows
 * its label and does nothing, and the page says the gallery needs it.
 */
export default function PhotoUploader({
  uploadUrl,
  labels,
}: {
  uploadUrl: string;
  labels: {
    choose: string;
    uploading: string;
    done: string;
    failed: string;
  };
}) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [progress, setProgress] = useState<{ done: number; total: number; failed: string[] } | null>(null);

  const shrink = shrinkImageInBrowser;

  async function upload(files: FileList) {
    const list = Array.from(files);
    const failed: string[] = [];
    setProgress({ done: 0, total: list.length, failed });
    for (const [index, file] of list.entries()) {
      try {
        const body = new FormData();
        // The shrunk photo, named after the original so the server records the name it had.
        body.append("file", await shrink(file), file.name.replace(/\.[^.]+$/, "") + ".webp");
        body.append("originalFilename", file.name);
        const response = await fetch(uploadUrl, { method: "POST", body });
        if (!response.ok) failed.push(file.name);
      } catch {
        failed.push(file.name);
      }
      setProgress({ done: index + 1, total: list.length, failed: [...failed] });
    }
    if (inputRef.current) inputRef.current.value = "";
    // The page is a Server Component: ask it to render the album again with the new photos.
    router.refresh();
  }

  const busy = progress !== null && progress.done < progress.total;

  return (
    <Box>
      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        multiple
        id="photo-upload"
        style={{ display: "none" }}
        onChange={(event) => {
          if (event.target.files && event.target.files.length > 0) void upload(event.target.files);
        }}
      />
      <Button component="label" htmlFor="photo-upload" variant="contained" disabled={busy} sx={{ minHeight: 44 }}>
        {labels.choose}
      </Button>
      {progress && (
        <Box sx={{ mt: 1.5, maxWidth: 480 }} aria-live="polite">
          <Typography variant="body2" color="text.secondary">
            {busy
              ? labels.uploading.replace("{done}", String(progress.done)).replace("{total}", String(progress.total))
              : labels.done.replace("{total}", String(progress.total - progress.failed.length))}
          </Typography>
          <LinearProgress variant="determinate" value={(progress.done / progress.total) * 100} sx={{ mt: 0.5 }} />
          {progress.failed.length > 0 && (
            <Typography variant="body2" color="error" sx={{ mt: 0.5 }}>
              {labels.failed.replace("{names}", progress.failed.join(", "))}
            </Typography>
          )}
        </Box>
      )}
    </Box>
  );
}
