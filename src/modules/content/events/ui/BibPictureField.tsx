"use client";

import UploadIcon from "@mui/icons-material/Upload";
import { ACTION_ICONS } from "@/shared/ui/action-icons";

const ReplaceGlyph = ACTION_ICONS.replace;
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { type ChangeEvent, useEffect, useRef, useState } from "react";
import { ratioCrop } from "@/modules/content/rich-text/domain/picture-frame";
import type { ImageCrop } from "@/modules/content/rich-text/domain/schema";
import ImageCropBox, { type ImageCropLabels } from "@/modules/content/rich-text/ui/ImageCropBox";
import type { PickerScope } from "@/modules/media/picker";
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
import { BIB_PICTURE_RATIO, BIB_PICTURE_UNCROPPED, type BibPictureSlot } from "@/modules/registrations/bib-picture-frame";
import { BIB_DESIGN_FORM_PREFIX } from "@/modules/registrations/bib-design-query";
import { recalledJson, useRecall } from "@/shared/forms/recall";
import GlyphButton from "@/shared/ui/GlyphButton";

export type BibPictureLabels = {
  legend: string;
  help: string;
  /** The place empty: «Fără imagine». */
  none: string;
  choose: string;
  replace: string;
  remove: string;
  uploading: string;
  failed: string;
  fromGallery: string;
  gallery: GalleryPickerLabels;
  quality: ImageQualityLabels;
  crop: ImageCropLabels;
  /** The place's shape in words, its ratio already in it. */
  shape: string;
  chosen: ChosenFactsLabels;
  stored: StoredFactsLabels;
  /** "Din galerie: {name}, {width} × {height} px." (§485). */
  picked: string;
};

/** A place's picture: the asset, its web variant (what the design stores and the crop box draws over), its small file and size. */
export type BibPictureValue = { id: string; src: string; thumb: string; width: number; height: number };

type Props = {
  slot: BibPictureSlot;
  picture: BibPictureValue | null;
  crop: ImageCrop | null;
  /** The event whose editor this is: the gallery opens on «Acest eveniment». Null on the create page. */
  scope: PickerScope | null;
  labels: BibPictureLabels;
  /**
   * `member`: the members' header (§664) — the header's place and shape, under the members' own
   * field names, so one control serves both headers and there is no second copy of it.
   */
  place?: "member";
};

/** The form's field names for a place: the picture's address, its crop, and what a refused save brings back. */
export function bibPictureFieldNames(slot: BibPictureSlot, place?: "member") {
  // A member's card (§NNN) is a place of its own, always the members'.
  const key = slot === "memberCard" ? "member.cardImage" : place === "member" ? "member.headerImage" : slot === "header" ? "headerImage" : "sponsorImage";
  return {
    src: `${BIB_DESIGN_FORM_PREFIX}${key}Src`,
    crop: `${BIB_DESIGN_FORM_PREFIX}${key}Crop`,
    picture: `${BIB_DESIGN_FORM_PREFIX}${key}Picture`,
  };
}

/** The crop a newly chosen picture starts with: the place's shape, as large as it goes, in the middle. */
export function initialBibCrop(slot: BibPictureSlot, intrinsic: { width: number; height: number }): ImageCrop | null {
  return intrinsic.width > 0 && intrinsic.height > 0 ? ratioCrop(BIB_PICTURE_RATIO[slot], intrinsic) : null;
}

/**
 * One picture place of the bib designer (§560, amending §249 and §485): the platform's own picture
 * control — «Încarcă o imagine» through the shared `uploadPicture` with the quality choice and the
 * facts it shows (§414, §437), «Din galerie» (§485), «Fără imagine» — then the crop box held to the
 * place's one shape (`bib-picture-frame.ts`). The address and the crop go in hidden fields that the
 * event's «Salvează» posts with the rest of the design; nothing is kept until then, and an unkept
 * upload is swept after a week (§73).
 *
 * Each change fires `change` on the hidden fields, so the panel's preview (`BibDesignPreview`),
 * which listens to the form, redraws the bib with the unsaved picture and crop. Recalled after a
 * refused save (§315), like the team's photo.
 */
export default function BibPictureField(props: Props) {
  const recall = useRecall();
  return <PictureField key={recall.generation} {...props} />;
}

const EMPTY: BibPictureValue = { id: "", src: "", thumb: "", width: 0, height: 0 };

function recalledPicture(raw: string | undefined, src: string | undefined, fallback: BibPictureValue | null): BibPictureValue {
  if (src === undefined) return fallback ?? EMPTY;
  if (src === "") return EMPTY;
  const value = recalledJson(raw, null) as Partial<BibPictureValue> | null;
  if (value && typeof value.id === "string" && typeof value.thumb === "string" && Number(value.width) > 0 && Number(value.height) > 0) {
    return { id: value.id, src, thumb: value.thumb, width: Number(value.width), height: Number(value.height) };
  }
  return fallback && fallback.src === src ? fallback : { ...EMPTY, src };
}

function PictureField({ slot, picture: initial, crop: initialCrop, scope, labels, place }: Props) {
  const recall = useRecall();
  const names = bibPictureFieldNames(slot, place);
  const [picture, setPicture] = useState<BibPictureValue>(() => recalledPicture(recall.value(names.picture), recall.value(names.src), initial));
  const [crop, setCrop] = useState<ImageCrop | null>(() => {
    const recalled = recall.value(names.crop);
    if (recalled === undefined) return initialCrop;
    const value = recalledJson(recalled, null) as ImageCrop | null;
    return value && typeof value.x === "number" ? value : null;
  });
  const [state, setState] = useState<"idle" | "uploading" | "failed">("idle");
  const [galleryOpen, setGalleryOpen] = useState(false);
  const [quality, setQuality] = useImageQuality();
  const [chosen, setChosen] = useState<ChosenFacts | null>(null);
  const [stored, setStored] = useState<StoredFacts | null>(null);
  const [picked, setPicked] = useState<{ name: string; width: number; height: number } | null>(null);
  const cropInput = useRef<HTMLInputElement>(null);
  const first = useRef(true);
  const lang = typeof document === "undefined" ? "ro" : document.documentElement.lang || "ro";
  const inputId = slot === "memberCard" ? "bib-picture-member-card" : place === "member" ? "bib-picture-member-header" : `bib-picture-${slot}`;
  const sized = picture.src !== "" && picture.width > 0 && picture.height > 0;

  // The preview listens to the form's `change` (`BibDesignPreview`); a hidden field set by React
  // fires none, so the field says it changed — after the new value is in the page.
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    cropInput.current?.dispatchEvent(new Event("change", { bubbles: true }));
  }, [picture.src, crop]);

  /** A new picture starts in the place's shape, as large as it goes, in the middle. */
  const take = (next: BibPictureValue) => {
    setPicture(next);
    setCrop(initialBibCrop(slot, next));
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
      // The upload answers the web variant's address and the asset; the crop box draws over it.
      take({ id: uploaded.assetId, src: uploaded.src, thumb: uploaded.src, width: uploaded.width, height: uploaded.height });
      setStored(uploaded.stored ?? null);
      setState("idle");
    } catch {
      setState("failed");
    }
  };

  const remove = () => {
    setPicture(EMPTY);
    setCrop(null);
    setChosen(null);
    setStored(null);
    setPicked(null);
  };

  return (
    <Box component="fieldset" sx={{ border: 0, p: 0, m: 0, minWidth: 0 }} data-testid={inputId}>
      <Typography component="legend" variant="body2" color="text.secondary" sx={{ mb: 0.5 }}>
        {labels.legend}
      </Typography>
      <Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 1 }}>
        {labels.help}
      </Typography>
      {/* What «Salvează» posts: the web variant's address (the design's rule, §249) and the crop. */}
      <input type="hidden" name={names.src} value={picture.src} />
      <input ref={cropInput} type="hidden" name={names.crop} value={picture.src && crop ? JSON.stringify(crop) : ""} />
      <input
        type="hidden"
        name={names.picture}
        value={picture.src ? JSON.stringify({ id: picture.id, thumb: picture.thumb, width: picture.width, height: picture.height }) : ""}
      />
      <Stack direction="row" sx={{ alignItems: "center", flexWrap: "wrap", gap: 1 }}>
        {picture.src ? (
          // eslint-disable-next-line @next/next/no-img-element -- the club's own stored picture, a thumbnail
          <img
            src={picture.thumb || picture.src}
            alt=""
            width={72}
            height={72}
            style={{ width: 72, height: 72, objectFit: "cover", borderRadius: 4, display: "block" }}
            data-testid={`${inputId}-thumb`}
          />
        ) : (
          <Typography variant="body2" color="text.secondary" data-testid={`${inputId}-none`}>
            {labels.none}
          </Typography>
        )}
        <Button
          component="label"
          htmlFor={`${inputId}-file`}
          variant="outlined"
          size="small"
          startIcon={picture.src ? <ReplaceGlyph fontSize="small" /> : <UploadIcon fontSize="small" />}
          disabled={state === "uploading"}
          sx={{ minHeight: 44 }}
        >
          {state === "uploading" ? labels.uploading : picture.src ? labels.replace : labels.choose}
          <input id={`${inputId}-file`} type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={onChoose} />
        </Button>
        <GlyphButton
          icon="gallery"
          variant="outlined"
          size="small"
          disabled={state === "uploading"}
          aria-expanded={galleryOpen}
          onClick={() => setGalleryOpen((open) => !open)}
          sx={{ minHeight: 44 }}
        >
          {labels.fromGallery}
        </GlyphButton>
        {picture.src && (
          <GlyphButton icon="delete" variant="text" color="error" size="small" sx={{ minHeight: 44 }} onClick={remove}>
            {labels.remove}
          </GlyphButton>
        )}
      </Stack>
      {galleryOpen && (
        <Box sx={{ mt: 1, border: 1, borderColor: "divider", borderRadius: 1 }}>
          <GalleryPicker
            {...(scope ? { scope } : {})}
            onPick={(stored) => {
              take({ id: stored.id, src: stored.src, thumb: stored.thumb, width: stored.width, height: stored.height });
              setChosen(null);
              setStored(null);
              setPicked({ name: stored.name, width: stored.width, height: stored.height });
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
      {chosen && (
        <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }} aria-live="polite" data-testid={`${inputId}-chosen`}>
          {describeChosenImage(chosen, labels.chosen, lang)}
        </Typography>
      )}
      {state === "idle" && stored && picture.src && (
        <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }} aria-live="polite" data-testid={`${inputId}-stored`}>
          {describeStoredImage(stored, labels.stored, lang)}
        </Typography>
      )}
      {state === "idle" && picked && picture.src && (
        <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }} aria-live="polite" data-testid={`${inputId}-picked`}>
          {labels.picked.replace("{name}", picked.name).replace("{width}", String(picked.width)).replace("{height}", String(picked.height))}
        </Typography>
      )}
      {state === "failed" && (
        <Typography variant="caption" color="error" role="alert" sx={{ display: "block", mt: 0.5 }}>
          {labels.failed}
        </Typography>
      )}
      {/* The crop box in the place's one shape (§560): the part the bib prints. */}
      {sized && (
        <Box sx={{ mt: 1.5, maxWidth: 480 }} data-testid={`${inputId}-crop`}>
          <ImageCropBox
            key={`${picture.src}@${picture.width}x${picture.height}`}
            src={picture.src}
            intrinsic={{ width: picture.width, height: picture.height }}
            crop={crop}
            onChange={setCrop}
            shape={{ ratio: BIB_PICTURE_RATIO[slot], label: labels.shape, reset: BIB_PICTURE_UNCROPPED[slot] === "fit" ? "whole" : "centre" }}
            labels={labels.crop}
            testId={`${inputId}-crop-surface`}
          />
        </Box>
      )}
    </Box>
  );
}
