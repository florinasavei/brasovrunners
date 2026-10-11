import type { getTranslations } from "next-intl/server";
import type { richTextEditorLabels } from "@/modules/content/rich-text/ui/labels";
import type { TeamPhotoLabels } from "@/modules/content/team/ui/TeamPhotoField";
import { HIGH_WEB_MAX, LOW_WEB_MAX, ORIGINAL_WEB_MAX, WEB_MAX } from "@/modules/media/limits";

type Words = Awaited<ReturnType<typeof getTranslations<"Admin">>>;

/**
 * The words «Echipa»'s picture field needs when it takes an event's cover (the facelift's phase 2,
 * §709; the field as the shop reused it, §705): the upload, «Din galerie», the quality choice and the
 * crop box — translated once on the server and handed to the island as strings (AGENTS.md §14.5).
 * The cover's own legend, help and crop captions; everything else is the house's one set.
 */
export function coverPhotoLabels(t: Words, rich: ReturnType<typeof richTextEditorLabels>): TeamPhotoLabels {
  return {
    legend: t("editor.cover.legend"),
    choose: t("team.photoChoose"),
    replace: t("team.photoReplace"),
    remove: t("team.photoRemove"),
    uploading: t("team.photoUploading"),
    failed: t("team.photoFailed"),
    none: t("team.photoNone"),
    help: t("editor.cover.help"),
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
      title: t("editor.cover.cropTitle"),
      help: t("editor.cover.cropHelp"),
      reset: rich.imageCropReset,
      position: rich.imageCropPosition,
      ...rich.imageShapes,
    },
    chosen: rich.imageChosen,
    stored: rich.imageStored,
    picked: rich.imageFromGalleryPicked,
  };
}
