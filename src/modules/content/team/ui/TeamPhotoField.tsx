"use client";

import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { type ChangeEvent, useState } from "react";
import { useRecall } from "@/shared/forms/recall";
import { shrinkImageInBrowser } from "@/modules/media/browser-shrink";
import GalleryPicker, { type GalleryPickerLabels } from "@/modules/media/ui/GalleryPicker";
import ImageQualityChoice, { type ImageQualityLabels, useImageQuality } from "@/modules/media/ui/ImageQualityChoice";
import GlyphButton from "@/shared/ui/GlyphButton";

export type TeamPhotoLabels = {
  /** "Fotografia" — the group's name. */
  legend: string;
  choose: string;
  replace: string;
  remove: string;
  uploading: string;
  failed: string;
  none: string;
  help: string;
  /** «Calitate: Minimă / Medie / Mare / Originală» beside the upload (§414), the gallery's words. */
  quality: ImageQualityLabels;
  /** «Din galerie» and its picker's words (§485). */
  fromGallery: string;
  gallery: GalleryPickerLabels;
};

type Props = {
  /** The stored picture on the card now, if any. */
  assetId: string | null;
  previewUrl: string | null;
  labels: TeamPhotoLabels;
  /** Distinguishes two of these on one page (a card's form and the "add" form). */
  inputId: string;
};

/**
 * A card's photograph (§459): choose a file, it is shrunk in the browser only if it must be and
 * stored exactly as a picture in a page is (`/api/admin/media`, §72, §414), and the card keeps
 * the stored picture's id in a hidden field the save posts. Nothing is saved on the card until
 * the form is — the picture waits in the store and is swept after a week if the card never keeps
 * it (§73).
 *
 * Or a picture the club already stored (§485): «Din galerie» opens the same picker every other
 * picture comes from, and the card keeps that picture's id exactly as it would an upload's — the
 * picture stays where else it is used, and the orphan sweep counts the card as one more place.
 *
 * All its words arrive as strings from the page (§353: a backoffice island reads no catalogue of
 * its own). After a refused save it comes back with the picture that was chosen: the id and the
 * preview's address are both posted and recalled (§315).
 */
export default function TeamPhotoField(props: Props) {
  const recall = useRecall();
  return <PhotoField key={recall.generation} {...props} />;
}

function PhotoField({ assetId, previewUrl, labels, inputId }: Props) {
  const recall = useRecall();
  const [photo, setPhoto] = useState(() => ({
    id: recall.value("photoAssetId") ?? assetId ?? "",
    preview: recall.value("photoPreview") ?? previewUrl ?? "",
  }));
  const [state, setState] = useState<"idle" | "uploading" | "failed">("idle");
  const [galleryOpen, setGalleryOpen] = useState(false);
  // The session's choice, shared with every other uploader on the page (§414).
  const [quality, setQuality] = useImageQuality();
  const named = recall.named("photoAssetId");

  const onChoose = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    // The same file chosen twice in a row must still fire a change.
    event.target.value = "";
    if (!file) return;
    setState("uploading");
    try {
      const body = new FormData();
      body.append("file", await shrinkImageInBrowser(file, quality), file.name.replace(/\.[^.]+$/, "") + ".webp");
      body.append("originalFilename", file.name);
      body.append("quality", quality);
      const response = await fetch("/api/admin/media", { method: "POST", body });
      if (!response.ok) throw new Error(String(response.status));
      const uploaded = (await response.json()) as { assetId: string; src: string };
      setPhoto({ id: uploaded.assetId, preview: uploaded.src });
      setState("idle");
    } catch {
      setState("failed");
    }
  };

  return (
    <Box component="fieldset" sx={{ border: 0, m: 0, p: 0, minWidth: 0 }}>
      <Typography component="legend" variant="subtitle2" sx={{ mb: 1 }}>
        {labels.legend}
      </Typography>
      <input type="hidden" name="photoAssetId" value={photo.id} />
      <input type="hidden" name="photoPreview" value={photo.id ? photo.preview : ""} />
      <Stack direction="row" spacing={2} sx={{ alignItems: "center", flexWrap: "wrap", gap: 1 }}>
        {photo.id && photo.preview ? (
          // eslint-disable-next-line @next/next/no-img-element -- the club's own stored picture
          <img
            src={photo.preview}
            alt=""
            width={96}
            height={96}
            style={{ width: 96, height: 96, objectFit: "cover", objectPosition: "50% 25%", borderRadius: 8, display: "block" }}
          />
        ) : (
          <Typography variant="body2" color="text.secondary">
            {labels.none}
          </Typography>
        )}
        <Button
          id={recall.idOf("photoAssetId")}
          component="label"
          htmlFor={inputId}
          variant="outlined"
          disabled={state === "uploading"}
          sx={{ minHeight: 44 }}
        >
          {state === "uploading" ? labels.uploading : photo.id ? labels.replace : labels.choose}
          <input id={inputId} type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={onChoose} />
        </Button>
        {/* The same glyph as the album's and the film poster's «Din galerie» (§485): one action, one look. */}
        <GlyphButton
          icon="gallery"
          variant="outlined"
          disabled={state === "uploading"}
          aria-expanded={galleryOpen}
          onClick={() => setGalleryOpen((open) => !open)}
          sx={{ minHeight: 44 }}
        >
          {labels.fromGallery}
        </GlyphButton>
        {photo.id && (
          <Button variant="text" color="error" sx={{ minHeight: 44 }} onClick={() => setPhoto({ id: "", preview: "" })}>
            {labels.remove}
          </Button>
        )}
      </Stack>
      {galleryOpen && (
        <Box sx={{ mt: 1, border: 1, borderColor: "divider", borderRadius: 1 }}>
          <GalleryPicker
            onPick={(picture) => {
              // The small file for the 96-pixel preview, as the saved card's own preview is.
              setPhoto({ id: picture.id, preview: picture.thumb });
              setState("idle");
              setGalleryOpen(false);
            }}
            onClose={() => setGalleryOpen(false)}
            labels={labels.gallery}
            testId={`${inputId}-gallery`}
          />
        </Box>
      )}
      <Box sx={{ mt: 1 }}>
        <ImageQualityChoice value={quality} onChange={setQuality} labels={labels.quality} disabled={state === "uploading"} />
      </Box>
      <Typography
        variant="caption"
        color={state === "failed" || named ? "error" : "text.secondary"}
        role={state === "failed" ? "alert" : undefined}
        sx={{ display: "block", mt: 0.5 }}
      >
        {state === "failed" ? labels.failed : named && recall.fieldError ? recall.fieldError : labels.help}
      </Typography>
    </Box>
  );
}
