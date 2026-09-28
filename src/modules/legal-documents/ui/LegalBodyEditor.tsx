"use client";

import AddPhotoAlternateIcon from "@mui/icons-material/AddPhotoAlternate";
import CheckIcon from "@mui/icons-material/Check";
import CloseIcon from "@mui/icons-material/Close";
import LinkIcon from "@mui/icons-material/Link";
import LinkOffIcon from "@mui/icons-material/LinkOff";
import RedoIcon from "@mui/icons-material/Redo";
import UndoIcon from "@mui/icons-material/Undo";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import Image from "@tiptap/extension-image";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { type ComponentProps, Fragment, type ReactNode, useState } from "react";
import { useRecall } from "@/shared/forms/recall";
import ValidityProxy from "@/shared/forms/ValidityProxy";
import ToolbarButton from "@/shared/ui/ToolbarButton";
import { editorDocToText, type LegalBlock, type LegalEditorDoc, type LegalInline, textToEditorDoc } from "../domain/editor-doc";

/** Shared by Tiptap's `.tiptap` and the pre-mount stand-in so both are the same size (§362, §369). */
const WRITING_AREA_BOX = { minHeight: 280, px: 1, py: 0.5 } as const;

/** Shared by the editor and its stand-in. */
const WRITING_AREA_TEXT = {
  "& p": { my: 1.5, fontSize: "1rem", lineHeight: 1.6 },
  "& h2": { fontSize: "1.25rem", mt: 3, mb: 1 },
  "& a": { color: "primary.main", textDecoration: "underline" },
  "& img": { maxWidth: "100%", height: "auto", borderRadius: 1 },
} as const;

/** What `@tiptap/core` injects for every `.ProseMirror` element, which the stand-in is not. */
const PROSEMIRROR_TEXT = {
  whiteSpace: "break-spaces",
  overflowWrap: "break-word",
  fontVariantLigatures: "none",
  fontFeatureSettings: '"liga" 0',
} as const;

/**
 * Runs as the stand-in draws them: a link is an `<a>` with no address (nothing to follow or focus),
 * and a trailing `<br>` keeps an empty or break-ended line's height, as ProseMirror does.
 */
function standInRuns(runs: readonly LegalInline[] = []): ReactNode[] {
  const drawn: ReactNode[] = runs.map((run, index) => {
    if (run.type === "hardBreak") return <br key={index} />;
    if (run.marks?.some((mark) => mark.type === "link")) return <a key={index}>{run.text}</a>;
    return <Fragment key={index}>{run.text}</Fragment>;
  });
  if (runs.length === 0 || runs[runs.length - 1].type === "hardBreak") drawn.push(<br key="trailing" />);
  return drawn;
}

/**
 * The text drawn with the editor's own rules until Tiptap mounts after hydration, so nothing below
 * jumps by the text's height when it does (§362, §369). `aria-hidden`, nothing to focus; replaced
 * in the same render that brings Tiptap in.
 */
function WritingAreaStandIn({ doc }: { doc: LegalEditorDoc }) {
  // An empty document is one empty paragraph in ProseMirror, a line tall.
  const blocks: readonly LegalBlock[] = doc.content.length > 0 ? doc.content : [{ type: "paragraph" }];
  return (
    <Box
      aria-hidden
      data-testid="legal-body-reserved"
      // Tiptap's `.ProseMirror` text rules, so lines break where the editor's do.
      sx={{ ...WRITING_AREA_BOX, ...WRITING_AREA_TEXT, ...PROSEMIRROR_TEXT }}
    >
      {blocks.map((block, index) => {
        if (block.type === "heading") return <h2 key={index}>{standInRuns(block.content)}</h2>;
        if (block.type === "image") {
          // eslint-disable-next-line @next/next/no-img-element -- the same address the editor draws a moment later, at its natural size
          return <img key={index} src={block.attrs.src} alt={block.attrs.alt} />;
        }
        return <p key={index}>{standInRuns(block.content)}</p>;
      })}
    </Box>
  );
}

/**
 * The WYSIWYG legal editor (§279). Separate from the pages' `RichTextEditor`, which stores Tiptap
 * JSON; this one offers only what the stored format carries (see `editor-doc.ts`). A hidden input
 * posts the plain text; if the island never mounts it still holds the text it was given, so a
 * save never blanks a legal text.
 */
function LegalBodyEditorIsland({
  name,
  initialText,
  label,
  accessibleSuffix,
  help,
  labels,
}: {
  name: string;
  /** From `bodyToText`. */
  initialText: string;
  label: string;
  /** For the accessible name: two editors share the screen. */
  accessibleSuffix?: string;
  help: string;
  /** Translated, since a client island cannot read the catalogue. */
  labels: {
    heading: string;
    paragraph: string;
    /** The word on the paragraph button (§361): "Text", beside "H2". */
    paragraphShort: string;
    link: string;
    linkUrl: string;
    linkApply: string;
    linkRemove: string;
    linkCancel: string;
    image: string;
    imageUrl: string;
    imageAlt: string;
    imageApply: string;
    imageCancel: string;
    imageInvalid: string;
    undo: string;
    redo: string;
  };
}) {
  const [text, setText] = useState(initialText);
  // Read once: Tiptap takes it at creation, the stand-in draws it until then.
  const [initialDoc] = useState(() => textToEditorDoc(initialText));
  const [linkDraft, setLinkDraft] = useState<string | null>(null);
  const [imageDraft, setImageDraft] = useState<{ src: string; alt: string } | null>(null);
  const [imageInvalid, setImageInvalid] = useState(false);
  const accessibleName = accessibleSuffix ? `${label} — ${accessibleSuffix}` : label;

  const editor = useEditor({
    // Tiptap needs a DOM; building during SSR causes a hydration mismatch.
    immediatelyRender: false,
    extensions: [
      StarterKit.configure({
        // What StarterKit ships that the stored body cannot hold; `editorDocToText` would drop it.
        bold: false,
        italic: false,
        strike: false,
        underline: false,
        code: false,
        codeBlock: false,
        blockquote: false,
        bulletList: false,
        orderedList: false,
        listItem: false,
        horizontalRule: false,
        // An address is one paragraph with the author's breaks (`body-text.ts`).
        hardBreak: {},
        heading: { levels: [2] },
        link: {
          openOnClick: false,
          protocols: ["http", "https", "mailto"],
        },
      }),
      // No base64 and no upload: a typed https address, the rule `inline.ts` enforces.
      Image.configure({ allowBase64: false, inline: false }),
    ],
    content: initialDoc,
    onUpdate: ({ editor: current }) => setText(editorDocToText(current.getJSON())),
    // On ProseMirror's own element, where a screen reader finds it, not the React wrapper.
    editorProps: { attributes: { "aria-label": accessibleName, role: "textbox" } },
  });

  const applyLink = () => {
    const href = (linkDraft ?? "").trim();
    if (href === "") editor?.chain().focus().extendMarkRange("link").unsetLink().run();
    else editor?.chain().focus().extendMarkRange("link").setLink({ href }).run();
    setLinkDraft(null);
  };

  const applyImage = () => {
    const src = (imageDraft?.src ?? "").trim();
    if (!/^https:\/\//i.test(src)) {
      setImageInvalid(true);
      return;
    }
    editor?.chain().focus().setImage({ src, alt: (imageDraft?.alt ?? "").trim() }).run();
    setImageDraft(null);
    setImageInvalid(false);
  };

  return (
    <Box>
      <Typography variant="body2" sx={{ fontWeight: 600, mb: 0.5 }}>
        {label}
      </Typography>
      <Paper variant="outlined" sx={{ p: 1 }}>
        {/* Material glyphs (§361); heading and paragraph keep the words "H2" and "Text". */}
        <Stack direction="row" spacing={0.5} role="toolbar" aria-label={accessibleName} sx={{ flexWrap: "wrap", gap: 0.5, mb: 1 }}>
          <ToolbarButton
            label={labels.heading}
            text="H2"
            active={editor?.isActive("heading", { level: 2 }) ?? false}
            onClick={() => editor?.chain().focus().toggleHeading({ level: 2 }).run()}
          />
          <ToolbarButton
            label={labels.paragraph}
            text={labels.paragraphShort}
            active={editor?.isActive("paragraph") ?? false}
            onClick={() => editor?.chain().focus().setParagraph().run()}
          />
          <ToolbarButton
            label={labels.link}
            icon={LinkIcon}
            active={editor?.isActive("link") ?? false}
            onClick={() => setLinkDraft((open) => (open === null ? (editor?.getAttributes("link").href ?? "") : null))}
          />
          <ToolbarButton
            label={labels.image}
            icon={AddPhotoAlternateIcon}
            active={imageDraft !== null}
            onClick={() => setImageDraft((open) => (open === null ? { src: "", alt: "" } : null))}
          />
          <ToolbarButton label={labels.undo} icon={UndoIcon} active={false} onClick={() => editor?.chain().focus().undo().run()} />
          <ToolbarButton label={labels.redo} icon={RedoIcon} active={false} onClick={() => editor?.chain().focus().redo().run()} />
        </Stack>

        {linkDraft !== null && (
          <Stack direction="row" spacing={1} sx={{ mb: 1, flexWrap: "wrap", gap: 1 }}>
            <TextField
              size="small"
              autoFocus
              label={labels.linkUrl}
              value={linkDraft}
              onChange={(event) => setLinkDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  applyLink();
                }
                if (event.key === "Escape") setLinkDraft(null);
              }}
              sx={{ flexGrow: 1, minWidth: 220 }}
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

        {imageDraft !== null && (
          <Stack direction="row" spacing={1} sx={{ mb: 1, flexWrap: "wrap", gap: 1 }}>
            <TextField
              size="small"
              autoFocus
              label={labels.imageUrl}
              value={imageDraft.src}
              error={imageInvalid}
              helperText={imageInvalid ? labels.imageInvalid : undefined}
              onChange={(event) => {
                setImageInvalid(false);
                setImageDraft((draft) => ({ src: event.target.value, alt: draft?.alt ?? "" }));
              }}
              sx={{ flexGrow: 1, minWidth: 220 }}
            />
            <TextField
              size="small"
              label={labels.imageAlt}
              value={imageDraft.alt}
              onChange={(event) => setImageDraft((draft) => ({ src: draft?.src ?? "", alt: event.target.value }))}
              sx={{ minWidth: 180 }}
            />
            <Button onClick={applyImage} startIcon={<CheckIcon fontSize="small" />}>
              {labels.imageApply}
            </Button>
            <Button color="inherit" onClick={() => setImageDraft(null)} startIcon={<CloseIcon fontSize="small" />}>
              {labels.imageCancel}
            </Button>
          </Stack>
        )}

        <Box sx={{ "& .tiptap": { ...WRITING_AREA_BOX, ...WRITING_AREA_TEXT, outline: "none" } }}>
          {!editor && <WritingAreaStandIn doc={initialDoc} />}
          <EditorContent editor={editor} />
        </Box>
      </Paper>
      <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 0.5 }}>
        {help}
      </Typography>
      <input type="hidden" name={name} value={text} readOnly />
      {/* The browser refuses an empty text at this box; a hidden field cannot carry `required` (§315). */}
      <ValidityProxy name={name} label={accessibleName} required={text.trim() === ""} />
    </Box>
  );
}

/** After a refused submit the typed text comes back through the action's state, re-keyed to re-mount (§315). */
export default function LegalBodyEditor(props: ComponentProps<typeof LegalBodyEditorIsland>) {
  const recall = useRecall();
  const recalled = recall.value(props.name);
  return <LegalBodyEditorIsland key={recall.generation} {...props} initialText={recalled ?? props.initialText} />;
}
