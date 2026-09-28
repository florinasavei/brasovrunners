"use client";

import UploadIcon from "@mui/icons-material/Upload";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { type ChangeEvent, useState } from "react";
import { presetCrop } from "@/modules/content/rich-text/domain/picture-frame";
import type { ImageCrop } from "@/modules/content/rich-text/domain/schema";
import ImageCropBox, { type ImageCropLabels } from "@/modules/content/rich-text/ui/ImageCropBox";
import GalleryPicker, { type GalleryPickerLabels } from "@/modules/media/ui/GalleryPicker";
import ImageQualityChoice, { type ImageQualityLabels, useImageQuality } from "@/modules/media/ui/ImageQualityChoice";
import {
  type ChosenFacts,
  type ChosenFactsLabels,
  describeChosenImage,
  describeStoredImage,
  type StoredFacts,
  type StoredFactsLabels,
} from "@/modules/media/ui/stored-facts";
import { uploadPicture } from "@/modules/media/ui/upload-picture";
import { recalledJson, useRecall } from "@/shared/forms/recall";
import GlyphButton from "@/shared/ui/GlyphButton";
import { readTeamPhotoCrop } from "../photo-crop";
import TeamPhotoImage from "./TeamPhotoImage";

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
  /** The crop box's words (§454), the text editor's own, with the card's title and help (§541). */
  crop: ImageCropLabels;
  /** What is going up and what it became (§437, §414), the text editor's own sentences. */
  chosen: ChosenFactsLabels;
  stored: StoredFactsLabels;
  /** "Din galerie: {name}, {width} × {height} px." — a picture taken from the gallery (§485). */
  picked: string;
};

/** The photograph on the card: its id, the master the crop box draws over, the small file, its size. */
export type TeamPhotoValue = { id: string; src: string; preview: string; width: number; height: number };

type Props = {
  /** The stored picture on the card now, if any, with the crop it is shown with. */
  photo: TeamPhotoValue | null;
  crop: ImageCrop | null;
  labels: TeamPhotoLabels;
  /** Distinguishes two of these on one page (a card's form and the "add" form). */
  inputId: string;
};

/**
 * The shape a person's photograph starts in (§541): a square portrait — what the card always
 * drew. The crop box offers every other shape of §454, and the club may pick one.
 */
export const TEAM_PHOTO_SHAPE = "1:1" as const;

/** The crop a newly chosen photograph starts with: its largest square, in the middle. */
export function initialTeamCrop(intrinsic: { width: number; height: number }): ImageCrop | null {
  return presetCrop(TEAM_PHOTO_SHAPE, intrinsic);
}

/**
 * A card's photograph (§459), with the upload every other picture has (§541, amending §474): the
 * quality beside it (§414, §437), the chosen file's pixels and weight and what it became once
 * stored, «Din galerie» beside it (§485) — and after the choice the crop box with §454's shapes,
 * 1∶1 pressed first, a portrait. Uploaded through `uploadPicture`, the one upload a picture in the
 * text and a film's poster use, never a second one.
 *
 * The card keeps the picture's id and the crop in two hidden fields the save posts; nothing is
 * saved on the card until the form is — an uploaded picture waits in the store and is swept after
 * a week if the card never keeps it (§73). The stored file is never touched: the crop is four
 * fractions the page draws (§241).
 *
 * All its words arrive as strings from the page (§353: a backoffice island reads no catalogue of
 * its own). After a refused save it comes back with the picture and the crop that were chosen:
 * both are posted and recalled (§315), the picture's addresses and size in one hidden field.
 */
export default function TeamPhotoField(props: Props) {
  const recall = useRecall();
  return <PhotoField key={recall.generation} {...props} />;
}

const EMPTY: TeamPhotoValue = { id: "", src: "", preview: "", width: 0, height: 0 };

/** The recalled picture, or the card's own: only a whole value is taken back. */
function recalledPhoto(raw: string | undefined, id: string | undefined, fallback: TeamPhotoValue | null): TeamPhotoValue {
  if (id === undefined) return fallback ?? EMPTY;
  if (id === "") return EMPTY;
  const value = recalledJson(raw, null) as Partial<TeamPhotoValue> | null;
  if (value && typeof value.src === "string" && typeof value.preview === "string" && Number(value.width) > 0 && Number(value.height) > 0) {
    return { id, src: value.src, preview: value.preview, width: Number(value.width), height: Number(value.height) };
  }
  return fallback && fallback.id === id ? fallback : { ...EMPTY, id };
}

function PhotoField({ photo: initial, crop: initialCrop, labels, inputId }: Props) {
  const recall = useRecall();
  const [photo, setPhoto] = useState<TeamPhotoValue>(() => recalledPhoto(recall.value("photoPicture"), recall.value("photoAssetId"), initial));
  const [crop, setCrop] = useState<ImageCrop | null>(() => {
    const recalled = recall.value("photoCrop");
    if (recalled === undefined) return initialCrop;
    const read = readTeamPhotoCrop(recalled);
    return read === "invalid" ? null : read;
  });
  const [state, setState] = useState<"idle" | "uploading" | "failed">("idle");
  const [galleryOpen, setGalleryOpen] = useState(false);
  // The session's choice, shared with every other uploader on the page (§414).
  const [quality, setQuality] = useImageQuality();
  /** What is going up, or went up last (§437), and what it became (§414). */
  const [chosen, setChosen] = useState<ChosenFacts | null>(null);
  const [stored, setStored] = useState<StoredFacts | null>(null);
  /** A picture taken from the gallery, said like an upload (§485). */
  const [picked, setPicked] = useState<{ name: string; width: number; height: number } | null>(null);
  const named = recall.named("photoAssetId");
  const lang = typeof document === "undefined" ? "ro" : document.documentElement.lang || "ro";
  const sized = photo.id !== "" && photo.width > 0 && photo.height > 0;

  /** A new photograph: its largest square first (§541), the crop box's shapes for the rest. */
  const take = (next: TeamPhotoValue) => {
    setPhoto(next);
    setCrop(next.width > 0 && next.height > 0 ? initialTeamCrop(next) : null);
  };

  const onChoose = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    // The same file chosen twice in a row must still fire a change.
    event.target.value = "";
    if (!file) return;
    setState("uploading");
    setChosen(null);
    setStored(null);
    setPicked(null);
    try {
      const uploaded = await uploadPicture(file, setChosen, quality);
      take({ id: uploaded.assetId, src: uploaded.src, preview: uploaded.src, width: uploaded.width, height: uploaded.height });
      setStored(uploaded.stored ?? null);
      setState("idle");
    } catch {
      setState("failed");
    }
  };

  const remove = () => {
    setPhoto(EMPTY);
    setCrop(null);
    setChosen(null);
    setStored(null);
    setPicked(null);
  };

  return (
    <Box component="fieldset" sx={{ border: 0, m: 0, p: 0, minWidth: 0 }}>
      <Typography component="legend" variant="subtitle2" sx={{ mb: 1 }}>
        {labels.legend}
      </Typography>
      <input type="hidden" name="photoAssetId" value={photo.id} />
      <input type="hidden" name="photoCrop" value={photo.id && crop ? JSON.stringify(crop) : ""} />
      <input
        type="hidden"
        name="photoPicture"
        value={photo.id ? JSON.stringify({ src: photo.src, preview: photo.preview, width: photo.width, height: photo.height }) : ""}
      />
      <Stack direction="row" spacing={2} sx={{ alignItems: "center", flexWrap: "wrap", gap: 1 }}>
        {photo.id && photo.preview ? (
          // The card's own drawing at 96 pixels: the crop in its shape, or the square it always was.
          sized ? (
            <TeamPhotoImage src={photo.preview} photo={{ width: photo.width, height: photo.height, crop }} width={96} radius={8} testId={`${inputId}-preview`} />
          ) : (
            // eslint-disable-next-line @next/next/no-img-element -- the club's own stored picture, size unknown
            <img src={photo.preview} alt="" width={96} height={96} style={{ width: 96, height: 96, objectFit: "cover", objectPosition: "50% 25%", borderRadius: 8, display: "block" }} />
          )
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
          startIcon={<UploadIcon fontSize="small" />}
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
          <GlyphButton icon="delete" variant="text" color="error" sx={{ minHeight: 44 }} onClick={remove}>
            {labels.remove}
          </GlyphButton>
        )}
      </Stack>
      {galleryOpen && (
        <Box sx={{ mt: 1, border: 1, borderColor: "divider", borderRadius: 1 }}>
          <GalleryPicker
            onPick={(picture) => {
              // The master for the crop box, the small file for the preview, as the saved card's are.
              take({ id: picture.id, src: picture.src, preview: picture.thumb, width: picture.width, height: picture.height });
              setChosen(null);
              setStored(null);
              setPicked({ name: picture.name, width: picture.width, height: picture.height });
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
      {/* What is going up (§437) and what it became (§414): the text editor's own sentences. */}
      {chosen && (
        <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }} aria-live="polite" data-testid={`${inputId}-chosen`}>
          {describeChosenImage(chosen, labels.chosen, lang)}
        </Typography>
      )}
      {state === "idle" && stored && photo.id && (
        <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }} aria-live="polite" data-testid={`${inputId}-stored`}>
          {describeStoredImage(stored, labels.stored, lang)}
        </Typography>
      )}
      {state === "idle" && picked && photo.id && (
        <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }} aria-live="polite" data-testid={`${inputId}-picked`}>
          {labels.picked.replace("{name}", picked.name).replace("{width}", String(picked.width)).replace("{height}", String(picked.height))}
        </Typography>
      )}
      <Typography
        variant="caption"
        color={state === "failed" || named ? "error" : "text.secondary"}
        role={state === "failed" ? "alert" : undefined}
        sx={{ display: "block", mt: 0.5 }}
      >
        {state === "failed" ? labels.failed : named && recall.fieldError ? recall.fieldError : labels.help}
      </Typography>
      {/*
        The crop box after the choice (§485's order), the text editor's own (§454): the five
        shapes, 1∶1 held first — a portrait — and the rectangle over the whole photograph. Never
        its pixels: the page draws the four fractions (§241). At most a phone's width, so the
        photograph is never taller than the screen it is cropped on.
      */}
      {sized && (
        <Box sx={{ mt: 1.5, maxWidth: 360 }} data-testid={`${inputId}-crop`}>
          <ImageCropBox
            key={`${photo.src}@${photo.width}x${photo.height}`}
            src={photo.src}
            intrinsic={{ width: photo.width, height: photo.height }}
            crop={crop}
            onChange={setCrop}
            resting={TEAM_PHOTO_SHAPE}
            labels={labels.crop}
            testId={`${inputId}-crop-surface`}
          />
        </Box>
      )}
    </Box>
  );
}
