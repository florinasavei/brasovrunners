import type { getTranslations } from "next-intl/server";
import { HIGH_WEB_MAX, LOW_WEB_MAX, ORIGINAL_WEB_MAX, WEB_MAX } from "@/modules/media/limits";
import type RichTextEditor from "./RichTextEditor";

type Translate = Awaited<ReturnType<typeof getTranslations<"Admin.richText">>>;

/**
 * The editor's control names, from the catalogue, for the two forms that mount it. One place,
 * so a control added to the editor is named in both forms or in neither — a client island
 * cannot read the catalogue itself (`RichTextEditor`'s own doc).
 */
export function richTextEditorLabels(rt: Translate): Parameters<typeof RichTextEditor>[0]["labels"] {
  return {
    bold: rt("bold"),
    italic: rt("italic"),
    heading2: rt("heading2"),
    heading3: rt("heading3"),
    bulletList: rt("bulletList"),
    orderedList: rt("orderedList"),
    quote: rt("quote"),
    align: {
      left: rt("alignLeft"),
      center: rt("alignCenter"),
      right: rt("alignRight"),
    },
    alignShort: {
      left: rt("alignLeftShort"),
      center: rt("alignCenterShort"),
      right: rt("alignRightShort"),
    },
    table: rt("table"),
    tableAddRow: rt("tableAddRow"),
    tableAddColumn: rt("tableAddColumn"),
    tableDeleteRow: rt("tableDeleteRow"),
    tableDeleteColumn: rt("tableDeleteColumn"),
    tableDelete: rt("tableDelete"),
    // §263: one control per choice, and the borders one is named after the state it is in, so
    // the tooltip says "lines: rows only" rather than "cycle the lines".
    tableBorders: {
      all: rt("tableBordersAll"),
      rows: rt("tableBordersRows"),
      none: rt("tableBordersNone"),
    },
    // §271: one name per state, so the tooltip says which colour the table is in.
    tableBorderColour: {
      default: rt("tableBorderColourDefault"),
      strong: rt("tableBorderColourStrong"),
      blue: rt("tableBorderColourBlue"),
      orange: rt("tableBorderColourOrange"),
    },
    tableHeaderFill: {
      default: rt("tableHeaderFillDefault"),
      none: rt("tableHeaderFillNone"),
      blue: rt("tableHeaderFillBlue"),
      orange: rt("tableHeaderFillOrange"),
    },
    tableValign: rt("tableValign"),
    tableHeaderRow: rt("tableHeaderRow"),
    link: rt("link"),
    linkUrl: rt("linkUrl"),
    linkApply: rt("linkApply"),
    linkRemove: rt("linkRemove"),
    linkCancel: rt("linkCancel"),
    // Raw, with its `{count}`: the island substitutes the number itself (§273).
    words: rt.raw("words") as string,
    preview: rt("preview"),
    previewShort: rt("previewShort"),
    previewClose: rt("previewClose"),
    undo: rt("undo"),
    redo: rt("redo"),
    image: rt("image"),
    imageUploading: rt("imageUploading"),
    imageFailed: rt("imageFailed"),
    // The quality beside the upload and what the picture became (§414).
    // Four levels since §437.
    imageQuality: {
      legend: rt("imageQualityLegend"),
      low: rt("imageQualityLow"),
      normal: rt("imageQualityNormal"),
      high: rt("imageQualityHigh"),
      original: rt("imageQualityOriginal"),
      help: rt("imageQualityHelp", {
        lowMax: String(LOW_WEB_MAX),
        normalMax: String(WEB_MAX),
        highMax: String(HIGH_WEB_MAX),
        originalMax: String(ORIGINAL_WEB_MAX),
      }),
    },
    imageChoose: rt("imageChoose"),
    // Raw, with their placeholders: the island says the chosen file's pixels and weight (§437).
    imageChosen: {
      chosen: rt.raw("imageChosen") as string,
      sent: rt.raw("imageSent") as string,
      lighter: rt.raw("imageLighter") as string,
    },
    imagePixels: rt.raw("imagePixels") as string,
    // Raw, with its six placeholders: the island substitutes the facts itself.
    imageStored: {
      template: rt.raw("imageStored") as string,
      topRung: rt.raw("imageStoredTopRung") as string,
      low: rt("imageStoredLow"),
      normal: rt("imageStoredNormal"),
      high: rt("imageStoredHigh"),
      original: rt("imageStoredOriginal"),
      nearLossless: rt.raw("imageStoredNearLossless") as string,
    },
    imageAlt: rt("imageAlt"),
    imageAltHelp: rt("imageAltHelp"),
    imageCaption: rt("imageCaption"),
    imageSize: rt("imageSize"),
    imageAlign: rt("imageAlign"),
    imageAlignBlock: rt("imageAlignBlock"),
    imageAlignLeft: rt("imageAlignLeft"),
    imageAlignRight: rt("imageAlignRight"),
    imageAlignHelp: rt("imageAlignHelp"),
    imageCrop: rt("imageCrop"),
    imageCropHelp: rt("imageCropHelp"),
    imageCropReset: rt("imageCropReset"),
    // Raw, with its four placeholders: the island substitutes the percentages itself.
    imageCropPosition: rt.raw("imageCropPosition") as string,
    imageRemove: rt("imageRemove"),
    imageDone: rt("imageDone"),
    imageClose: rt("imageClose"),
    imagePanel: rt("imagePanel"),
    imageNoAltOne: rt("imageNoAltOne"),
    // Raw, with its `{count}` placeholder: the island substitutes the number itself.
    imageNoAltMany: rt.raw("imageNoAltMany") as string,
    imageFromGallery: rt("imageFromGallery"),
    imageShort: rt("imageShort"),
    imageFromGalleryShort: rt("imageFromGalleryShort"),
    imageGalleryLoading: rt("imageGalleryLoading"),
    imageGalleryEmpty: rt("imageGalleryEmpty"),
    imageGalleryClose: rt("linkCancel"),
    youtube: rt("youtube"),
    youtubeShort: rt("youtubeShort"),
    youtubeUrl: rt("youtubeUrl"),
    youtubeApply: rt("youtubeApply"),
    youtubeInvalid: rt("youtubeInvalid"),
    youtubeCaption: rt("youtubeCaption"),
    youtubeRemove: rt("youtubeRemove"),
    youtubePoster: rt("youtubePoster"),
    youtubePosterUploading: rt("youtubePosterUploading"),
    youtubePosterFailed: rt("youtubePosterFailed"),
    youtubePosterUseYoutube: rt("youtubePosterUseYoutube"),
  };
}
