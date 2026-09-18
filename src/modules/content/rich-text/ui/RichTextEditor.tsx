"use client";

import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import ToggleButton from "@mui/material/ToggleButton";
import Typography from "@mui/material/Typography";
import Image from "@tiptap/extension-image";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { useRef, useState } from "react";
import { shrinkImageInBrowser } from "@/modules/media/browser-shrink";
import { EMPTY_DOC, readRichText } from "../domain/schema";

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
  };
}) {
  const initialDoc = readRichText(initialBody);
  const [value, setValue] = useState(() => JSON.stringify(initialDoc));
  const [linkDraft, setLinkDraft] = useState<string | null>(null);
  const [imageState, setImageState] = useState<"idle" | "uploading" | "failed">("idle");
  const fileInputRef = useRef<HTMLInputElement>(null);

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
       * Pictures between paragraphs (§72): a block, never inline, with the stored variant's
       * size carried so the page reserves the space. The address comes from the upload route
       * alone — there is no "paste a URL" path, because the server refuses any other.
       */
      Image.configure({ inline: false, allowBase64: false }).extend({
        addAttributes() {
          return {
            src: { default: null },
            alt: { default: "" },
            width: { default: null },
            height: { default: null },
          };
        },
      }),
    ],
    content: initialDoc.content?.length ? initialDoc : EMPTY_DOC,
    onUpdate: ({ editor: current }) => setValue(JSON.stringify(current.getJSON())),
    editorProps: {
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
      editor
        ?.chain()
        .focus()
        .setImage({ src: uploaded.src, alt: file.name.replace(/\.[^.]+$/, ""), width: uploaded.width, height: uploaded.height } as never)
        .run();
      setImageState("idle");
    } catch {
      setImageState("failed");
    }
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
          <Control
            label={imageState === "uploading" ? labels.imageUploading : labels.image}
            text="🖼"
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

        {imageState !== "idle" && (
          <Typography variant="body2" color={imageState === "failed" ? "error" : "text.secondary"} sx={{ px: 1, py: 0.5 }}>
            {imageState === "failed" ? labels.imageFailed : labels.imageUploading}
          </Typography>
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
    </Box>
  );
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
