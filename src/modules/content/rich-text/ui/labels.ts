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
    table: rt("table"),
    tableAddRow: rt("tableAddRow"),
    tableAddColumn: rt("tableAddColumn"),
    tableDeleteRow: rt("tableDeleteRow"),
    tableDeleteColumn: rt("tableDeleteColumn"),
    tableDelete: rt("tableDelete"),
    link: rt("link"),
    linkUrl: rt("linkUrl"),
    linkApply: rt("linkApply"),
    linkRemove: rt("linkRemove"),
    linkCancel: rt("linkCancel"),
    undo: rt("undo"),
    redo: rt("redo"),
    image: rt("image"),
    imageUploading: rt("imageUploading"),
    imageFailed: rt("imageFailed"),
    imageAlt: rt("imageAlt"),
    imageAltHelp: rt("imageAltHelp"),
    imageCaption: rt("imageCaption"),
    imageSize: rt("imageSize"),
    imageAlign: rt("imageAlign"),
    imageAlignBlock: rt("imageAlignBlock"),
    imageAlignLeft: rt("imageAlignLeft"),
    imageAlignRight: rt("imageAlignRight"),
    imageAlignHelp: rt("imageAlignHelp"),
    imageRemove: rt("imageRemove"),
    imageDone: rt("imageDone"),
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
