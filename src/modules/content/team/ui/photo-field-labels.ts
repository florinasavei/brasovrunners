import type { getTranslations } from "next-intl/server";
import type { richTextEditorLabels } from "@/modules/content/rich-text/ui/labels";
import { HIGH_WEB_MAX, LOW_WEB_MAX, ORIGINAL_WEB_MAX, WEB_MAX } from "@/modules/media/limits";
import type { TeamPhotoLabels } from "./TeamPhotoField";

type Words = Awaited<ReturnType<typeof getTranslations<"Admin">>>;

/** What differs from one picture field to the next: its own title, help and the crop box's title and help. */
export type PhotoFieldOverrides = { legend: string; help: string; cropTitle: string; cropHelp: string };

/**
 * The words `TeamPhotoField` needs, built in one place (§541, §729; the field as §705, §709
 * and §717 reuse it): the upload, «Din galerie» and its picker, the quality choice and the crop
 * box's captions are the house's one set — `Admin.team.photo*`, `Admin.richText.*`, `Admin.gallery.*`
 * and the text editor's own labels — and only the four captions in `overrides` are the caller's.
 * Translated once on the server and handed to the island as strings (AGENTS.md §14.5).
 */
export function photoFieldLabels(
  t: Words,
  rich: ReturnType<typeof richTextEditorLabels>,
  overrides: PhotoFieldOverrides,
): TeamPhotoLabels {
  return {
    legend: overrides.legend,
    choose: t("team.photoChoose"),
    replace: t("team.photoReplace"),
    remove: t("team.photoRemove"),
    uploading: t("team.photoUploading"),
    failed: t("team.photoFailed"),
    none: t("team.photoNone"),
    help: overrides.help,
    fromGallery: t("team.photoFromGallery"),
    gallery: {
      loading: t("richText.imageGalleryLoading"),
      empty: t("richText.imageGalleryEmpty"),
      close: t("richText.linkCancel"),
      filter: t("richText.imageGalleryFilter"),
      noMatch: t("richText.imageGalleryNoMatch"),
      sourceLegend: t("richText.imageGallerySourceLegend"),
      sources: {
        all: t("richText.imageGallerySourceAll"),
        event: t("richText.imageGallerySourceEvent"),
        album: t("richText.imageGallerySourceAlbum"),
        page: t("richText.imageGallerySourcePage"),
        team: t("richText.imageGallerySourceTeam"),
      },
    },
    quality: {
      legend: t("gallery.qualityLegend"),
      low: t("gallery.qualityLow"),
      normal: t("gallery.qualityNormal"),
      high: t("gallery.qualityHigh"),
      original: t("gallery.qualityOriginal"),
      help: t("gallery.qualityHelp", {
        lowMax: String(LOW_WEB_MAX),
        normalMax: String(WEB_MAX),
        highMax: String(HIGH_WEB_MAX),
        originalMax: String(ORIGINAL_WEB_MAX),
      }),
    },
    crop: {
      title: overrides.cropTitle,
      help: overrides.cropHelp,
      reset: rich.imageCropReset,
      position: rich.imageCropPosition,
      ...rich.imageShapes,
    },
    chosen: rich.imageChosen,
    stored: rich.imageStored,
    picked: rich.imageFromGalleryPicked,
  };
}
