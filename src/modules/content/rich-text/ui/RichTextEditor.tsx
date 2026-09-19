"use client";

import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Paper from "@mui/material/Paper";
import Popper from "@mui/material/Popper";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import ToggleButton from "@mui/material/ToggleButton";
import ToggleButtonGroup from "@mui/material/ToggleButtonGroup";
import Typography from "@mui/material/Typography";
import { Node } from "@tiptap/core";
import Image from "@tiptap/extension-image";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { youtubeVideoId } from "@/modules/events/domain/video";
import { useRef, useState } from "react";
import { shrinkImageInBrowser } from "@/modules/media/browser-shrink";
import { EMPTY_DOC, IMAGE_WIDTH_PERCENTS, readRichText } from "../domain/schema";

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
 * ## The toolbar has words on it, not icons
 *
 * `@mui/icons-material` is a dependency, and this is the only screen in the product that would
 * need it (§1.5: prefer nothing). "B", "I", "H2" and "Listă" are also what a volunteer reads
 * without hovering, and every control carries its own accessible name.
 */
export default function RichTextEditor({
  name,
  initialBody,
  label,
  accessibleSuffix,
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
  /** Translated control names. Passed in, because a client island cannot read the catalogue. */
  labels: {
    bold: string;
    italic: string;
    heading2: string;
    heading3: string;
    bulletList: string;
    orderedList: string;
    quote: string;
    link: string;
    linkUrl: string;
    linkApply: string;
    linkRemove: string;
    linkCancel: string;
    undo: string;
    redo: string;
    image: string;
    imageUploading: string;
    imageFailed: string;
    imageAlt: string;
    imageAltHelp: string;
    imageCaption: string;
    imageSize: string;
    imageRemove: string;
    imageDone: string;
    /**
     * The nag under the editor, one picture and several. Two strings rather than a function:
     * props cross the server boundary, and the client island substitutes the count itself.
     */
    imageNoAltOne: string;
    imageNoAltMany: string;
    imageFromGallery: string;
    /** The two words on the buttons themselves; the long labels are their accessible names. */
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
  const [missingAlt, setMissingAlt] = useState(() => countMissingAlt(initialDoc));
  const fileInputRef = useRef<HTMLInputElement>(null);
  /** The pictures already stored, once asked for: `null` closed, `"loading"`, or the list. */
  const [gallery, setGallery] = useState<null | "loading" | StoredPicture[]>(null);

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
          };
        },
      }),
    ],
    content: initialDoc.content?.length ? initialDoc : EMPTY_DOC,
    // Selection changes must re-render too: the picture panel opens on a click, which changes
    // the selection and nothing else (Tiptap 3 stops re-rendering on transactions by default).
    shouldRerenderOnTransaction: true,
    onUpdate: ({ editor: current }) => {
      setValue(JSON.stringify(current.getJSON()));
      setMissingAlt(countMissingAlt(current.getJSON()));
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
        .setImage({ src: uploaded.src, alt: "", caption: "", width: uploaded.width, height: uploaded.height, widthPercent: 100 } as never)
        .run();
      setImageState("idle");
    } catch {
      setImageState("failed");
    }
  };

  /**
   * The selected picture, when one is: ProseMirror marks the node's own element, and that
   * element is what the panel anchors to. Read on every render — the selection is state the
   * editor owns, and `shouldRerenderOnTransaction` is what keeps this current.
   */
  const selectedImage = editor?.isActive("image")
    ? (editor.view.dom.querySelector("img.ProseMirror-selectednode") as HTMLElement | null)
    : null;
  const imageAttrs = selectedImage ? editor?.getAttributes("image") : undefined;
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
      .setImage({ src: picture.src, alt: "", caption: "", width: picture.width, height: picture.height, widthPercent: 100 } as never)
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

      {/* The value the form posts. Present and correct even before the editor has loaded. */}
      <input type="hidden" name={name} value={value} readOnly />

      <Box sx={{ border: 1, borderColor: "divider", borderRadius: 1 }}>
        <Stack
          direction="row"
          spacing={0.5}
          role="toolbar"
          aria-label={accessibleSuffix ? `${label} — ${accessibleSuffix}` : label}
          sx={{ flexWrap: "wrap", gap: 0.5, p: 0.5, borderBottom: 1, borderColor: "divider" }}
        >
          <Control
            label={labels.bold}
            text="B"
            active={editor?.isActive("bold") ?? false}
            onClick={() => editor?.chain().focus().toggleBold().run()}
            sx={{ fontWeight: 700 }}
          />
          <Control
            label={labels.italic}
            text="I"
            active={editor?.isActive("italic") ?? false}
            onClick={() => editor?.chain().focus().toggleItalic().run()}
            sx={{ fontStyle: "italic" }}
          />
          <Control
            label={labels.heading2}
            text="H2"
            active={editor?.isActive("heading", { level: 2 }) ?? false}
            onClick={() => editor?.chain().focus().toggleHeading({ level: 2 }).run()}
          />
          <Control
            label={labels.heading3}
            text="H3"
            active={editor?.isActive("heading", { level: 3 }) ?? false}
            onClick={() => editor?.chain().focus().toggleHeading({ level: 3 }).run()}
          />
          <Control
            label={labels.bulletList}
            text="•—"
            active={editor?.isActive("bulletList") ?? false}
            onClick={() => editor?.chain().focus().toggleBulletList().run()}
          />
          <Control
            label={labels.orderedList}
            text="1."
            active={editor?.isActive("orderedList") ?? false}
            onClick={() => editor?.chain().focus().toggleOrderedList().run()}
          />
          <Control
            label={labels.quote}
            text="❝"
            active={editor?.isActive("blockquote") ?? false}
            onClick={() => editor?.chain().focus().toggleBlockquote().run()}
          />
          <Control
            label={labels.link}
            text="🔗"
            active={editor?.isActive("link") ?? false}
            onClick={() =>
              setLinkDraft((open) =>
                open === null ? (editor?.getAttributes("link").href ?? "") : null,
              )
            }
          />
          {/* Words, not glyphs: the picture emoji rendered as a broken box on the owner's
              machine (2026-09-18), and two of them side by side read as two broken boxes. */}
          <Control
            label={imageState === "uploading" ? labels.imageUploading : labels.image}
            text={labels.imageShort}
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
          <Control
            label={labels.imageFromGallery}
            text={labels.imageFromGalleryShort}
            active={gallery !== null}
            onClick={() => void openGallery()}
          />
          <Control
            label={labels.youtube}
            text={labels.youtubeShort}
            active={youtubeDraft !== null || (editor?.isActive("youtube") ?? false)}
            onClick={() => {
              setYoutubeInvalid(false);
              setYoutubeDraft((open) => (open === null ? "" : null));
            }}
          />
          <Control
            label={labels.undo}
            text="↶"
            active={false}
            onClick={() => editor?.chain().focus().undo().run()}
          />
          <Control
            label={labels.redo}
            text="↷"
            active={false}
            onClick={() => editor?.chain().focus().redo().run()}
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
            // The writing area itself. A generous minimum, because a page body that looks like a
            // one-line field invites a one-line page.
            "& .tiptap": {
              minHeight: 240,
              p: 2,
              outline: "none",
              "&:focus-visible": { outline: 2, outlineColor: "primary.main", outlineOffset: -2 },
            },
            // A picture is never wider than the column, here as on the page; the selected one
            // is outlined so the panel beside it is plainly about *this* picture.
            "& .tiptap img": {
              display: "block",
              maxWidth: "100%",
              height: "auto",
              mx: "auto",
              my: 2,
              borderRadius: 1,
              cursor: "pointer",
            },
            "& .tiptap img.ProseMirror-selectednode": {
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
          }}
        >
          <EditorContent editor={editor} />
        </Box>
      </Box>

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
        open={Boolean(selectedImage)}
        anchorEl={selectedImage}
        placement="bottom-start"
        modifiers={[{ name: "preventOverflow", options: { altAxis: true, padding: 8 } }]}
        sx={{ zIndex: (theme) => theme.zIndex.modal }}
      >
        <Paper elevation={6} sx={{ p: 1.5, width: 320, maxWidth: "calc(100vw - 32px)" }} data-testid="rich-text-image-panel">
          <Stack spacing={1.5}>
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

      {/* The film's own panel (§110): a caption, or remove it. */}
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
 * The YouTube block (§110): an atom, so the caret never enters it; selectable, so a click opens
 * its panel; shown as the film's thumbnail from YouTube's image host with a play mark and the
 * caption beneath — the editor is the backoffice, where a request to Google for a thumbnail is
 * the organizer's own doing, unlike a reader's page, which fetches nothing until pressed.
 */
const YoutubeNode = Node.create({
  name: "youtube",
  group: "block",
  atom: true,
  selectable: true,
  draggable: true,
  addAttributes() {
    return { videoId: { default: null }, caption: { default: "" } };
  },
  parseHTML() {
    return [];
  },
  renderHTML({ node }) {
    const id = String(node.attrs.videoId ?? "");
    return [
      "div",
      { class: "rt-youtube", "data-youtube": id, style: "position:relative;max-width:480px;margin:8px 0" },
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
 * One toolbar button. `ToggleButton` rather than `IconButton` because these are states, not
 * actions — it renders `aria-pressed`, which is how a screen reader says "bold is on" — and undo
 * and redo pass `active={false}`, which reads as a button that is simply never pressed.
 *
 * `onMouseDown` prevents the default so clicking a control does not first take focus out of the
 * editor: losing the selection would make "bold" apply to nothing.
 */
function Control({
  label,
  text,
  active,
  onClick,
  sx,
}: {
  label: string;
  text: string;
  active: boolean;
  onClick: () => void;
  sx?: Record<string, unknown>;
}) {
  return (
    <ToggleButton
      value={label}
      selected={active}
      aria-label={label}
      title={label}
      size="small"
      onMouseDown={(event) => event.preventDefault()}
      onClick={onClick}
      sx={{ minWidth: 44, minHeight: 44, px: 1, ...sx }}
    >
      {text}
    </ToggleButton>
  );
}
