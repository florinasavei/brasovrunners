import type { getTranslations } from "next-intl/server";
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
    // The quality beside the upload and what the picture became (§NNN).
    imageQuality: {
      legend: rt("imageQualityLegend"),
      normal: rt("imageQualityNormal"),
      high: rt("imageQualityHigh"),
      help: rt("imageQualityHelp"),
    },
    imageChoose: rt("imageChoose"),
    // Raw, with its six placeholders: the island substitutes the facts itself.
    imageStored: {
      template: rt.raw("imageStored") as string,
      normal: rt("imageStoredNormal"),
      high: rt("imageStoredHigh"),
      nearLossless: rt("imageStoredNearLossless"),
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
  };
}
