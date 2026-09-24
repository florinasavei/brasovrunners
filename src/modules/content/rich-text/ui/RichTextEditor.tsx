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
import Typography from "@mui/material/Typography";
import AddPhotoAlternateIcon from "@mui/icons-material/AddPhotoAlternate";
import BorderAllIcon from "@mui/icons-material/BorderAll";
import BorderClearIcon from "@mui/icons-material/BorderClear";
import BorderColorIcon from "@mui/icons-material/BorderColor";
import BorderHorizontalIcon from "@mui/icons-material/BorderHorizontal";
import DeleteIcon from "@mui/icons-material/Delete";
import FormatAlignCenterIcon from "@mui/icons-material/FormatAlignCenter";
import FormatAlignLeftIcon from "@mui/icons-material/FormatAlignLeft";
import FormatAlignRightIcon from "@mui/icons-material/FormatAlignRight";
import FormatBoldIcon from "@mui/icons-material/FormatBold";
import FormatColorFillIcon from "@mui/icons-material/FormatColorFill";
import FormatItalicIcon from "@mui/icons-material/FormatItalic";
import FormatListBulletedIcon from "@mui/icons-material/FormatListBulleted";
import FormatListNumberedIcon from "@mui/icons-material/FormatListNumbered";
import FormatQuoteIcon from "@mui/icons-material/FormatQuote";
import LinkIcon from "@mui/icons-material/Link";
import PhotoLibraryIcon from "@mui/icons-material/PhotoLibrary";
import RedoIcon from "@mui/icons-material/Redo";
import SmartDisplayIcon from "@mui/icons-material/SmartDisplay";
import TableChartIcon from "@mui/icons-material/TableChart";
import TableRowsIcon from "@mui/icons-material/TableRows";
import UndoIcon from "@mui/icons-material/Undo";
import VerticalAlignCenterIcon from "@mui/icons-material/VerticalAlignCenter";
import ViewColumnIcon from "@mui/icons-material/ViewColumn";
import VisibilityIcon from "@mui/icons-material/Visibility";
import WebAssetIcon from "@mui/icons-material/WebAsset";
import type { SvgIconProps } from "@mui/material/SvgIcon";
import { Extension, mergeAttributes, Node, type Editor } from "@tiptap/core";
import Image from "@tiptap/extension-image";
import { EditorContent, useEditor, useEditorState } from "@tiptap/react";
import { BubbleMenu } from "@tiptap/react/menus";
import StarterKit from "@tiptap/starter-kit";
import { TableKit } from "@tiptap/extension-table/kit";
import { youtubeVideoId } from "@/modules/events/domain/video";
import { type ComponentProps, type ComponentType, useCallback, useEffect, useRef, useState } from "react";
import { shrinkImageInBrowser } from "@/modules/media/browser-shrink";
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
  type TableBorderColour,
  type TableBorders,
  type TableHeaderFill,
  type TableValign,
} from "../domain/schema";
import { editorLook, sameEditorLook } from "./editor-look";
import ImageCropBox from "./ImageCropBox";
import { cropGeometry, cropImageCss, cropWindowCss } from "./image-layout";
import { EDITOR_TABLE_SX, PREVIEW_CONTENT_SX } from "./table-layout";

/** Floating-UI's placement for the table's bar: above the table, created once. */
const TABLE_BAR_OPTIONS = { placement: "top" } as const;

/**
 * The two floating bars, above the sticky toolbar (§361, §363). Tiptap appends a bar to the
 * writing area and positions it with no stacking order of its own, so the toolbar's `zIndex: 2`
 * painted over it: a table at the top of the body had its bar — every table verb — hidden behind
 * the toolbar it sat under, and a word selected on the first lines had the bar over it drawn
 * *under* the toolbar, which the owner saw as "three empty buttons" (2026-09-24: "I can't see
 * these buttons in the rich text editor"): the bottoms of the three buttons below the toolbar,
 * their glyphs behind it.
 *
 * **On the `Paper` we render, never on `BubbleMenu`'s `style`.** §361 passed `{ zIndex: 3 }` as the
 * menu's `style` prop, and it worked under `next dev` and nowhere else. Tiptap 3.31 copies `style`
 * and the `data-*`/`aria-*` props onto the menu's element in a helper whose loop is a
 * `new Set([...])` annotated `@__PURE__` with `.forEach(…)` called on it; the production minifier
 * takes the annotation for the whole call, finds its result unused and deletes it — the built
 * chunk has no trace of the style code at all. So nothing passed to `BubbleMenu` beyond the plugin's own props (`editor`,
 * `pluginKey`, `shouldShow`, `options`) exists in production, and a unit test keeps it that way.
 *
 * The menu's element has `z-index: auto` and `opacity: 1` while shown, so it makes no stacking
 * context of its own: a positioned `Paper` inside it is stacked with the toolbar's, and 3 is one
 * above it — far below MUI's app bar, tooltips and popovers.
 */
const FLOATING_BAR_SX = { position: "relative", zIndex: 3 } as const;

/**
 * The writing area's own box: a generous minimum, because a page body that looks like a one-line
 * field invites a one-line page. One object for the two places that draw it — Tiptap's `.tiptap`
 * and the stand-in shown until Tiptap has mounted — so the two are always the same height.
 *
 * **Why the stand-in** (found by CI on BR-V1.80, not by anything that batch changed). Tiptap
 * builds its editor only in the browser, after hydration (`immediatelyRender: false`, below), and
 * until then the writing area was an empty `div`, zero pixels tall. The moment it mounted, it
 * grew to this box and pushed everything under it down — 272 pixels on `/admin/emails`, where
 * "Salvează textul" and "Înlocuiește cu câmpurile" stand under each message's editor. A press in
 * that first second landed on the gap the button had just left and did nothing: no request, no
 * answer, the page as it was. With the stand-in the area has its height from the first paint, and
 * the stand-in goes in the same render that brings Tiptap's element in, so nothing below moves.
 */
const WRITING_AREA_BOX = { minHeight: 240, p: 2 } as const;

/**
 * Word's own three glyphs for the three alignments (§274; the owner: "the alignment icons for
 * the text should resemble microsoft word!"). They were the toolbar's first glyphs; since §361
 * every button wears one, from the same family.
 */
const ALIGN_ICON = {
  left: FormatAlignLeftIcon,
  center: FormatAlignCenterIcon,
  right: FormatAlignRightIcon,
} as const;

/**
 * The editor an organizer writes a page in: what they see is what the page will show.
 *
 * ## Why this is the one client island in the editorial forms
 *
 * Text formatting is a live thing — you select a word and press bold — and there is no way to do
 * it on the server. Everything around it stays a Server Component (`AGENTS.md` §14.1), and
 * because only `/admin` imports this file, Next never sends Tiptap to a visitor reading an event
 * page. That matters: the editor and ProseMirror together are larger than the whole public site,
 * and the public pages are what every visitor pays for (§1.5).
 *
 * ## How it reaches the server
 *
 * A hidden input holds `JSON.stringify(doc)` and is updated on every keystroke, so the
 * surrounding `<form>` and its Server Action are unchanged — the field is still one string named
 * by the caller, exactly as the textarea was. If this island fails to load, the hidden input
 * still carries the body it was given, so a save writes the text back unchanged rather than
 * blanking somebody's page.
 *
 * ## The toolbar wears Material glyphs (§361)
 *
 * It had words and characters on it — "B", "•—", "⊞", "🔗", "↶", "Imagine" — because the picture
 * emoji rendered as a broken box on the owner's machine (2026-09-18), and a character is whatever
 * the reader's font makes of it. A Material glyph is an SVG: the same picture on every machine,
 * at one size, in one colour. The backoffice already loads `@mui/icons-material` for its buttons
 * (§318), so it costs no dependency. Every control is a `ToolbarButton`, which says its full name
 * as its accessible name and as a tooltip; "H2" and "H3" stay words, because a heading level is
 * read faster as its name than as any picture.
 */
function RichTextEditorIsland({
  name,
  initialBody,
  label,
  accessibleSuffix,
  features = { media: true, tables: true },
  labels,
}: {
  /** The form field the JSON is posted as — the same name the textarea used. */
  name: string;
  /** Whatever is stored today: a document, an old-shape body, or nothing. */
  initialBody: unknown;
  label: string;
  /**
   * What this body belongs to, for the accessible name alone — a language, usually. The editorial
   * forms show one editor per language under a heading that names it, so a sighted reader knows
   * which is which; without this, somebody tabbing through hears "Text" twice and has no way to
   * tell them apart.
   */
  accessibleSuffix?: string;
  /**
   * Which halves of the toolbar this body may use (`DECISIONS.md` §270).
   *
   * An email's words are written in this same editor, and a mail client can draw neither a
   * picture the reader's client has not blocked, nor a film, nor a table narrow enough for a
   * phone — `notifications/domain/email-rich-text.ts` argues each. The server refuses those
   * nodes there whatever arrives, so this is not the guard; it is what keeps the toolbar from
   * offering a button whose result the save would reject. Absent means the whole toolbar, which
   * is what every editorial form wants.
   */
  features?: { media?: boolean; tables?: boolean };
  /** Translated control names. Passed in, because a client island cannot read the catalogue. */
  labels: {
    bold: string;
    italic: string;
    heading2: string;
    heading3: string;
    bulletList: string;
    orderedList: string;
    quote: string;
    /** Where a paragraph or a heading sits in the column (§213): the full name, and the letter. */
    align: Record<BlockAlignment, string>;
    alignShort: Record<BlockAlignment, string>;
    table: string;
    tableAddRow: string;
    tableAddColumn: string;
    tableDeleteRow: string;
    tableDeleteColumn: string;
    tableDelete: string;
    /** §263: how the table is drawn, where its text sits, and whether it has a header row. */
    tableBorders: Record<TableBorders, string>;
    /** §271: the two colours, each named by the state it is in. */
    tableBorderColour: Record<TableBorderColour, string>;
    tableHeaderFill: Record<TableHeaderFill, string>;
    tableValign: string;
    tableHeaderRow: string;
    link: string;
    linkUrl: string;
    linkApply: string;
    linkRemove: string;
    linkCancel: string;
    /** §273: how much has been written, with its `{count}` placeholder. */
    words: string;
    /** §271: the pop-up that shows the body as the page will draw it. */
    preview: string;
    previewShort: string;
    previewClose: string;
    undo: string;
    redo: string;
    image: string;
    imageUploading: string;
    imageFailed: string;
    imageAlt: string;
    imageAltHelp: string;
    imageCaption: string;
    imageSize: string;
    /** Where the picture sits: a band across the column, or floated with the text beside it. */
    imageAlign: string;
    imageAlignBlock: string;
    imageAlignLeft: string;
    imageAlignRight: string;
    imageAlignHelp: string;
    /** The crop box (§241): its name, how to use it, "the whole picture", and where it is. */
    imageCrop: string;
    imageCropHelp: string;
    imageCropReset: string;
    imageCropPosition: string;
    imageRemove: string;
    imageDone: string;
    /** The ✕ on the picture's panel, and the panel's own heading (§258). */
    imageClose: string;
    imagePanel: string;
    /**
     * The nag under the editor, one picture and several. Two strings rather than a function:
     * props cross the server boundary, and the client island substitutes the count itself.
     */
    imageNoAltOne: string;
    imageNoAltMany: string;
    imageFromGallery: string;
    /**
     * The words the three media buttons wore until §361, like `alignShort` and `previewShort`
     * before them: every button wears a glyph now and says its long label. Not drawn; kept while
     * the catalogue still has them.
     */
    imageShort: string;
    imageFromGalleryShort: string;
    imageGalleryLoading: string;
    imageGalleryEmpty: string;
    imageGalleryClose: string;
    youtube: string;
    youtubeShort: string;
    youtubeUrl: string;
    youtubeApply: string;
    youtubeInvalid: string;
    youtubeCaption: string;
    youtubeRemove: string;
  };
}) {
  const initialDoc = readRichText(initialBody);
  const [value, setValue] = useState(() => JSON.stringify(initialDoc));
  const [linkDraft, setLinkDraft] = useState<string | null>(null);
  /** The YouTube panel: closed, or the address being typed, with a refusal when it is not one. */
  const [youtubeDraft, setYoutubeDraft] = useState<string | null>(null);
  const [youtubeInvalid, setYoutubeInvalid] = useState(false);
  const [imageState, setImageState] = useState<"idle" | "uploading" | "failed">("idle");
  /**
   * The preview (§271; the owner: "I also want a preview in a pop-up"): the editor's own markup,
   * taken once when the dialog opens rather than read on every keystroke, and `null` while it is
   * shut so nothing is rendered twice behind it.
   */
  const [preview, setPreview] = useState<string | null>(null);
  /**
   * The two props the table's bar is given, kept stable between renders.
   *
   * `BubbleMenu` registers a ProseMirror plugin from its props, and a new function or object
   * identity on every render re-registers it — which dispatches a transaction, which renders
   * again. That is React error #185, "maximum update depth exceeded", and it took the whole
   * editor island down the moment it mounted: no toolbar, no language tabs, and an e2e suite
   * that failed on "no tab named English" rather than on anything about tables.
   */
  const showOverTable = useCallback(({ editor: current }: { editor: Editor }) => current.isActive("table"), []);
  const [missingAlt, setMissingAlt] = useState(() => countMissingAlt(initialDoc));
  const [words, setWords] = useState(() => countWords(richTextToPlainText(initialDoc)));
  /*
    The hidden value is written by React, which fires no event a form can hear, so every write is
    announced with a bubbling `input` from the hidden box itself (§350): the event editor's tab
    marks ("· incomplet") and the "missing for publication" list re-read the form on `input`.
    Not on mount — nothing was typed yet.
  */
  const hiddenValue = useRef<HTMLInputElement>(null);
  const announced = useRef(value);
  useEffect(() => {
    if (announced.current === value) return;
    announced.current = value;
    hiddenValue.current?.dispatchEvent(new Event("input", { bubbles: true }));
  }, [value]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  /** The pictures already stored, once asked for: `null` closed, `"loading"`, or the list. */
  const [gallery, setGallery] = useState<null | "loading" | StoredPicture[]>(null);
  /**
   * The picture's panel, closed by hand (§258; the owner: "ar trebui să pot anula sau închide
   * pur și simplu").
   *
   * Selecting a picture is how the panel opens, and a selected picture is a state Tiptap owns —
   * so "closed" cannot be the absence of a selection without also deselecting the picture the
   * organizer is looking at. It is a dismissal instead, remembered against the position of the
   * node it was dismissed for, so pressing the same picture again opens it and moving to
   * another picture opens that one's.
   */
  const [dismissedAt, setDismissedAt] = useState<number | null>(null);

  const editor = useEditor({
    // Next renders this component's tree on the server first; Tiptap needs a DOM. Without this,
    // the editor is built during SSR and hydration mismatches.
    immediatelyRender: false,
    extensions: [
      StarterKit.configure({
        /**
         * The allowlist of `AGENTS.md` §11.3, stated as the things StarterKit ships that it does
         * not include. Leaving one on would let an organizer write something the server then
         * refuses to save — a failure they would meet at the end of a long edit, with no
         * explanation. Adding one of these is a rule change, in both places at once.
         */
        codeBlock: false,
        code: false,
        strike: false,
        underline: false,
        horizontalRule: false,
        hardBreak: false,
        heading: { levels: [2, 3] },
        link: {
          // A click inside the editor should move the caret, not navigate away from the form.
          openOnClick: false,
          protocols: ["http", "https", "mailto"],
        },
      }),
      /**
       * Pictures between paragraphs (§72, §73): a block, never inline, with the stored
       * variant's size carried so the page reserves the space. The address comes from the
       * upload route alone — there is no "paste a URL" path, and `parseHTML` is empty so a
       * pasted `<img>` from another site is dropped here rather than refused at save time.
       * The size is a share of the column, rendered here as the same inline width the page
       * uses; the caption shows on hover and in the picture's own panel.
       */
      /**
       * A YouTube film (§110): an atom block holding the video id and a caption. Shown in the
       * editor as the film's own thumbnail with a play mark — enough to see what is there
       * without loading a player inside a form. `parseHTML` is empty: a pasted embed from
       * elsewhere is dropped here, and the only way in is the address panel below, which keeps
       * nothing but the id.
       */
      YoutubeNode,
      /*
        Left, centred or right, on a paragraph or a heading (§213). A global attribute rather
        than a dependency: `@tiptap/extension-text-align` is this object with a command around
        it, and the standing instruction is to prefer nothing over a package (§1.5). The
        alignment is written as it will render, so the editor shows the page's own arrangement.
      */
      BlockAlign,
      /*
        Tables (§196). `TableKit` is the table node with its row, cell and header in one import.

        `resizable` was false, because a column width is a pixel measurement made on somebody's
        laptop and this site's hard target is a 320-pixel column. §271 turns it on: what dragging
        an edge says is "this column is about twice that one", the stored pixels are read as a
        proportion, and the page lays the table out from a `<colgroup>` of percentages. The
        handle is drawn by `EDITOR_TABLE_SX` — ProseMirror renders an element with no styles of
        its own, so without a rule the gesture is invisible.
      */
      TableKit.configure({ table: { resizable: true } }),
      /* The borders and the vertical alignment of a table (§263), above. */
      TableStyle,
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
            /**
             * Where the picture sits in the column: a band across it, or floated left or right
             * with the text wrapping around. Shown here as the page will show it on a wide
             * screen — `mergeAttributes` merges this `style` with the width's, declaration by
             * declaration — so what the organizer sees is what the page does (§73's rule, kept).
             */
            align: {
              default: "block",
              renderHTML: (attrs) =>
                attrs.align === "left" || attrs.align === "right"
                  ? {
                      style: `float: ${attrs.align}; clear: both; margin-${attrs.align === "left" ? "right" : "left"}: 24px`,
                    }
                  : {},
            },
            /**
             * The part of the photograph the page will show (§241). It renders no attribute of
             * its own — four fractions are not an HTML attribute — because the node's own
             * `renderHTML` below turns them into the window the page uses.
             */
            crop: { default: null, renderHTML: () => ({}) },
          };
        },
        /**
         * What the editor draws, and the reason the crop is visible while it is being chosen:
         * the same window `RichText` renders, from the same geometry (`image-layout.ts`).
         *
         * Without a crop this returns exactly what Tiptap's own Image returns — one `<img>` —
         * so a body that has none is edited in markup identical to yesterday's. With one, the
         * block's size and side stay on the window (that is the `style` the width and align
         * attributes produced) and the photograph inside it is magnified and pulled to the
         * chosen corner.
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
    // Re-rendered by `useEditorState` below, on what the toolbar reads — not on every transaction.
    shouldRerenderOnTransaction: false,
    onUpdate: ({ editor: current }) => {
      // One document per keystroke, read once (§NNN): `getJSON` walks the whole text.
      const doc = current.getJSON();
      setValue(JSON.stringify(doc));
      setMissingAlt(countMissingAlt(doc));
      setWords(countWords(current.getText()));
    },
    editorProps: {
      // A picture pasted or dropped as a *file* goes through the same upload as the control.
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
        // The field this writes into. Two editors on one form are otherwise indistinguishable
        // from the outside, which makes a test assert against whichever happens to be first.
        "data-field": name,
      },
    },
  });

  /*
    **What re-renders the island (§NNN): the document, the selection and the marks to come — the
    three things the toolbar, the picture's panel and the table's bar are drawn from
    (`editor-look.ts`).** `shouldRerenderOnTransaction` re-rendered it on every transaction, and
    Tiptap dispatches one for a focus and one for a blur that change none of them: leaving the box
    to press "Salvează" re-rendered the whole toolbar — four hundred components — inside the press,
    a tenth of a second on a phone, for a screen that did not change.
  */
  useEditorState({ editor, selector: ({ editor: current }) => editorLook(current?.state), equalityFn: sameEditorLook });

  /**
   * Shrink in the browser, post to `/api/admin/media`, insert the answer as an image node.
   * One file at a time; a failure is a sentence under the toolbar, never a lost body.
   */
  const insertImage = async (file: File) => {
    setImageState("uploading");
    try {
      const body = new FormData();
      body.append("file", await shrinkImageInBrowser(file), file.name.replace(/\.[^.]+$/, "") + ".webp");
      body.append("originalFilename", file.name);
      const response = await fetch("/api/admin/media", { method: "POST", body });
      if (!response.ok) throw new Error(String(response.status));
      const uploaded = (await response.json()) as { src: string; width: number; height: number };
      // The alt is empty, not the file name: "IMG_4021" is not what a screen reader should say,
      // and an empty alt is what the nag under the editor counts.
      editor
        ?.chain()
        .focus()
        .setImage({ src: uploaded.src, alt: "", caption: "", width: uploaded.width, height: uploaded.height, widthPercent: 100, align: "block", crop: null } as never)
        .run();
      setImageState("idle");
    } catch {
      setImageState("failed");
    }
  };

  /**
   * The selected picture, when one is: ProseMirror marks the node's own element, and that
   * element is what the panel anchors to. Read on every render — the selection is state the
   * editor owns, and `useEditorState` above re-renders on every change of it.
   */
  const selectedImage = editor?.isActive("image")
    ? (editor.view.dom.querySelector("img.ProseMirror-selectednode, .rt-crop.ProseMirror-selectednode") as HTMLElement | null)
    : null;
  /*
    The table's own two choices (§263), read where the toolbar is built. `getAttributes` on a
    caret outside a table answers `{}`, so the fallbacks are the defaults and the controls are
    only rendered inside one anyway.
  */
  const tableBorders: TableBorders =
    (editor?.getAttributes("table").borders as TableBorders | null) ?? "all";
  const tableValign: TableValign =
    (editor?.getAttributes("table").valign as TableValign | null) ?? "top";
  /** The two colours (§271), read the same way and defaulting the same way. */
  const tableBorderColour: TableBorderColour =
    (editor?.getAttributes("table").borderColour as TableBorderColour | null) ?? "default";
  const tableHeaderFill: TableHeaderFill =
    (editor?.getAttributes("table").headerFill as TableHeaderFill | null) ?? "default";
  const nextBorders = TABLE_BORDERS[(TABLE_BORDERS.indexOf(tableBorders) + 1) % TABLE_BORDERS.length];

  const imageAttrs = selectedImage ? editor?.getAttributes("image") : undefined;
  const imageNodeAt = selectedImage ? (editor?.state.selection.from ?? null) : null;
  const imagePanelOpen = Boolean(selectedImage) && imageNodeAt !== dismissedAt;
  const closeImagePanel = () => setDismissedAt(imageNodeAt);
  /** The selected film, for its own panel (§110): caption it, or remove it. */
  const selectedVideo = editor?.isActive("youtube")
    ? (editor.view.dom.querySelector(".rt-youtube.ProseMirror-selectednode") as HTMLElement | null)
    : null;
  const videoAttrs = selectedVideo ? editor?.getAttributes("youtube") : undefined;
  // Without `.focus()`: the panel's own field keeps the caret, and the node stays selected.
  const setImageAttr = (attrs: Record<string, unknown>) => editor?.chain().updateAttributes("image", attrs).run();

  /**
   * "Choose one already uploaded": the same list the pictures page shows, fetched when the
   * control is pressed and never before — a page body is written far more often than a
   * picture is reused, and the list is a request the editor would otherwise make on every load.
   */
  const openGallery = async () => {
    if (gallery !== null) {
      setGallery(null);
      return;
    }
    setGallery("loading");
    try {
      const response = await fetch("/api/admin/media");
      if (!response.ok) throw new Error(String(response.status));
      const { assets } = (await response.json()) as { assets: StoredPicture[] };
      setGallery(assets);
    } catch {
      setGallery([]);
    }
  };

  const insertStored = (picture: StoredPicture) => {
    editor
      ?.chain()
      .focus()
      .setImage({ src: picture.src, alt: "", caption: "", width: picture.width, height: picture.height, widthPercent: 100, align: "block", crop: null } as never)
      .run();
    setGallery(null);
  };

  /** The address becomes an id, or a refusal under the field; nothing else is kept (§110). */
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
   * Align every paragraph and heading the selection touches, in one transaction.
   *
   * One `command` holding both `updateAttributes` calls rather than a chain of them: a chain
   * stops at the first step that answers false, and a selection inside a paragraph has no
   * heading to update — so the chain would align the paragraph and then, on a selection that
   * spans both, silently do half the job depending on which came first. `left` is written as
   * `null`, because the default is the absence of the attribute, not a third value.
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
        The preview (§271). What it shows is the editor's own markup under the page's rules and
        **without the editing aids** — no dashed cell guides, no resize handle, no selection
        shading — because the question a preview answers is "which of these lines will the reader
        see". `PREVIEW_CONTENT_SX` is the same description `.tiptap` uses, keyed under the
        dialog instead, so the two cannot drift (§263's rule, applied to a third surface).

        The markup is this browser's own editor state, never anything fetched or stored: it is
        the document the author is looking at, rendered back to them. What is *saved* still goes
        through the server's allowlist, which is the boundary that matters (`domain/schema.ts`).
      */}
      <Dialog open={preview !== null} onClose={() => setPreview(null)} fullWidth maxWidth="md" scroll="paper">
        <DialogTitle>{labels.preview}</DialogTitle>
        <DialogContent dividers>
          <Box sx={PREVIEW_CONTENT_SX} dangerouslySetInnerHTML={{ __html: preview ?? "" }} />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setPreview(null)} sx={{ minHeight: 44 }}>
            {labels.previewClose}
          </Button>
        </DialogActions>
      </Dialog>

      {/* The value the form posts. Present and correct even before the editor has loaded. */}
      <input ref={hiddenValue} type="hidden" name={name} value={value} readOnly />

      <Box sx={{ border: 1, borderColor: "divider", borderRadius: 1 }}>
        <Stack
          direction="row"
          spacing={0.5}
          role="toolbar"
          aria-label={accessibleSuffix ? `${label} — ${accessibleSuffix}` : label}
          /*
            Sticky (§273). A description runs to several screens and the toolbar sat at the top
            of it: to make a word bold two screens down, the writer scrolled up, lost the
            selection, and scrolled back. Every editor people already know keeps its toolbar in
            view, and the alternative — a floating bar — is the bubble menu below, which is for
            the selection rather than for the whole body.

            `top: 0` against the page's own scroller, and a background of its own: without one
            the text scrolls visibly under a transparent bar.
          */
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
          {/* Left, centred, right (§213), in Word's three glyphs (§274). The full name is the
              accessible name and the tooltip. */}
          {BLOCK_ALIGNMENTS.map((align) => (
            <ToolbarButton
              key={align}
              label={labels.align[align]}
              icon={ALIGN_ICON[align]}
              active={align === "left" ? !editor?.isActive({ align: "center" }) && !editor?.isActive({ align: "right" }) : (editor?.isActive({ align }) ?? false)}
              onClick={() => setAlign(align)}
            />
          ))}
          {/*
            One button inserts a table; the rest of the verbs appear only while the caret is
            inside one (§196). A toolbar that showed "add a row" to somebody writing a paragraph
            is four dead controls.
          */}
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
          {/*
            A picture from the phone or the computer is the picture with a plus; one already
            uploaded is the library of them; a film is the play mark. They were words (2026-09-18)
            because the picture emoji rendered as a broken box; a Material glyph cannot (§361).
            The play mark and not YouTube's own logo: Material's brand glyphs were refused (§90).
          */}
          {features.media !== false && (
          <>
          <ToolbarButton
            label={imageState === "uploading" ? labels.imageUploading : labels.image}
            icon={AddPhotoAlternateIcon}
            active={false}
            onClick={() => fileInputRef.current?.click()}
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
            active={gallery !== null}
            onClick={() => void openGallery()}
          />
          <ToolbarButton
            label={labels.youtube}
            icon={SmartDisplayIcon}
            active={youtubeDraft !== null || (editor?.isActive("youtube") ?? false)}
            onClick={() => {
              setYoutubeInvalid(false);
              setYoutubeDraft((open) => (open === null ? "" : null));
            }}
          />
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
          {/* Last, and an eye (§274): it is about the whole body rather than about the caret,
              so it belongs at the end of the row and not among the verbs that change text. */}
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
            <Button onClick={applyYoutube}>{labels.youtubeApply}</Button>
            <Button color="inherit" onClick={() => setYoutubeDraft(null)}>
              {labels.linkCancel}
            </Button>
          </Stack>
        )}

        {imageState !== "idle" && (
          <Typography variant="body2" color={imageState === "failed" ? "error" : "text.secondary"} sx={{ px: 1, py: 0.5 }}>
            {imageState === "failed" ? labels.imageFailed : labels.imageUploading}
          </Typography>
        )}

        {gallery !== null && (
          <Box sx={{ p: 1, borderBottom: 1, borderColor: "divider" }} data-testid="rich-text-gallery">
            {gallery === "loading" ? (
              <Typography variant="body2" color="text.secondary">
                {labels.imageGalleryLoading}
              </Typography>
            ) : gallery.length === 0 ? (
              <Typography variant="body2" color="text.secondary">
                {labels.imageGalleryEmpty}
              </Typography>
            ) : (
              <Box sx={{ display: "flex", flexWrap: "wrap", gap: 1, maxHeight: 260, overflowY: "auto" }}>
                {gallery.map((picture) => (
                  // A plain button around the thumbnail: the file name is its accessible name,
                  // and 88px is a thumb-sized target.
                  <Box
                    key={picture.id}
                    component="button"
                    type="button"
                    aria-label={picture.name}
                    title={picture.name}
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => insertStored(picture)}
                    sx={{ p: 0, border: 1, borderColor: "divider", borderRadius: 1, bgcolor: "transparent", cursor: "pointer", overflow: "hidden", width: 88, height: 88 }}
                  >
                    <Box component="img" src={picture.thumb} alt="" width={88} height={88} sx={{ display: "block", width: 88, height: 88, objectFit: "cover" }} />
                  </Box>
                ))}
              </Box>
            )}
            <Button color="inherit" size="small" onClick={() => setGallery(null)} sx={{ mt: 1 }}>
              {labels.imageGalleryClose}
            </Button>
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
                  // Inside a form: Enter here must apply the link, not submit the page.
                  event.preventDefault();
                  applyLink();
                }
                if (event.key === "Escape") setLinkDraft(null);
              }}
              sx={{ flexGrow: 1, minWidth: 200 }}
            />
            <Button onClick={applyLink}>{labels.linkApply}</Button>
            <Button
              color="inherit"
              onClick={() => {
                editor?.chain().focus().extendMarkRange("link").unsetLink().run();
                setLinkDraft(null);
              }}
            >
              {labels.linkRemove}
            </Button>
            <Button color="inherit" onClick={() => setLinkDraft(null)}>
              {labels.linkCancel}
            </Button>
          </Stack>
        )}

        <Box
          sx={{
            // The writing area itself (`WRITING_AREA_BOX`).
            "& .tiptap": {
              ...WRITING_AREA_BOX,
              outline: "none",
              "&:focus-visible": { outline: 2, outlineColor: "primary.main", outlineOffset: -2 },
              // A floated picture at the end of the body would otherwise hang out of the
              // writing area and over whatever the form puts beneath it.
              "&::after": { content: '""', display: "table", clear: "both" },
            },
            /*
              A picture is never wider than the column, here as on the page; the selected one is
              outlined so the panel beside it is plainly about *this* picture.

              **And every picture shows its own edges while writing** (§274; the owner: "the
              pictures inside the editor should have borders so I know how they wrap"). A
              photograph with a pale sky in it ends somewhere the eye cannot find, and where it
              ends is exactly the question when it is floated and the paragraphs run beside it.
              A dashed hairline says where the box is, the same one a table's cells wear (§271),
              and it is an `outline` so it takes no layout and the text does not shift by a pixel
              when a picture is resized or moved to the other side.
            */
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
            // The selection wins over the guide: three pixels of the club's blue, not a hairline.
            "& .tiptap img.ProseMirror-selectednode": {
              outline: 3,
              outlineColor: "primary.main",
              outlineOffset: 2,
            },
            /*
              A cropped picture (§241) is the same block with a window around it: the window
              carries the width and the side, so it takes the margins the picture had, and it is
              what ProseMirror marks as selected — the outline and the panel's anchor both move
              to it. The photograph inside carries its own inline rules and overrides the ones
              above, which are what an uncropped picture still gets.
            */
            "& .tiptap .rt-crop": {
              mx: "auto",
              my: 2,
              cursor: "pointer",
              borderRadius: 1,
              // The same edges an uncropped picture shows (§274) — a cropped one is the picture
              // whose boundary is hardest to guess, so it is the one that needs them most.
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
            /* A table is drawn here exactly as the page draws it (§263). The editor had no table
               rules at all: a grid on the page was an unstyled table in the form, which is the
               whole of "tabelele arată strange". */
            ...EDITOR_TABLE_SX,
          }}
        >
          {/*
            The table's own verbs, over the table (§274; the owner: "the tables icons should
            appear above the table, I have way too many icons now!").

            Six controls that only ever apply inside a table were sitting in a toolbar that is
            read while writing a paragraph — the row had grown to twenty buttons. A bubble menu
            keyed on the caret being inside a table puts them where the table is and takes them
            off the toolbar entirely; `shouldShow` is what decides, so the bar is absent the
            moment the caret leaves.
          */}
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
              {/* A row is the rows glyph and a column the columns glyph; the corner says whether
                  the press adds one or deletes the one the caret is in (§361). */}
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
              {/*
                How the table is drawn (§263; the owner: "la tabele ar trebui să pot alege border
                and stuff, ca să pot folosi tabelele și ca și layout"). One control that cycles
                grid → rows → none, showing what it is on rather than what it will do, because
                three separate buttons for one three-valued choice is three buttons.
              */}
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
              {/* Top or middle. Horizontal centring is the paragraph's own alignment, three
                  buttons to the left — a cell holds paragraphs, so it is already there. */}
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
              {/*
                The two colours (§271), each a control that cycles its own closed set and is
                named after the state it is in — the same shape the borders control has, for the
                same reason: a named control can say "lines: blue" and a colour picker cannot say
                anything at all. The glyphs are the ones every office suite draws for the two:
                the pen over a line for the lines' colour, the bucket for a fill.
              */}
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
              {/* A layout table has no header row, and a table that grew one by accident has no
                  other way to lose it. Tiptap's own command: it converts the row in place. The
                  glyph is a box whose top band is filled — a table with its header row. */}
              <ToolbarButton
                label={labels.tableHeaderRow}
                icon={WebAssetIcon}
                active={editor?.isActive("tableHeader") ?? false}
                onClick={() => editor?.chain().focus().toggleHeaderRow().run()}
              />
              {/* The bin, as deleting wears everywhere in the backoffice (§318). */}
              <ToolbarButton
                label={labels.tableDelete}
                icon={DeleteIcon}
                active={false}
                onClick={() => editor?.chain().focus().deleteTable().run()}
              />

              </Paper>
            </BubbleMenu>
          )}

          {/*
            The bar over a selection (§273; the owner: "I want that rich text editor to be almost
            as good as word … or at least close to WordPress, Amalia is used to WordPress").

            Three verbs, because a bubble menu is for what somebody does *to the words they just
            selected* — make them bold, make them a link — and everything structural stays in the
            toolbar above, which is sticky now. `@tiptap/react/menus` is a subpath of a package
            already installed: no new dependency (§1.5).
          */}
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
          {/* The writing area's height before Tiptap has mounted (`WRITING_AREA_BOX`): nothing to read, nothing to focus. */}
          {!editor && <Box aria-hidden sx={WRITING_AREA_BOX} data-testid="rich-text-reserved" />}
          <EditorContent editor={editor} />
        </Box>
      </Box>

      {/*
        How much is written (§273), which every editor people know shows and which answers the
        question an organizer actually has about a description: is this two sentences or two
        screens. Counted from the editor's own text rather than from a package.
      */}
      <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 0.5 }} data-testid="rich-text-words">
        {labels.words.replace("{count}", String(words))}
      </Typography>

      {/* Dimmed, not a block: a picture without alt text is a page that still publishes, and
          a sentence somebody reads before they save. */}
      {missingAlt > 0 && (
        <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }} data-testid="rich-text-missing-alt">
          {missingAlt === 1 ? labels.imageNoAltOne : labels.imageNoAltMany.replace("{count}", String(missingAlt))}
        </Typography>
      )}

      {/*
        The picture's own panel: click a picture, say what it shows, caption it, choose its
        size, or remove it. Anchored to the picture and kept inside the viewport; it closes
        when the selection moves anywhere else, and "Done" moves it past the picture.
      */}
      <Popper
        open={imagePanelOpen}
        anchorEl={selectedImage}
        placement="bottom-start"
        /*
          It floated over the header and the navigation on a wide screen (§258; the owner:
          "editorul de poze rămâne floating în dreapta random").

          Three modifiers and nothing clever: `flip` puts it above the picture when there is no
          room below, `preventOverflow` keeps it inside the writing area's own box rather than
          the viewport — so a picture floated to the right edge no longer pushes the panel over
          the page's chrome — and `offset` leaves eight pixels so it reads as attached to the
          picture and not as part of it.
        */
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
          // Escape closes it, like every dialog on the platform — and the keyboard is how
          // somebody who has just been nudging the crop box with the arrows will reach for it.
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.stopPropagation();
              closeImagePanel();
            }
          }}
        >
          <Stack spacing={1.5}>
            {/* A heading and a way out. The panel used to offer "Gata", which moves the caret
                past the picture — useful, and not the same thing as "close this". */}
            <Stack direction="row" sx={{ alignItems: "center", justifyContent: "space-between" }}>
              <Typography variant="body2" sx={{ fontWeight: 600 }}>
                {labels.imagePanel}
              </Typography>
              <Button size="small" color="inherit" onClick={closeImagePanel} aria-label={labels.imageClose} sx={{ minWidth: 44 }}>
                ✕
              </Button>
            </Stack>
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
                  /**
                   * Floating a picture that takes the whole column leaves no column to write in,
                   * so the two controls move together: choosing left or right from a full-width
                   * picture halves it, in the same transaction, and the four widths stay there
                   * to change afterwards. The alternative — letting the organizer press "left"
                   * and see nothing happen — is the worse of the two surprises.
                   */
                  const widthPercent =
                    align !== "block" && Number(imageAttrs?.widthPercent ?? 100) === 100
                      ? 50
                      : undefined;
                  setImageAttr(widthPercent ? { align, widthPercent } : { align });
                }}
                aria-label={labels.imageAlign}
              >
                {IMAGE_ALIGNMENTS.map((align) => (
                  <ToggleButton key={align} value={align} sx={{ minWidth: 56, minHeight: 40 }}>
                    {align === "block" ? labels.imageAlignBlock : align === "left" ? labels.imageAlignLeft : labels.imageAlignRight}
                  </ToggleButton>
                ))}
              </ToggleButtonGroup>
              <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 0.5 }}>
                {labels.imageAlignHelp}
              </Typography>
            </Box>
            {/*
              The crop (§241). Only for a picture whose own size is stored: the window the page
              draws is shaped from the photograph's ratio, and a picture from before the upload
              route recorded it would be cropped here and shown whole everywhere else — a lie in
              the one place this feature exists to stop telling.
            */}
            {typeof imageAttrs?.width === "number" && typeof imageAttrs?.height === "number" && (
              <ImageCropBox
                src={String(imageAttrs.src ?? "")}
                crop={(imageAttrs.crop as ImageCrop | null) ?? null}
                onChange={(crop) => setImageAttr({ crop })}
                labels={{
                  title: labels.imageCrop,
                  help: labels.imageCropHelp,
                  reset: labels.imageCropReset,
                  position: labels.imageCropPosition,
                }}
              />
            )}
            <Stack direction="row" spacing={1} sx={{ justifyContent: "space-between" }}>
              <Button color="error" size="small" onClick={() => editor?.chain().focus().deleteSelection().run()}>
                {labels.imageRemove}
              </Button>
              <Button
                size="small"
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

      {/* The film's own panel (§110): a caption, how wide it is, which side (§266), or remove it. */}
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
            {/*
              The same two questions a picture answers, and the same answers (§266): the film is
              a figure in the text now, so "how big" and "where" are the organizer's to set.
            */}
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
                  // A film floated at the full width leaves no column to write in, so choosing a
                  // side halves it in the same transaction — the picture's own rule.
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
                {IMAGE_ALIGNMENTS.map((align) => (
                  <ToggleButton key={align} value={align} sx={{ minWidth: 56, minHeight: 40 }}>
                    {align === "block" ? labels.imageAlignBlock : align === "left" ? labels.imageAlignLeft : labels.imageAlignRight}
                  </ToggleButton>
                ))}
              </ToggleButtonGroup>
            </Box>
            <Stack direction="row" spacing={1} sx={{ justifyContent: "space-between" }}>
              <Button color="error" size="small" onClick={() => editor?.chain().focus().deleteSelection().run()}>
                {labels.youtubeRemove}
              </Button>
              <Button
                size="small"
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
 * Alignment for a paragraph or a heading (§213; the owner: "centrare / aliniere elemente în rich
 * text editor").
 *
 * ## Why this is eleven lines rather than a package
 *
 * `@tiptap/extension-text-align` is exactly one `addGlobalAttributes` block and a command that
 * calls `updateAttributes`. The standing instruction is to prefer nothing over a dependency
 * (`AGENTS.md` §1.5), and §196 took the table package precisely because *that* one is selection
 * and transform work nobody should re-implement. This is an attribute.
 *
 * ## The two fences
 *
 * **`parseHTML` clamps to the closed set.** A paste from Word or Google Docs carries
 * `text-align: justify`, `start`, `end` or an inherited value, and anything but the three words
 * the schema knows would be a body the server then refuses to save — a refusal the organizer
 * meets at the end of a long edit. Anything unrecognised reads as no alignment at all.
 *
 * **`renderHTML` says nothing for the default**, so the editor's own DOM carries a
 * `text-align` declaration only where somebody chose one — the same discipline the renderer
 * keeps, and the reason the two look identical.
 */
/**
 * The table's own two choices (§263): how it is drawn, and where in a cell the text sits.
 *
 * A global attribute on the `table` node rather than a fork of `TableKit`, which is the same
 * shape `BlockAlign` uses for a paragraph's alignment and needs no package: `addGlobalAttributes`
 * is the documented way to put an attribute on a node another extension owns.
 *
 * **The default emits nothing.** `all` and `top` are what every table already looks like, so a
 * table nobody has restyled writes no attribute at all — its stored JSON stays byte-identical
 * and the editor's own default CSS applies. Only a choice away from the default reaches the DOM,
 * as `data-borders` / `data-valign`, which is what `table-layout.ts` keys the editor's rules on.
 *
 * `parseHTML` validates rather than trusting: the value comes back from the editor's own DOM on
 * an undo or a copy inside the document, and an unknown string there would become an attribute
 * the server's allowlist then refuses — a save that fails for a reason nobody can see.
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
          /* The line colour and the header's fill (§271), the same shape as the two above:
             only a choice away from the default reaches the DOM or the stored JSON. */
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

/**
 * What the borders control shows: the state it is in, in Material's three border glyphs (§361)
 * — the solid grid, the rows alone, and the dotted grid of a table that draws no lines. They
 * replaced the box-drawing characters "▦", "▤" and "▢", which a font draws as it likes.
 */
const TABLE_BORDER_ICON: Record<TableBorders, ComponentType<SvgIconProps>> = {
  all: BorderAllIcon,
  rows: BorderHorizontalIcon,
  none: BorderClearIcon,
};

const ALIGNABLE = ["paragraph", "heading"] as const;

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
 * The YouTube block (§110, §266): an atom, so the caret never enters it; selectable, so a click
 * opens its panel; shown as the film's thumbnail from YouTube's image host with a play mark and
 * the caption beneath — the editor is the backoffice, where a request to Google for a thumbnail
 * is the organizer's own doing, unlike a reader's page, which fetches nothing until pressed.
 *
 * **It carries the picture's two attributes since §266** — how much of the column it takes and
 * which side it sits on — and draws itself at that size here, because a film the organizer sized
 * to half the column and saw full-width in the editor is the editor lying. The width is written
 * as an inline style for the same reason the crop's is: ProseMirror owns this DOM, so there is no
 * `sx` to give it.
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
      // The defaults emit nothing: a film stored before §266 keeps its exact JSON.
      widthPercent: { default: 100 },
      align: { default: "block" },
    };
  },
  parseHTML() {
    return [];
  },
  renderHTML({ node }) {
    const id = String(node.attrs.videoId ?? "");
    const percent = Number(node.attrs.widthPercent ?? 100);
    const align = String(node.attrs.align ?? "block");
    /*
      The page's geometry, in the one form this DOM accepts. A floated film gets the gutter the
      text wraps against on its inner side, which is what `imageFigureSx` does with `mr`/`ml`.
    */
    const box = [
      "position:relative",
      `width:${percent}%`,
      "max-width:100%",
      align === "block" ? "margin:8px auto" : align === "left" ? "float:left;margin:8px 24px 8px 0" : "float:right;margin:8px 0 8px 24px",
    ].join(";");
    return [
      "div",
      { class: "rt-youtube", "data-youtube": id, "data-width": String(percent), "data-align": align, style: box },
      ["img", { src: `https://i.ytimg.com/vi/${id}/hqdefault.jpg`, alt: "", style: "display:block;width:100%;border-radius:4px" }],
      ["span", { style: "position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);font-size:40px;color:#fff;text-shadow:0 0 8px #000" }, "▶"],
      ["div", { style: "font-size:0.875rem;color:#666;text-align:center;margin-top:4px" }, String(node.attrs.caption ?? "")],
    ];
  },
});

/** One stored picture, as `GET /api/admin/media` lists it. */
type StoredPicture = { id: string; src: string; thumb: string; width: number; height: number; name: string };

/** How many pictures the document holds with nothing for a screen reader to say. */
function countMissingAlt(doc: unknown): number {
  const content = (doc as { content?: { type?: string; attrs?: { alt?: unknown } }[] })?.content ?? [];
  return content.filter((node) => node.type === "image" && !String(node.attrs?.alt ?? "").trim()).length;
}

/**
 * Words in a piece of text: runs of anything that is not a space.
 *
 * Deliberately not Tiptap's `CharacterCount`, which is another extension to install and
 * configure for a number this line computes exactly as well (§1.5: prefer nothing).
 */
function countWords(text: string): number {
  const trimmed = text.trim();
  return trimmed === "" ? 0 : trimmed.split(/\s+/).length;
}

/**
 * After a refused submit the body comes back as it was typed (`DECISIONS.md` §315): the
 * recalled JSON is the document, keyed on the answer so Tiptap re-mounts from it rather than
 * keep what it held before the press. With nothing recalled this is the island as it was.
 */
export default function RichTextEditor(props: ComponentProps<typeof RichTextEditorIsland>) {
  const recall = useRecall();
  const recalled = recall.value(props.name);
  return (
    <RichTextEditorIsland
      key={recall.generation}
      {...props}
      initialBody={recalled === undefined ? props.initialBody : recalledJson(recalled, props.initialBody)}
    />
  );
}
