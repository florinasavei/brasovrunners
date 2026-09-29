"use client";

import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import Paper from "@mui/material/Paper";
import Popper from "@mui/material/Popper";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import ToggleButton from "@mui/material/ToggleButton";
import ToggleButtonGroup from "@mui/material/ToggleButtonGroup";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import AddPhotoAlternateIcon from "@mui/icons-material/AddPhotoAlternate";
import BorderAllIcon from "@mui/icons-material/BorderAll";
import CheckIcon from "@mui/icons-material/Check";
import CloseIcon from "@mui/icons-material/Close";
import BorderClearIcon from "@mui/icons-material/BorderClear";
import BorderColorIcon from "@mui/icons-material/BorderColor";
import BorderHorizontalIcon from "@mui/icons-material/BorderHorizontal";
import DeleteIcon from "@mui/icons-material/Delete";
import FormatAlignCenterIcon from "@mui/icons-material/FormatAlignCenter";
import FormatAlignJustifyIcon from "@mui/icons-material/FormatAlignJustify";
import FormatAlignLeftIcon from "@mui/icons-material/FormatAlignLeft";
import FormatAlignRightIcon from "@mui/icons-material/FormatAlignRight";
import FormatBoldIcon from "@mui/icons-material/FormatBold";
import FormatColorFillIcon from "@mui/icons-material/FormatColorFill";
import FormatItalicIcon from "@mui/icons-material/FormatItalic";
import FormatListBulletedIcon from "@mui/icons-material/FormatListBulleted";
import FormatListNumberedIcon from "@mui/icons-material/FormatListNumbered";
import FormatQuoteIcon from "@mui/icons-material/FormatQuote";
import LinkIcon from "@mui/icons-material/Link";
import LinkOffIcon from "@mui/icons-material/LinkOff";
import PhotoLibraryIcon from "@mui/icons-material/PhotoLibrary";
import RedoIcon from "@mui/icons-material/Redo";
import SmartDisplayIcon from "@mui/icons-material/SmartDisplay";
import TableChartIcon from "@mui/icons-material/TableChart";
import TableRowsIcon from "@mui/icons-material/TableRows";
import UploadIcon from "@mui/icons-material/Upload";
import UndoIcon from "@mui/icons-material/Undo";
import VerticalAlignCenterIcon from "@mui/icons-material/VerticalAlignCenter";
import ViewColumnIcon from "@mui/icons-material/ViewColumn";
import VisibilityIcon from "@mui/icons-material/Visibility";
import WebAssetIcon from "@mui/icons-material/WebAsset";
import YouTubeIcon from "@mui/icons-material/YouTube";
import type { SvgIconProps } from "@mui/material/SvgIcon";
import { Extension, mergeAttributes, Node, type Editor } from "@tiptap/core";
import Image from "@tiptap/extension-image";
import { EditorContent, useEditor, useEditorState } from "@tiptap/react";
import { BubbleMenu } from "@tiptap/react/menus";
import StarterKit from "@tiptap/starter-kit";
import { TableKit } from "@tiptap/extension-table/kit";
import { youtubeVideoId } from "@/modules/events/domain/video";
import { type ComponentProps, type ComponentType, useCallback, useEffect, useRef, useState } from "react";
import type { PickerScope, PickerScopeKind, PictureSource } from "@/modules/media/picker";
import GalleryPicker, { type StoredPicture } from "@/modules/media/ui/GalleryPicker";
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
import ToolbarButton from "@/shared/ui/ToolbarButton";
import {
  BLOCK_ALIGNMENTS,
  EMPTY_DOC,
  IMAGE_ALIGNMENTS,
  IMAGE_WIDTH_PERCENTS,
  readRichText,
  richTextToPlainText,
  TABLE_BORDERS,
  TABLE_BORDER_COLOURS,
  TABLE_HEADER_FILLS,
  type BlockAlignment,
  type ImageCrop,
  type ImageFocus,
  type RichTextDoc,
  type TableBorderColour,
  type TableBorders,
  type TableHeaderFill,
  type TableValign,
} from "../domain/schema";
import { CROP_PRESETS, type CropPreset, presetCrop } from "../domain/picture-frame";
import { editorLook, sameEditorLook } from "./editor-look";
import { fillIsFor, RICH_TEXT_FILL_EVENT, type RichTextFillDetail } from "./fill-event";
import ImageCropBox, { type ImageCropLabels } from "./ImageCropBox";
import { cardFrameGeometry, cropGeometry, cropImageCss, cropWindowCss } from "./image-layout";
import { EDITOR_TABLE_SX, PREVIEW_CONTENT_SX } from "./table-layout";

/** Created once: a new identity re-registers the bubble menu's plugin. */
const TABLE_BAR_OPTIONS = { placement: "top" } as const;

/**
 * The floating bars sit above the sticky toolbar's `zIndex: 2` (§361, §363).
 *
 * Set on our `Paper`, never via `BubbleMenu`'s `style`: Tiptap 3.31 copies `style`/`data-*`/
 * `aria-*` in a `@__PURE__`-annotated call the production minifier deletes, so only the plugin's
 * own props (`editor`, `pluginKey`, `shouldShow`, `options`) survive; a unit test enforces it. The
 * menu element makes no stacking context, so 3 stacks with the toolbar, below MUI's overlays.
 */
const FLOATING_BAR_SX = { position: "relative", zIndex: 3 } as const;

/**
 * The writing area's box, shared by `.tiptap` and the stand-in drawn until Tiptap mounts after
 * hydration, so the layout does not jump on mount and a press never lands on a moved button.
 */
const WRITING_AREA_BOX = { minHeight: 240, p: 2 } as const;

/** Word's glyphs for the three alignments (§274). */
const ALIGN_ICON = {
  left: FormatAlignLeftIcon,
  center: FormatAlignCenterIcon,
  right: FormatAlignRightIcon,
} as const;

/** A picture's or film's placement as an alignment glyph (§521). */
const PLACEMENT_ICON = {
  block: FormatAlignJustifyIcon,
  left: FormatAlignLeftIcon,
  right: FormatAlignRightIcon,
} as const;

/**
 * The WYSIWYG editor for editorial bodies. Only `/admin` imports it, so Tiptap never reaches a
 * public page (`AGENTS.md` §14.1, §1.5).
 *
 * A hidden input posts `JSON.stringify(doc)`, so the form and its Server Action are unchanged;
 * if the island fails to load, it still carries the original body and a save changes nothing.
 * Toolbar controls are `ToolbarButton`s with Material glyphs (§361).
 */
function RichTextEditorIsland({
  name,
  initialBody,
  label,
  accessibleSuffix,
  features = { media: true, tables: true },
  cardPictures = false,
  pictureScope,
  labels,
}: {
  /** The form field the JSON is posted as. */
  name: string;
  /** A document, an old-shape body, or nothing. */
  initialBody: unknown;
  label: string;
  /** For the accessible name only, usually the language, so twin editors are distinguishable. */
  accessibleSuffix?: string;
  /**
   * Toolbar halves this body may use (§270): emails have no media or tables
   * (`email-rich-text.ts`). Not the guard, which is the server; it hides buttons a save would reject.
   */
  features?: { media?: boolean; tables?: boolean; video?: boolean };
  /**
   * The body is an event's short description, whose pictures every listing card draws in one
   * 16∶9 frame (§454): the picture's panel then shows that frame and offers the card's centre.
   */
  cardPictures?: boolean;
  /** The stored owner of this text, so «Din galerie» opens on its pictures (§485). Plain data (§370). */
  pictureScope?: PickerScope;
  /** Translated control names; a client island cannot read the catalogue. */
  labels: {
    bold: string;
    italic: string;
    heading2: string;
    heading3: string;
    bulletList: string;
    orderedList: string;
    quote: string;
    /** §213. */
    align: Record<BlockAlignment, string>;
    alignShort: Record<BlockAlignment, string>;
    table: string;
    tableAddRow: string;
    tableAddColumn: string;
    tableDeleteRow: string;
    tableDeleteColumn: string;
    tableDelete: string;
    /** §263. */
    tableBorders: Record<TableBorders, string>;
    /** §271; named by the current state. */
    tableBorderColour: Record<TableBorderColour, string>;
    tableHeaderFill: Record<TableHeaderFill, string>;
    tableValign: string;
    tableHeaderRow: string;
    link: string;
    linkUrl: string;
    linkApply: string;
    linkRemove: string;
    linkCancel: string;
    /** §273; `{count}` placeholder. */
    words: string;
    /** §271. */
    preview: string;
    previewShort: string;
    previewClose: string;
    undo: string;
    redo: string;
    image: string;
    imageUploading: string;
    imageFailed: string;
    /** §414. */
    imageQuality: ImageQualityLabels;
    imageChoose: string;
    imageChosen: ChosenFactsLabels;
    /** `{width}`, `{height}` placeholders (§437). */
    imagePixels: string;
    imageStored: StoredFactsLabels;
    imageAlt: string;
    imageAltHelp: string;
    imageCaption: string;
    imageSize: string;
    imageAlign: string;
    imageAlignBlock: string;
    imageAlignLeft: string;
    imageAlignRight: string;
    imageAlignHelp: string;
    /** §241. */
    imageCrop: string;
    imageCropHelp: string;
    imageCropReset: string;
    imageCropPosition: string;
    /** §454; the upload bar reuses the shapes' names. */
    imageShapes: Omit<ImageCropLabels, "title" | "help" | "reset" | "position">;
    imageUploadShapeHelp: string;
    /** §454; `{shape}` substituted here. */
    imageUploadCropped: string;
    imageRemove: string;
    imageDone: string;
    /** §258. */
    imageClose: string;
    imagePanel: string;
    /** Two strings, not a function: props cross the server boundary. */
    imageNoAltOne: string;
    imageNoAltMany: string;
    imageFromGallery: string;
    /** Not drawn since §361; kept while the catalogue has them. */
    imageShort: string;
    imageFromGalleryShort: string;
    imageGalleryLoading: string;
    imageGalleryEmpty: string;
    imageGalleryClose: string;
    /** §485. */
    imageGalleryFilter: string;
    imageGalleryNoMatch: string;
    imageGallerySourceLegend: string;
    imageGallerySources: Record<Exclude<PictureSource, "here">, string>;
    imageGalleryHere: Record<PickerScopeKind, string>;
    /** `{name}`, `{width}`, `{height}` substituted here (§485). */
    imageFromGalleryPicked: string;
    youtube: string;
    youtubeShort: string;
    youtubeUrl: string;
    youtubeApply: string;
    youtubeInvalid: string;
    youtubeCaption: string;
    youtubeRemove: string;
    /** §403. */
    youtubePoster: string;
    youtubePosterUploading: string;
    youtubePosterFailed: string;
    youtubePosterUseYoutube: string;
    /** §485. */
    youtubePosterFromGallery: string;
    youtubePosterCrop: string;
    youtubePosterCropHelp: string;
    youtubePosterCropReset: string;
    youtubePosterCropWaiting: string;
  };
}) {
  const initialDoc = readRichText(initialBody);
  const [value, setValue] = useState(() => JSON.stringify(initialDoc));
  const [linkDraft, setLinkDraft] = useState<string | null>(null);
  /** `null` while the YouTube panel is closed. */
  const [youtubeDraft, setYoutubeDraft] = useState<string | null>(null);
  const [youtubeInvalid, setYoutubeInvalid] = useState(false);
  const [imageState, setImageState] = useState<"idle" | "uploading" | "failed">("idle");
  const [posterState, setPosterState] = useState<"idle" | "uploading" | "failed">("idle");
  const posterFileInputRef = useRef<HTMLInputElement>(null);
  /**
   * The picture bar (§414) puts the quality choice beside the upload; paste and drop use the same
   * remembered choice. `stored` is what the last upload became.
   */
  const [imageBarOpen, setImageBarOpen] = useState(false);
  const [imageQuality, setImageQuality] = useImageQuality();
  const [stored, setStored] = useState<StoredFacts | null>(null);
  const [storedShape, setStoredShape] = useState<CropPreset>("free");
  /**
   * A new upload's shape (§454), stored as §241's crop. Mirrored in a ref: paste and drop call the
   * `insertImage` Tiptap captured on the first render.
   */
  const [uploadShape, setUploadShapeState] = useState<CropPreset>("free");
  const uploadShapeRef = useRef<CropPreset>("free");
  const setUploadShape = (next: CropPreset) => {
    uploadShapeRef.current = next;
    setUploadShapeState(next);
  };
  /** The file going up, or the last one: its pixels and weight, and what was sent (§437). */
  const [chosen, setChosen] = useState<ChosenFacts | null>(null);
  /** Keyed by address, so another selected film never shows these facts (§414). */
  const [posterStored, setPosterStored] = useState<{ src: string; facts: StoredFacts } | null>(null);
  const [posterChosen, setPosterChosen] = useState<ChosenFacts | null>(null);
  /** The preview's markup, taken once on open (§271); `null` while shut. */
  const [preview, setPreview] = useState<string | null>(null);
  /**
   * Stable across renders: `BubbleMenu` re-registers its plugin on a new prop identity, which
   * dispatches a transaction and re-renders — React error #185, an infinite loop.
   */
  const showOverTable = useCallback(({ editor: current }: { editor: Editor }) => current.isActive("table"), []);
  const [missingAlt, setMissingAlt] = useState(() => countMissingAlt(initialDoc));
  const [words, setWords] = useState(() => countWords(richTextToPlainText(initialDoc)));
  /*
    React's writes to the hidden value fire no event, so each is announced as a bubbling `input`
    for the form's listeners (§350). Not on mount.
  */
  const hiddenValue = useRef<HTMLInputElement>(null);
  const announced = useRef(value);
  useEffect(() => {
    if (announced.current === value) return;
    announced.current = value;
    hiddenValue.current?.dispatchEvent(new Event("input", { bubbles: true }));
  }, [value]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [galleryOpen, setGalleryOpen] = useState(false);
  /** The picture last taken from the gallery, reported like an upload (§485). */
  const [picked, setPicked] = useState<{ name: string; width: number; height: number; shape: CropPreset } | null>(null);
  const [posterGalleryOpen, setPosterGalleryOpen] = useState(false);
  /**
   * A poster's size measured in the browser when the node lacks it (YouTube's thumbnail, pre-§414
   * posters); the crop box needs the ratio, and the master's natural size is exact.
   */
  const [measuredPoster, setMeasuredPoster] = useState<{ src: string; width: number; height: number } | null>(null);
  /**
   * The picture panel closed by hand (§258): a dismissal remembered by node position, since the
   * selection that opens it is Tiptap's and must not be cleared.
   */
  const [dismissedAt, setDismissedAt] = useState<number | null>(null);

  const editor = useEditor({
    // Tiptap needs a DOM; building during SSR would mismatch on hydration.
    immediatelyRender: false,
    extensions: [
      StarterKit.configure({
        /**
         * `AGENTS.md` §11.3's allowlist: StarterKit nodes the server would refuse. Enabling one is
         * a rule change here and in `schema.ts`.
         */
        codeBlock: false,
        code: false,
        strike: false,
        underline: false,
        horizontalRule: false,
        hardBreak: false,
        heading: { levels: [2, 3] },
        link: {
          openOnClick: false,
          protocols: ["http", "https", "mailto"],
        },
      }),
      YoutubeNode,
      BlockAlign,
      // Tables (§196); resized widths are read as proportions (§271).
      TableKit.configure({ table: { resizable: true } }),
      TableStyle,
      /*
        Pictures (§72, §73): blocks only; `parseHTML` is empty so a pasted foreign `<img>` is
        dropped here rather than refused at save. The address comes only from the upload route.
      */
      Image.configure({ inline: false, allowBase64: false }).extend({
        parseHTML() {
          return [];
        },
        addAttributes() {
          return {
            src: { default: null },
            alt: { default: "" },
            caption: {
              default: "",
              renderHTML: (attrs) => (attrs.caption ? { title: attrs.caption } : {}),
            },
            width: { default: null },
            height: { default: null },
            widthPercent: {
              default: 100,
              renderHTML: (attrs) => ({ style: `width: ${attrs.widthPercent ?? 100}%` }),
            },
            /** As the page draws it on a wide screen; `mergeAttributes` merges this `style` with the width's. */
            align: {
              default: "block",
              renderHTML: (attrs) =>
                attrs.align === "left" || attrs.align === "right"
                  ? {
                      style: `float: ${attrs.align}; clear: both; margin-${attrs.align === "left" ? "right" : "left"}: 24px`,
                    }
                  : {},
            },
            /** §241; drawn by the node's `renderHTML` below, not as an attribute. */
            crop: { default: null, renderHTML: () => ({}) },
            /** §454; drawn only by the listing card. */
            focus: { default: null, renderHTML: () => ({}) },
          };
        },
        /**
         * The same crop window `RichText` renders (`image-layout.ts`); without a crop, Tiptap's
         * plain `<img>`. Size and side stay on the window.
         */
        renderHTML({ node, HTMLAttributes }) {
          const merged = mergeAttributes(this.options.HTMLAttributes, HTMLAttributes) as Record<string, string>;
          const crop = cropGeometry(node.attrs.crop as ImageCrop | null, {
            width: node.attrs.width as number | null,
            height: node.attrs.height as number | null,
          });
          if (!crop) return ["img", merged];
          const { style, ...rest } = merged;
          return [
            "div",
            { class: "rt-crop", style: `${style ? `${style};` : ""}${cropWindowCss(crop)}` },
            ["img", { ...rest, style: cropImageCss(crop) }],
          ];
        },
      }),
    ],
    content: initialDoc.content?.length ? initialDoc : EMPTY_DOC,
    // `useEditorState` below re-renders on what the island draws instead.
    shouldRerenderOnTransaction: false,
    onUpdate: ({ editor: current }) => {
      // `getJSON` walks the whole text: read once per update (§371).
      const doc = current.getJSON();
      setValue(JSON.stringify(doc));
      setMissingAlt(countMissingAlt(doc));
      setWords(countWords(current.getText()));
    },
    editorProps: {
      handlePaste: (_view, event) => {
        const file = Array.from(event.clipboardData?.files ?? []).find((f) => f.type.startsWith("image/"));
        if (!file) return false;
        void insertImage(file);
        return true;
      },
      handleDrop: (_view, event) => {
        const file = Array.from(event.dataTransfer?.files ?? []).find((f) => f.type.startsWith("image/"));
        if (!file) return false;
        event.preventDefault();
        void insertImage(file);
        return true;
      },
      attributes: {
        "aria-label": accessibleSuffix ? `${label} — ${accessibleSuffix}` : label,
        role: "textbox",
        "aria-multiline": "true",
        // Distinguishes two editors on one form.
        "data-field": name,
      },
    },
  });

  // Re-render only when `editorLook` changes (§371): focus and blur transactions redrew the toolbar.
  useEditorState({ editor, selector: ({ editor: current }) => editorLook(current?.state), equalityFn: sameEditorLook });

  // A translation fill (§464) goes through the editor, so the hidden value and counts follow.
  useEffect(() => {
    if (!editor) return;
    const onFill = (event: Event) => {
      const detail = (event as CustomEvent<RichTextFillDetail>).detail;
      if (!fillIsFor(detail, name, hiddenValue.current)) return;
      editor.commands.setContent(detail.doc);
    };
    window.addEventListener(RICH_TEXT_FILL_EVENT, onFill);
    return () => window.removeEventListener(RICH_TEXT_FILL_EVENT, onFill);
  }, [editor, name]);

  /** Shrink, upload, insert as an image node; a failure is a sentence, never a lost body. */
  const insertImage = async (file: File) => {
    setImageState("uploading");
    setImageBarOpen(false);
    setStored(null);
    setChosen(null);
    setPicked(null);
    try {
      const uploaded = await uploadPicture(file, setChosen);
      setStored(uploaded.stored ?? null);
      const shape = uploadShapeRef.current;
      const crop = shape === "free" ? null : presetCrop(shape, { width: uploaded.width, height: uploaded.height });
      setStoredShape(crop ? shape : "free");
      // Empty alt, never the file name; the missing-alt nag counts it.
      editor
        ?.chain()
        .focus()
        .setImage({ src: uploaded.src, alt: "", caption: "", width: uploaded.width, height: uploaded.height, widthPercent: 100, align: "block", crop, focus: null } as never)
        .run();
      setImageState("idle");
    } catch {
      setImageState("failed");
    }
  };

  /**
   * Uploads the selected film's poster (§403, §414). `posterSource: "club"` stops
   * `attachYoutubePosters` replacing it; the size feeds the page's `srcset`.
   */
  const pickPoster = async (file: File) => {
    setPosterState("uploading");
    setPosterStored(null);
    setPosterChosen(null);
    try {
      const uploaded = await uploadPicture(file, setPosterChosen);
      editor
        ?.chain()
        .focus()
        // A new poster starts uncropped.
        .updateAttributes("youtube", { poster: uploaded.src, posterSource: "club", posterWidth: uploaded.width, posterHeight: uploaded.height, posterCrop: null })
        .run();
      setPosterStored(uploaded.stored ? { src: uploaded.src, facts: uploaded.stored } : null);
      setPosterState("idle");
    } catch {
      setPosterState("failed");
    }
  };

  /** A gallery picture as the poster (§485), treated exactly like an uploaded one. */
  const pickPosterFromGallery = (picture: StoredPicture) => {
    editor
      ?.chain()
      .focus()
      .updateAttributes("youtube", { poster: picture.src, posterSource: "club", posterWidth: picture.width, posterHeight: picture.height, posterCrop: null })
      .run();
    setPosterStored(null);
    setPosterChosen(null);
    setPosterState("idle");
    setPosterGalleryOpen(false);
  };

  /** The element ProseMirror marks as selected, which the panel anchors to. */
  const selectedImage = editor?.isActive("image")
    ? (editor.view.dom.querySelector("img.ProseMirror-selectednode, .rt-crop.ProseMirror-selectednode") as HTMLElement | null)
    : null;
  // §263, §271. Outside a table `getAttributes` answers `{}`, so these fall back to the defaults.
  const tableBorders: TableBorders =
    (editor?.getAttributes("table").borders as TableBorders | null) ?? "all";
  const tableValign: TableValign =
    (editor?.getAttributes("table").valign as TableValign | null) ?? "top";
  const tableBorderColour: TableBorderColour =
    (editor?.getAttributes("table").borderColour as TableBorderColour | null) ?? "default";
  const tableHeaderFill: TableHeaderFill =
    (editor?.getAttributes("table").headerFill as TableHeaderFill | null) ?? "default";
  const nextBorders = TABLE_BORDERS[(TABLE_BORDERS.indexOf(tableBorders) + 1) % TABLE_BORDERS.length];

  const imageAttrs = selectedImage ? editor?.getAttributes("image") : undefined;
  const imageNodeAt = selectedImage ? (editor?.state.selection.from ?? null) : null;
  const imagePanelOpen = Boolean(selectedImage) && imageNodeAt !== dismissedAt;
  const closeImagePanel = () => setDismissedAt(imageNodeAt);
  const selectedVideo = editor?.isActive("youtube")
    ? (editor.view.dom.querySelector(".rt-youtube.ProseMirror-selectednode") as HTMLElement | null)
    : null;
  const videoAttrs = selectedVideo ? editor?.getAttributes("youtube") : undefined;
  // Without `.focus()`: the panel's own field keeps the caret, and the node stays selected.
  const setImageAttr = (attrs: Record<string, unknown>) => editor?.chain().updateAttributes("image", attrs).run();

  /** A stored picture, inserted exactly as an upload is, in the bar's shape (§73, §454, §485). */
  const insertStored = (picture: StoredPicture) => {
    const shape = uploadShapeRef.current;
    const crop = shape === "free" ? null : presetCrop(shape, { width: picture.width, height: picture.height });
    editor
      ?.chain()
      .focus()
      .setImage({ src: picture.src, alt: "", caption: "", width: picture.width, height: picture.height, widthPercent: 100, align: "block", crop, focus: null } as never)
      .run();
    setStored(null);
    setChosen(null);
    setImageState("idle");
    setPicked({ name: picture.name, width: picture.width, height: picture.height, shape: crop ? shape : "free" });
    setGalleryOpen(false);
  };

  // Measured once per address when the node lacks a size (§485).
  const selectedPosterSrc = typeof videoAttrs?.poster === "string" && videoAttrs.poster ? videoAttrs.poster : null;
  const selectedPosterSized = typeof videoAttrs?.posterWidth === "number" && typeof videoAttrs?.posterHeight === "number";
  useEffect(() => {
    if (!selectedPosterSrc || selectedPosterSized || measuredPoster?.src === selectedPosterSrc) return;
    let cancelled = false;
    const probe = new window.Image();
    probe.onload = () => {
      if (!cancelled && probe.naturalWidth > 0 && probe.naturalHeight > 0) {
        setMeasuredPoster({ src: selectedPosterSrc, width: probe.naturalWidth, height: probe.naturalHeight });
      }
    };
    probe.src = selectedPosterSrc;
    return () => {
      cancelled = true;
    };
  }, [selectedPosterSrc, selectedPosterSized, measuredPoster?.src]);
  const posterIntrinsic =
    selectedPosterSrc && selectedPosterSized
      ? { width: Number(videoAttrs?.posterWidth), height: Number(videoAttrs?.posterHeight) }
      : selectedPosterSrc && measuredPoster?.src === selectedPosterSrc
        ? { width: measuredPoster.width, height: measuredPoster.height }
        : null;

  /** Only the id is kept (§110). */
  const applyYoutube = () => {
    const id = youtubeVideoId((youtubeDraft ?? "").trim());
    if (!id) {
      setYoutubeInvalid(true);
      return;
    }
    editor?.chain().focus().insertContent({ type: "youtube", attrs: { videoId: id, caption: "" } }).run();
    setYoutubeDraft(null);
  };

  /**
   * One `command`, not a chain: a chain stops at the first false step (no heading to update), and
   * a mixed selection would be half aligned. `left` is stored as absence (`null`).
   */
  const setAlign = (align: BlockAlignment) =>
    editor
      ?.chain()
      .focus()
      .command(({ commands }) => {
        const value = align === "left" ? null : align;
        for (const type of ALIGNABLE) commands.updateAttributes(type, { align: value });
        return true;
      })
      .run();

  const applyLink = () => {
    const href = (linkDraft ?? "").trim();
    if (href === "") {
      editor?.chain().focus().unsetLink().run();
    } else {
      editor?.chain().focus().extendMarkRange("link").setLink({ href }).run();
    }
    setLinkDraft(null);
  };

  return (
    <Box data-rich-text={name}>
      <Typography component="span" variant="body2" color="text.secondary" sx={{ display: "block", mb: 0.5 }}>
        {label}
      </Typography>

      {/*
        The preview (§271): the page's rules without the editing aids. The HTML is this browser's
        own editor state, never fetched or stored; saves still pass the server's allowlist.
      */}
      <Dialog open={preview !== null} onClose={() => setPreview(null)} fullWidth maxWidth="md" scroll="paper">
        <DialogTitle>{labels.preview}</DialogTitle>
        <DialogContent dividers>
          <Box sx={PREVIEW_CONTENT_SX} dangerouslySetInnerHTML={{ __html: preview ?? "" }} />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setPreview(null)} startIcon={<CloseIcon fontSize="small" />} sx={{ minHeight: 44 }}>
            {labels.previewClose}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Correct even before the editor has loaded. */}
      <input ref={hiddenValue} type="hidden" name={name} value={value} readOnly />

      <Box sx={{ border: 1, borderColor: "divider", borderRadius: 1 }}>
        <Stack
          direction="row"
          spacing={0.5}
          role="toolbar"
          aria-label={accessibleSuffix ? `${label} — ${accessibleSuffix}` : label}
          // Sticky (§273), with its own background so text does not show through.
          sx={{
            flexWrap: "wrap",
            gap: 0.5,
            p: 0.5,
            borderBottom: 1,
            borderColor: "divider",
            position: "sticky",
            top: 0,
            zIndex: 2,
            backgroundColor: "background.paper",
            borderTopLeftRadius: "inherit",
            borderTopRightRadius: "inherit",
          }}
        >
          <ToolbarButton
            label={labels.bold}
            icon={FormatBoldIcon}
            active={editor?.isActive("bold") ?? false}
            onClick={() => editor?.chain().focus().toggleBold().run()}
          />
          <ToolbarButton
            label={labels.italic}
            icon={FormatItalicIcon}
            active={editor?.isActive("italic") ?? false}
            onClick={() => editor?.chain().focus().toggleItalic().run()}
          />
          <ToolbarButton
            label={labels.heading2}
            text="H2"
            active={editor?.isActive("heading", { level: 2 }) ?? false}
            onClick={() => editor?.chain().focus().toggleHeading({ level: 2 }).run()}
          />
          <ToolbarButton
            label={labels.heading3}
            text="H3"
            active={editor?.isActive("heading", { level: 3 }) ?? false}
            onClick={() => editor?.chain().focus().toggleHeading({ level: 3 }).run()}
          />
          <ToolbarButton
            label={labels.bulletList}
            icon={FormatListBulletedIcon}
            active={editor?.isActive("bulletList") ?? false}
            onClick={() => editor?.chain().focus().toggleBulletList().run()}
          />
          <ToolbarButton
            label={labels.orderedList}
            icon={FormatListNumberedIcon}
            active={editor?.isActive("orderedList") ?? false}
            onClick={() => editor?.chain().focus().toggleOrderedList().run()}
          />
          <ToolbarButton
            label={labels.quote}
            icon={FormatQuoteIcon}
            active={editor?.isActive("blockquote") ?? false}
            onClick={() => editor?.chain().focus().toggleBlockquote().run()}
          />
          {BLOCK_ALIGNMENTS.map((align) => (
            <ToolbarButton
              key={align}
              label={labels.align[align]}
              icon={ALIGN_ICON[align]}
              active={align === "left" ? !editor?.isActive({ align: "center" }) && !editor?.isActive({ align: "right" }) : (editor?.isActive({ align }) ?? false)}
              onClick={() => setAlign(align)}
            />
          ))}
          {/* The other table verbs are on the bar over the table (§196, §274). */}
          {features.tables !== false && (
          <ToolbarButton
            label={labels.table}
            icon={TableChartIcon}
            active={editor?.isActive("table") ?? false}
            onClick={() =>
              editor?.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()
            }
          />
          )}
          <ToolbarButton
            label={labels.link}
            icon={LinkIcon}
            active={editor?.isActive("link") ?? false}
            onClick={() =>
              setLinkDraft((open) =>
                open === null ? (editor?.getAttributes("link").href ?? "") : null,
              )
            }
          />
          {/* The play mark, not YouTube's logo: brand glyphs were refused (§90). */}
          {features.media !== false && (
          <>
          <ToolbarButton
            label={imageState === "uploading" ? labels.imageUploading : labels.image}
            icon={AddPhotoAlternateIcon}
            active={imageBarOpen}
            onClick={() => setImageBarOpen((open) => !open)}
          />
          <input
            ref={fileInputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            hidden
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = "";
              if (file) void insertImage(file);
            }}
          />
          <ToolbarButton
            label={labels.imageFromGallery}
            icon={PhotoLibraryIcon}
            active={galleryOpen}
            onClick={() => setGalleryOpen((open) => !open)}
          />
          {/* A newsletter takes pictures and no film (§550): an inbox plays nothing (§270). */}
          {features.video !== false && (
          <ToolbarButton
            label={labels.youtube}
            icon={SmartDisplayIcon}
            active={youtubeDraft !== null || (editor?.isActive("youtube") ?? false)}
            onClick={() => {
              setYoutubeInvalid(false);
              setYoutubeDraft((open) => (open === null ? "" : null));
            }}
          />
          )}
          </>
          )}
          <ToolbarButton
            label={labels.undo}
            icon={UndoIcon}
            active={false}
            onClick={() => editor?.chain().focus().undo().run()}
          />
          <ToolbarButton
            label={labels.redo}
            icon={RedoIcon}
            active={false}
            onClick={() => editor?.chain().focus().redo().run()}
          />
          <ToolbarButton
            label={labels.preview}
            icon={VisibilityIcon}
            active={preview !== null}
            onClick={() => setPreview(editor?.getHTML() ?? "")}
          />
        </Stack>

        {youtubeDraft !== null && (
          <Stack
            direction="row"
            spacing={1}
            sx={{ p: 1, borderBottom: 1, borderColor: "divider", flexWrap: "wrap", gap: 1 }}
            data-testid="rich-text-youtube"
          >
            <TextField
              size="small"
              label={labels.youtubeUrl}
              value={youtubeDraft}
              autoFocus
              error={youtubeInvalid}
              helperText={youtubeInvalid ? labels.youtubeInvalid : undefined}
              onChange={(event) => {
                setYoutubeDraft(event.target.value);
                setYoutubeInvalid(false);
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  applyYoutube();
                }
                if (event.key === "Escape") setYoutubeDraft(null);
              }}
              sx={{ flexGrow: 1, minWidth: 240 }}
            />
            <Button onClick={applyYoutube} startIcon={<CheckIcon fontSize="small" />}>
              {labels.youtubeApply}
            </Button>
            <Button color="inherit" onClick={() => setYoutubeDraft(null)} startIcon={<CloseIcon fontSize="small" />}>
              {labels.linkCancel}
            </Button>
          </Stack>
        )}

        {imageBarOpen && (
          <Stack
            direction="row"
            sx={{ p: 1, borderBottom: 1, borderColor: "divider", flexWrap: "wrap", alignItems: "center", columnGap: 2, rowGap: 1 }}
            data-testid="rich-text-image-bar"
          >
            <ImageQualityChoice value={imageQuality} onChange={setImageQuality} labels={labels.imageQuality} />
            <UploadShapeChoice
              value={uploadShape}
              onChange={setUploadShape}
              labels={{ presets: labels.imageShapes.presets, preset: labels.imageShapes.preset, help: labels.imageUploadShapeHelp }}
              testId="rich-text-upload-shape"
            />
            <Stack direction="row" spacing={1}>
              <Button variant="contained" onClick={() => fileInputRef.current?.click()} startIcon={<UploadIcon fontSize="small" />} sx={{ minHeight: 44 }}>
                {labels.imageChoose}
              </Button>
              <Button color="inherit" onClick={() => setImageBarOpen(false)} startIcon={<CloseIcon fontSize="small" />} sx={{ minHeight: 44 }}>
                {labels.linkCancel}
              </Button>
            </Stack>
          </Stack>
        )}

        {chosen && (
          <Typography variant="body2" color="text.secondary" sx={{ px: 1, pt: 0.5 }} aria-live="polite" data-testid="rich-text-image-chosen">
            {describeChosenImage(chosen, labels.imageChosen, document.documentElement.lang || "ro")}
          </Typography>
        )}
        {imageState !== "idle" && (
          <Typography variant="body2" color={imageState === "failed" ? "error" : "text.secondary"} sx={{ px: 1, py: 0.5 }}>
            {imageState === "failed" ? labels.imageFailed : labels.imageUploading}
          </Typography>
        )}
        {imageState === "idle" && stored && (
          <Typography variant="body2" color="text.secondary" sx={{ px: 1, py: 0.5 }} aria-live="polite" data-testid="rich-text-image-stored">
            {describeStoredImage(stored, labels.imageStored, document.documentElement.lang || "ro")}
            {storedShape !== "free" && ` · ${labels.imageUploadCropped.replace("{shape}", labels.imageShapes.preset[storedShape])}`}
          </Typography>
        )}

        {imageState === "idle" && picked && (
          <Typography variant="body2" color="text.secondary" sx={{ px: 1, py: 0.5 }} aria-live="polite" data-testid="rich-text-image-picked">
            {labels.imageFromGalleryPicked
              .replace("{name}", picked.name)
              .replace("{width}", String(picked.width))
              .replace("{height}", String(picked.height))}
            {picked.shape !== "free" && ` · ${labels.imageUploadCropped.replace("{shape}", labels.imageShapes.preset[picked.shape])}`}
          </Typography>
        )}

        {/* No automatic film posters here: a picture must be an uploaded one (§72, §485). */}
        {galleryOpen && (
          <Box data-testid="rich-text-gallery">
            <Box sx={{ px: 1, pt: 1 }}>
              <UploadShapeChoice
                value={uploadShape}
                onChange={setUploadShape}
                labels={{ presets: labels.imageShapes.presets, preset: labels.imageShapes.preset, help: labels.imageUploadShapeHelp }}
                testId="rich-text-gallery-shape"
              />
            </Box>
            <GalleryPicker
              onPick={insertStored}
              onClose={() => setGalleryOpen(false)}
              labels={{
                loading: labels.imageGalleryLoading,
                empty: labels.imageGalleryEmpty,
                close: labels.imageGalleryClose,
                filter: labels.imageGalleryFilter,
                noMatch: labels.imageGalleryNoMatch,
                sourceLegend: labels.imageGallerySourceLegend,
                sources: labels.imageGallerySources,
                here: pictureScope ? labels.imageGalleryHere[pictureScope.kind] : undefined,
              }}
              scope={pictureScope}
              testId="rich-text-gallery-list"
            />
          </Box>
        )}

        {linkDraft !== null && (
          <Stack
            direction="row"
            spacing={1}
            sx={{ p: 1, borderBottom: 1, borderColor: "divider", flexWrap: "wrap", gap: 1 }}
          >
            <TextField
              size="small"
              label={labels.linkUrl}
              value={linkDraft}
              autoFocus
              onChange={(event) => setLinkDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  // Enter must not submit the surrounding form.
                  event.preventDefault();
                  applyLink();
                }
                if (event.key === "Escape") setLinkDraft(null);
              }}
              sx={{ flexGrow: 1, minWidth: 200 }}
            />
            <Button onClick={applyLink} startIcon={<CheckIcon fontSize="small" />}>
              {labels.linkApply}
            </Button>
            <Button
              color="inherit"
              startIcon={<LinkOffIcon fontSize="small" />}
              onClick={() => {
                editor?.chain().focus().extendMarkRange("link").unsetLink().run();
                setLinkDraft(null);
              }}
            >
              {labels.linkRemove}
            </Button>
            <Button color="inherit" onClick={() => setLinkDraft(null)} startIcon={<CloseIcon fontSize="small" />}>
              {labels.linkCancel}
            </Button>
          </Stack>
        )}

        <Box
          sx={{
            "& .tiptap": {
              ...WRITING_AREA_BOX,
              outline: "none",
              "&:focus-visible": { outline: 2, outlineColor: "primary.main", outlineOffset: -2 },
              // Contains a trailing float.
              "&::after": { content: '""', display: "table", clear: "both" },
            },
            // Dashed edges show where each picture ends (§274); an `outline`, so it costs no layout.
            "& .tiptap img": {
              display: "block",
              maxWidth: "100%",
              height: "auto",
              mx: "auto",
              my: 2,
              borderRadius: 1,
              cursor: "pointer",
              outline: (theme: { palette: { divider: string } }) => `1px dashed ${theme.palette.divider}`,
              outlineOffset: 2,
            },
            "& .tiptap img.ProseMirror-selectednode": {
              outline: 3,
              outlineColor: "primary.main",
              outlineOffset: 2,
            },
            // A cropped picture's window (§241) takes the margins and the selection outline.
            "& .tiptap .rt-crop": {
              mx: "auto",
              my: 2,
              cursor: "pointer",
              borderRadius: 1,
              outline: (theme: { palette: { divider: string } }) => `1px dashed ${theme.palette.divider}`,
              outlineOffset: 2,
            },
            "& .tiptap .rt-crop.ProseMirror-selectednode": {
              outline: 3,
              outlineColor: "primary.main",
              outlineOffset: 2,
            },
            "& .tiptap p": { my: 1 },
            "& .tiptap h2": { fontSize: "1.25rem", mt: 3, mb: 1 },
            "& .tiptap h3": { fontSize: "1.0625rem", mt: 2, mb: 1 },
            "& .tiptap blockquote": {
              borderLeft: 3,
              borderColor: "divider",
              pl: 2,
              ml: 0,
              fontStyle: "italic",
            },
            "& .tiptap ul, & .tiptap ol": { pl: 3 },
            // Tables drawn exactly as the page draws them (§263).
            ...EDITOR_TABLE_SX,
          }}
        >
          {/* The table's verbs, over the table while the caret is inside one (§274). */}
          {editor && features.tables !== false && (
            <BubbleMenu
              editor={editor}
              pluginKey="tableVerbs"
              shouldShow={showOverTable}
              options={TABLE_BAR_OPTIONS}
            >
              <Paper
                elevation={3}
                data-floating-bar="table"
                sx={{ ...FLOATING_BAR_SX, display: "flex", flexWrap: "wrap", gap: 0.5, p: 0.5, maxWidth: 360 }}
              >
              <ToolbarButton
                label={labels.tableAddRow}
                icon={TableRowsIcon}
                mark="add"
                active={false}
                onClick={() => editor?.chain().focus().addRowAfter().run()}
              />
              <ToolbarButton
                label={labels.tableAddColumn}
                icon={ViewColumnIcon}
                mark="add"
                active={false}
                onClick={() => editor?.chain().focus().addColumnAfter().run()}
              />
              <ToolbarButton
                label={labels.tableDeleteRow}
                icon={TableRowsIcon}
                mark="remove"
                active={false}
                onClick={() => editor?.chain().focus().deleteRow().run()}
              />
              <ToolbarButton
                label={labels.tableDeleteColumn}
                icon={ViewColumnIcon}
                mark="remove"
                active={false}
                onClick={() => editor?.chain().focus().deleteColumn().run()}
              />
              {/* Cycles all → rows → none, showing the current state (§263). */}
              <ToolbarButton
                label={labels.tableBorders[tableBorders]}
                icon={TABLE_BORDER_ICON[tableBorders]}
                active={tableBorders !== "all"}
                onClick={() =>
                  editor
                    ?.chain()
                    .focus()
                    .updateAttributes("table", {
                      borders: nextBorders === "all" ? null : nextBorders,
                    })
                    .run()
                }
              />
              {/* Horizontal centring is the paragraph's own alignment. */}
              <ToolbarButton
                label={labels.tableValign}
                icon={VerticalAlignCenterIcon}
                active={tableValign === "middle"}
                onClick={() =>
                  editor
                    ?.chain()
                    .focus()
                    .updateAttributes("table", { valign: tableValign === "middle" ? null : "middle" })
                    .run()
                }
              />
              {/* Each cycles its closed set, named after the current state (§271). */}
              <ToolbarButton
                label={labels.tableBorderColour[tableBorderColour]}
                icon={BorderColorIcon}
                active={tableBorderColour !== "default"}
                onClick={() => {
                  const next = TABLE_BORDER_COLOURS[(TABLE_BORDER_COLOURS.indexOf(tableBorderColour) + 1) % TABLE_BORDER_COLOURS.length];
                  editor?.chain().focus().updateAttributes("table", { borderColour: next === "default" ? null : next }).run();
                }}
              />
              <ToolbarButton
                label={labels.tableHeaderFill[tableHeaderFill]}
                icon={FormatColorFillIcon}
                active={tableHeaderFill !== "default"}
                onClick={() => {
                  const next = TABLE_HEADER_FILLS[(TABLE_HEADER_FILLS.indexOf(tableHeaderFill) + 1) % TABLE_HEADER_FILLS.length];
                  editor?.chain().focus().updateAttributes("table", { headerFill: next === "default" ? null : next }).run();
                }}
              />
              <ToolbarButton
                label={labels.tableHeaderRow}
                icon={WebAssetIcon}
                active={editor?.isActive("tableHeader") ?? false}
                onClick={() => editor?.chain().focus().toggleHeaderRow().run()}
              />
              <ToolbarButton
                label={labels.tableDelete}
                icon={DeleteIcon}
                active={false}
                onClick={() => editor?.chain().focus().deleteTable().run()}
              />

              </Paper>
            </BubbleMenu>
          )}

          {/* The selection bar (§273): inline verbs only; structure stays in the toolbar. */}
          {editor && (
            <BubbleMenu editor={editor}>
              <Paper elevation={3} data-floating-bar="selection" sx={{ ...FLOATING_BAR_SX, display: "flex", gap: 0.5, p: 0.5 }}>
                <ToolbarButton
                  label={labels.bold}
                  icon={FormatBoldIcon}
                  active={editor.isActive("bold")}
                  onClick={() => editor.chain().focus().toggleBold().run()}
                />
                <ToolbarButton
                  label={labels.italic}
                  icon={FormatItalicIcon}
                  active={editor.isActive("italic")}
                  onClick={() => editor.chain().focus().toggleItalic().run()}
                />
                <ToolbarButton
                  label={labels.link}
                  icon={LinkIcon}
                  active={editor.isActive("link")}
                  onClick={() =>
                    setLinkDraft((open) => (open === null ? (editor.getAttributes("link").href ?? "") : null))
                  }
                />
              </Paper>
            </BubbleMenu>
          )}
          {!editor && <Box aria-hidden sx={WRITING_AREA_BOX} data-testid="rich-text-reserved" />}
          <EditorContent editor={editor} />
        </Box>
      </Box>

      <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 0.5 }} data-testid="rich-text-words">
        {labels.words.replace("{count}", String(words))}
      </Typography>

      {/* A notice, not a block: a picture without alt text still publishes. */}
      {missingAlt > 0 && (
        <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }} data-testid="rich-text-missing-alt">
          {missingAlt === 1 ? labels.imageNoAltOne : labels.imageNoAltMany.replace("{count}", String(missingAlt))}
        </Typography>
      )}

      <Popper
        open={imagePanelOpen}
        anchorEl={selectedImage}
        placement="bottom-start"
        // Kept inside the writing area's clipping box, not the viewport, so it never covers the page chrome (§258).
        modifiers={[
          { name: "offset", options: { offset: [0, 8] } },
          { name: "flip", options: { padding: 8 } },
          { name: "preventOverflow", options: { altAxis: true, padding: 8, boundary: "clippingParents" } },
        ]}
        sx={{ zIndex: (theme) => theme.zIndex.modal }}
      >
        <Paper
          elevation={6}
          sx={{ p: 1.5, width: 320, maxWidth: "calc(100vw - 32px)", maxHeight: "calc(100vh - 32px)", overflowY: "auto" }}
          data-testid="rich-text-image-panel"
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.stopPropagation();
              closeImagePanel();
            }
          }}
        >
          <Stack spacing={1.5}>
            <Stack direction="row" sx={{ alignItems: "center", justifyContent: "space-between" }}>
              <Typography variant="body2" sx={{ fontWeight: 600 }}>
                {labels.imagePanel}
              </Typography>
              <Tooltip title={labels.imageClose}>
                <Button size="small" color="inherit" onClick={closeImagePanel} aria-label={labels.imageClose} sx={{ minWidth: 44 }}>
                  <CloseIcon aria-hidden fontSize="small" />
                </Button>
              </Tooltip>
            </Stack>
            {/* The stored size, not the drawn one (§437). */}
            {typeof imageAttrs?.width === "number" && typeof imageAttrs?.height === "number" && (
              <Typography variant="body2" color="text.secondary" data-testid="rich-text-image-pixels">
                {labels.imagePixels.replace("{width}", String(imageAttrs.width)).replace("{height}", String(imageAttrs.height))}
              </Typography>
            )}
            <TextField
              size="small"
              label={labels.imageAlt}
              helperText={labels.imageAltHelp}
              value={String(imageAttrs?.alt ?? "")}
              autoFocus
              onChange={(event) => setImageAttr({ alt: event.target.value })}
              onKeyDown={(event) => {
                if (event.key === "Enter") event.preventDefault();
              }}
              slotProps={{ htmlInput: { maxLength: 300 } }}
            />
            <TextField
              size="small"
              label={labels.imageCaption}
              value={String(imageAttrs?.caption ?? "")}
              onChange={(event) => setImageAttr({ caption: event.target.value })}
              onKeyDown={(event) => {
                if (event.key === "Enter") event.preventDefault();
              }}
              slotProps={{ htmlInput: { maxLength: 500 } }}
            />
            <Box>
              <Typography component="span" variant="body2" color="text.secondary" sx={{ display: "block", mb: 0.5 }}>
                {labels.imageSize}
              </Typography>
              <ToggleButtonGroup
                exclusive
                size="small"
                value={Number(imageAttrs?.widthPercent ?? 100)}
                onChange={(_event, percent: number | null) => {
                  if (percent !== null) setImageAttr({ widthPercent: percent });
                }}
                aria-label={labels.imageSize}
              >
                {IMAGE_WIDTH_PERCENTS.map((percent) => (
                  <ToggleButton key={percent} value={percent} sx={{ minWidth: 56, minHeight: 40 }}>
                    {percent}%
                  </ToggleButton>
                ))}
              </ToggleButtonGroup>
            </Box>
            <Box>
              <Typography component="span" variant="body2" color="text.secondary" sx={{ display: "block", mb: 0.5 }}>
                {labels.imageAlign}
              </Typography>
              <ToggleButtonGroup
                exclusive
                size="small"
                value={String(imageAttrs?.align ?? "block")}
                onChange={(_event, align: string | null) => {
                  if (align === null) return;
                  // A full-width float leaves no column to write in: choosing a side halves it.
                  const widthPercent =
                    align !== "block" && Number(imageAttrs?.widthPercent ?? 100) === 100
                      ? 50
                      : undefined;
                  setImageAttr(widthPercent ? { align, widthPercent } : { align });
                }}
                aria-label={labels.imageAlign}
              >
                {IMAGE_ALIGNMENTS.map((align) => {
                  const PlacementIcon = PLACEMENT_ICON[align];
                  return (
                    <ToggleButton key={align} value={align} sx={{ minWidth: 56, minHeight: 40, gap: 0.5 }}>
                      <PlacementIcon aria-hidden fontSize="small" />
                      {align === "block" ? labels.imageAlignBlock : align === "left" ? labels.imageAlignLeft : labels.imageAlignRight}
                    </ToggleButton>
                  );
                })}
              </ToggleButtonGroup>
              <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 0.5 }}>
                {labels.imageAlignHelp}
              </Typography>
            </Box>
            {/* Only with a stored size: without it the page cannot shape the window (§241). */}
            {typeof imageAttrs?.width === "number" && typeof imageAttrs?.height === "number" && (
              <ImageCropBox
                // One box per picture, so the held shape is never the last picture's.
                key={`${String(imageAttrs.src ?? "")}@${imageNodeAt ?? ""}`}
                src={String(imageAttrs.src ?? "")}
                intrinsic={{ width: imageAttrs.width, height: imageAttrs.height }}
                crop={(imageAttrs.crop as ImageCrop | null) ?? null}
                onChange={(crop) => setImageAttr({ crop })}
                focus={(imageAttrs.focus as ImageFocus | null) ?? null}
                onFocusChange={(focus) => setImageAttr({ focus })}
                card={cardPictures}
                labels={{
                  title: labels.imageCrop,
                  help: labels.imageCropHelp,
                  reset: labels.imageCropReset,
                  position: labels.imageCropPosition,
                  ...labels.imageShapes,
                }}
              />
            )}
            <Stack direction="row" spacing={1} sx={{ justifyContent: "space-between" }}>
              <Button color="error" size="small" startIcon={<DeleteIcon fontSize="small" />} onClick={() => editor?.chain().focus().deleteSelection().run()}>
                {labels.imageRemove}
              </Button>
              <Button
                size="small"
                startIcon={<CheckIcon fontSize="small" />}
                onClick={() => {
                  const to = editor?.state.selection.to ?? 0;
                  editor?.chain().focus().setTextSelection(to).run();
                }}
              >
                {labels.imageDone}
              </Button>
            </Stack>
          </Stack>
        </Paper>
      </Popper>

      {/* The film's panel (§110, §266). */}
      <Popper
        open={Boolean(selectedVideo)}
        anchorEl={selectedVideo}
        placement="bottom-start"
        modifiers={[{ name: "preventOverflow", options: { altAxis: true, padding: 8 } }]}
        sx={{ zIndex: (theme) => theme.zIndex.modal }}
      >
        <Paper elevation={6} sx={{ p: 1.5, width: 320, maxWidth: "calc(100vw - 32px)" }} data-testid="rich-text-youtube-panel">
          <Stack spacing={1.5}>
            <TextField
              size="small"
              label={labels.youtubeCaption}
              value={String(videoAttrs?.caption ?? "")}
              autoFocus
              onChange={(event) => editor?.chain().updateAttributes("youtube", { caption: event.target.value }).run()}
              onKeyDown={(event) => {
                if (event.key === "Enter") event.preventDefault();
              }}
              slotProps={{ htmlInput: { maxLength: 500 } }}
            />
            <Box>
              <Typography component="span" variant="body2" color="text.secondary" sx={{ display: "block", mb: 0.5 }}>
                {labels.imageSize}
              </Typography>
              <ToggleButtonGroup
                exclusive
                size="small"
                value={Number(videoAttrs?.widthPercent ?? 100)}
                onChange={(_event, percent: number | null) => {
                  if (percent !== null) editor?.chain().focus().updateAttributes("youtube", { widthPercent: percent }).run();
                }}
                aria-label={labels.imageSize}
              >
                {IMAGE_WIDTH_PERCENTS.map((percent) => (
                  <ToggleButton key={percent} value={percent} sx={{ minWidth: 56, minHeight: 40 }}>
                    {percent}%
                  </ToggleButton>
                ))}
              </ToggleButtonGroup>
            </Box>
            <Box>
              <Typography component="span" variant="body2" color="text.secondary" sx={{ display: "block", mb: 0.5 }}>
                {labels.imageAlign}
              </Typography>
              <ToggleButtonGroup
                exclusive
                size="small"
                value={String(videoAttrs?.align ?? "block")}
                onChange={(_event, align: string | null) => {
                  if (align === null) return;
                  // The picture's rule: choosing a side halves a full-width film.
                  const widthPercent =
                    align !== "block" && Number(videoAttrs?.widthPercent ?? 100) === 100 ? 50 : undefined;
                  editor
                    ?.chain()
                    .focus()
                    .updateAttributes("youtube", widthPercent ? { align, widthPercent } : { align })
                    .run();
                }}
                aria-label={labels.imageAlign}
              >
                {IMAGE_ALIGNMENTS.map((align) => {
                  const PlacementIcon = PLACEMENT_ICON[align];
                  return (
                    <ToggleButton key={align} value={align} sx={{ minWidth: 56, minHeight: 40, gap: 0.5 }}>
                      <PlacementIcon aria-hidden fontSize="small" />
                      {align === "block" ? labels.imageAlignBlock : align === "left" ? labels.imageAlignLeft : labels.imageAlignRight}
                    </ToggleButton>
                  );
                })}
              </ToggleButtonGroup>
            </Box>
            {/*
              The club's poster (§403, §414). "Use YouTube's" clears `posterSource`, so
              `attachYoutubePosters` fetches YouTube's thumbnail again on the next save.
            */}
            <ImageQualityChoice
              value={imageQuality}
              onChange={setImageQuality}
              labels={labels.imageQuality}
              disabled={posterState === "uploading"}
            />
            <Stack direction="row" sx={{ alignItems: "center", flexWrap: "wrap", gap: 1 }}>
              <Button
                size="small"
                startIcon={<UploadIcon fontSize="small" />}
                onClick={() => posterFileInputRef.current?.click()}
                disabled={posterState === "uploading"}
                sx={{ minHeight: 44 }}
              >
                {posterState === "uploading" ? labels.youtubePosterUploading : labels.youtubePoster}
              </Button>
              <Button
                size="small"
                startIcon={<PhotoLibraryIcon fontSize="small" />}
                onClick={() => setPosterGalleryOpen((open) => !open)}
                disabled={posterState === "uploading"}
                aria-expanded={posterGalleryOpen}
                sx={{ minHeight: 44 }}
              >
                {labels.youtubePosterFromGallery}
              </Button>
              {videoAttrs?.posterSource === "club" ? (
                <Button
                  size="small"
                  color="inherit"
                  startIcon={<YouTubeIcon fontSize="small" />}
                  onClick={() => {
                    editor
                      ?.chain()
                      .focus()
                      .updateAttributes("youtube", { poster: null, posterSource: null, posterWidth: null, posterHeight: null, posterCrop: null })
                      .run();
                  }}
                  sx={{ minHeight: 44 }}
                >
                  {labels.youtubePosterUseYoutube}
                </Button>
              ) : null}
            </Stack>
            {posterGalleryOpen && (
              <GalleryPicker
                onPick={pickPosterFromGallery}
                onClose={() => setPosterGalleryOpen(false)}
                // Automatic film posters included.
                withPosters
                labels={{
                  loading: labels.imageGalleryLoading,
                  empty: labels.imageGalleryEmpty,
                  close: labels.imageGalleryClose,
                  filter: labels.imageGalleryFilter,
                  noMatch: labels.imageGalleryNoMatch,
                  sourceLegend: labels.imageGallerySourceLegend,
                  sources: labels.imageGallerySources,
                  here: pictureScope ? labels.imageGalleryHere[pictureScope.kind] : undefined,
                }}
                scope={pictureScope}
                testId="rich-text-poster-gallery"
              />
            )}
            {/*
              The poster's crop (§485), 16∶9 first; other shapes show their largest 16∶9 part
              (`cardFrameGeometry`). Uncropped, the box shows the middle.
            */}
            {selectedPosterSrc && posterIntrinsic ? (
              <ImageCropBox
                key={`${selectedPosterSrc}@${posterIntrinsic.width}x${posterIntrinsic.height}`}
                src={selectedPosterSrc}
                intrinsic={posterIntrinsic}
                crop={(videoAttrs?.posterCrop as ImageCrop | null | undefined) ?? presetCrop("16:9", posterIntrinsic)}
                onChange={(crop) =>
                  editor
                    ?.chain()
                    .updateAttributes("youtube", { posterCrop: crop, posterWidth: posterIntrinsic.width, posterHeight: posterIntrinsic.height })
                    .run()
                }
                resting="16:9"
                testId="rich-text-poster-crop"
                labels={{
                  title: labels.youtubePosterCrop,
                  help: labels.youtubePosterCropHelp,
                  reset: labels.youtubePosterCropReset,
                  position: labels.imageCropPosition,
                  ...labels.imageShapes,
                }}
              />
            ) : !selectedPosterSrc ? (
              <Typography variant="caption" color="text.secondary" data-testid="rich-text-poster-crop-waiting">
                {labels.youtubePosterCropWaiting}
              </Typography>
            ) : null}
            {posterChosen && (posterState !== "idle" || (posterStored && videoAttrs?.poster === posterStored.src)) && (
              <Typography variant="body2" color="text.secondary" aria-live="polite" data-testid="rich-text-poster-chosen">
                {describeChosenImage(posterChosen, labels.imageChosen, document.documentElement.lang || "ro")}
              </Typography>
            )}
            {posterState === "failed" && (
              <Typography variant="body2" color="error">
                {labels.youtubePosterFailed}
              </Typography>
            )}
            {posterState === "idle" && posterStored && videoAttrs?.poster === posterStored.src && (
              <Typography variant="body2" color="text.secondary" aria-live="polite" data-testid="rich-text-poster-stored">
                {describeStoredImage(posterStored.facts, labels.imageStored, document.documentElement.lang || "ro")}
              </Typography>
            )}
            <input
              ref={posterFileInputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              hidden
              onChange={(event) => {
                const file = event.target.files?.[0];
                event.target.value = "";
                if (file) void pickPoster(file);
              }}
            />
            <Stack direction="row" spacing={1} sx={{ justifyContent: "space-between" }}>
              <Button color="error" size="small" startIcon={<DeleteIcon fontSize="small" />} onClick={() => editor?.chain().focus().deleteSelection().run()}>
                {labels.youtubeRemove}
              </Button>
              <Button
                size="small"
                startIcon={<CheckIcon fontSize="small" />}
                onClick={() => {
                  const to = editor?.state.selection.to ?? 0;
                  editor?.chain().focus().setTextSelection(to).run();
                }}
              >
                {labels.imageDone}
              </Button>
            </Stack>
          </Stack>
        </Paper>
      </Popper>
    </Box>
  );
}

/**
 * A table's borders, vertical alignment and colours (§263, §271) as global attributes on
 * `table`. Defaults emit nothing, so unstyled tables keep byte-identical JSON; choices reach the
 * DOM as the `data-*` attributes `table-layout.ts` keys on. `parseHTML` accepts only the closed
 * sets, so a copy or undo cannot produce a value the server refuses.
 */
const TableStyle = Extension.create({
  name: "tableStyle",
  addGlobalAttributes() {
    return [
      {
        types: ["table"],
        attributes: {
          borders: {
            default: null,
            renderHTML: (attrs: Record<string, unknown>) =>
              attrs.borders === "rows" || attrs.borders === "none"
                ? { "data-borders": attrs.borders }
                : {},
            parseHTML: (element: HTMLElement) => {
              const value = element.getAttribute("data-borders");
              return value === "rows" || value === "none" ? value : null;
            },
          },
          valign: {
            default: null,
            renderHTML: (attrs: Record<string, unknown>) =>
              attrs.valign === "middle" ? { "data-valign": "middle" } : {},
            parseHTML: (element: HTMLElement) =>
              element.getAttribute("data-valign") === "middle" ? "middle" : null,
          },
          borderColour: {
            default: null,
            renderHTML: (attrs: Record<string, unknown>) =>
              typeof attrs.borderColour === "string" && attrs.borderColour !== "default"
                ? { "data-border-colour": attrs.borderColour }
                : {},
            parseHTML: (element: HTMLElement) => {
              const value = element.getAttribute("data-border-colour");
              return (TABLE_BORDER_COLOURS as readonly string[]).includes(value ?? "") && value !== "default"
                ? value
                : null;
            },
          },
          headerFill: {
            default: null,
            renderHTML: (attrs: Record<string, unknown>) =>
              typeof attrs.headerFill === "string" && attrs.headerFill !== "default"
                ? { "data-header-fill": attrs.headerFill }
                : {},
            parseHTML: (element: HTMLElement) => {
              const value = element.getAttribute("data-header-fill");
              return (TABLE_HEADER_FILLS as readonly string[]).includes(value ?? "") && value !== "default"
                ? value
                : null;
            },
          },
        },
      },
    ];
  },
});

/** The borders control shows its current state (§361). */
const TABLE_BORDER_ICON: Record<TableBorders, ComponentType<SvgIconProps>> = {
  all: BorderAllIcon,
  rows: BorderHorizontalIcon,
  none: BorderClearIcon,
};

const ALIGNABLE = ["paragraph", "heading"] as const;

/**
 * Paragraph and heading alignment (§213) as a global attribute, not
 * `@tiptap/extension-text-align` (§1.5). `parseHTML` clamps pastes (`justify`, `start`…) to the
 * closed set so the server never refuses them; the default emits nothing, as on the page.
 */
const BlockAlign = Extension.create({
  name: "blockAlign",
  addGlobalAttributes() {
    return [
      {
        types: [...ALIGNABLE],
        attributes: {
          align: {
            default: null,
            renderHTML: (attrs: Record<string, unknown>) =>
              attrs.align === "center" || attrs.align === "right"
                ? { style: `text-align: ${attrs.align}` }
                : {},
            parseHTML: (element: HTMLElement) => {
              const value = element.style.textAlign;
              return value === "center" || value === "right" ? value : null;
            },
          },
        },
      },
    ];
  },
});

/**
 * The YouTube block (§110, §266): an atom showing the thumbnail with a play mark, sized and sided
 * like a picture via inline styles. Fetching from YouTube's image host is fine here: the
 * backoffice, unlike a reader's page. `parseHTML` is empty: only the address panel inserts one.
 */
const YoutubeNode = Node.create({
  name: "youtube",
  group: "block",
  atom: true,
  selectable: true,
  draggable: true,
  addAttributes() {
    return {
      videoId: { default: null },
      caption: { default: "" },
      widthPercent: { default: 100 },
      align: { default: "block" },
      // Declared so the poster attributes survive `getJSON`/`setContent` (§403, §414, §485).
      poster: { default: null },
      posterSource: { default: null },
      posterWidth: { default: null },
      posterHeight: { default: null },
      posterCrop: { default: null },
    };
  },
  parseHTML() {
    return [];
  },
  renderHTML({ node }) {
    const id = String(node.attrs.videoId ?? "");
    const percent = Number(node.attrs.widthPercent ?? 100);
    const align = String(node.attrs.align ?? "block");
    const posterSrc = typeof node.attrs.poster === "string" && node.attrs.poster ? node.attrs.poster : `https://i.ytimg.com/vi/${id}/hqdefault.jpg`;
    // A cropped poster (§485) in the same 16∶9 window `RichTextVideo` draws; else whole.
    const framed =
      node.attrs.posterCrop && typeof node.attrs.poster === "string" && node.attrs.poster
        ? cardFrameGeometry({ crop: node.attrs.posterCrop as ImageCrop, width: node.attrs.posterWidth, height: node.attrs.posterHeight })
        : null;
    const poster: [string, Record<string, string>, ...unknown[]] = framed
      ? [
          "div",
          { style: `${cropWindowCss(framed.geometry)};border-radius:4px` },
          ["img", { src: posterSrc, alt: "", style: cropImageCss(framed.geometry) }],
        ]
      : ["img", { src: posterSrc, alt: "", style: "display:block;width:100%;border-radius:4px" }];
    // `imageFigureSx`'s geometry as inline CSS.
    const box = [
      "position:relative",
      `width:${percent}%`,
      "max-width:100%",
      align === "block" ? "margin:8px auto" : align === "left" ? "float:left;margin:8px 24px 8px 0" : "float:right;margin:8px 0 8px 24px",
    ].join(";");
    return [
      "div",
      { class: "rt-youtube", "data-youtube": id, "data-width": String(percent), "data-align": align, style: box },
      poster,
      ["span", { style: "position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);font-size:40px;color:#fff;text-shadow:0 0 8px #000" }, "▶"],
      ["div", { style: "font-size:0.875rem;color:#666;text-align:center;margin-top:4px" }, String(node.attrs.caption ?? "")],
    ];
  },
});

/** A new picture's shape, uploads and gallery alike (§454, §485); 44 px for a thumb. */
function UploadShapeChoice({
  value,
  onChange,
  labels,
  testId,
}: {
  value: CropPreset;
  onChange: (next: CropPreset) => void;
  labels: { presets: string; preset: Record<CropPreset, string>; help: string };
  testId: string;
}) {
  return (
    <Box data-testid={testId}>
      <Typography component="span" variant="body2" sx={{ display: "block", fontWeight: 600, mb: 0.5 }}>
        {labels.presets}
      </Typography>
      <ToggleButtonGroup
        exclusive
        size="small"
        value={value}
        onChange={(_event, next: CropPreset | null) => {
          if (next !== null) onChange(next);
        }}
        aria-label={labels.presets}
        sx={{ flexWrap: "wrap" }}
      >
        {CROP_PRESETS.map((preset) => (
          <ToggleButton key={preset} value={preset} sx={{ minWidth: 44, minHeight: 44, px: 1 }}>
            {labels.preset[preset]}
          </ToggleButton>
        ))}
      </ToggleButtonGroup>
      <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 0.5 }}>
        {labels.help}
      </Typography>
    </Box>
  );
}

function countMissingAlt(doc: unknown): number {
  const content = (doc as { content?: { type?: string; attrs?: { alt?: unknown } }[] })?.content ?? [];
  return content.filter((node) => node.type === "image" && !String(node.attrs?.alt ?? "").trim()).length;
}

/** Not Tiptap's `CharacterCount`: one line does it (§1.5). */
function countWords(text: string): number {
  const trimmed = text.trim();
  return trimmed === "" ? 0 : trimmed.split(/\s+/).length;
}

/**
 * After a refused submit the island re-mounts from the posted body (§315). `override`, a
 * translation filled while the fold was shut (§464), wins over the recalled one.
 */
export default function RichTextEditor({
  override,
  ...props
}: ComponentProps<typeof RichTextEditorIsland> & { override?: RichTextDoc | null }) {
  const recall = useRecall();
  const recalled = recall.value(props.name);
  const initialBody = override
    ? override
    : recalled === undefined
      ? props.initialBody
      : recalledJson(recalled, props.initialBody);
  return <RichTextEditorIsland key={recall.generation} {...props} initialBody={initialBody} />;
}
