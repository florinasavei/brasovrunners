"use client";

import AddPhotoAlternateIcon from "@mui/icons-material/AddPhotoAlternate";
import LinkIcon from "@mui/icons-material/Link";
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

/**
 * The writing area's own box: a legal text is long, and a box that looks like a field invites a
 * field's worth of text. One object for the two places that draw it — Tiptap's `.tiptap` and the
 * stand-in shown until Tiptap has mounted — so the two are always the same size (§369, the same
 * pattern as `WRITING_AREA_BOX` in the pages' editor, §362; the two editors' boxes differ, so the
 * pattern is shared and the numbers are each editor's own).
 */
const WRITING_AREA_BOX = { minHeight: 280, px: 1, py: 0.5 } as const;

/** How the body's four kinds of thing are drawn, by the editor and by its stand-in alike. */
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
 * A paragraph's or a heading's runs as the stand-in draws them. A link is an `<a>` with no
 * address — the link's look, nothing to follow or to focus. ProseMirror ends an empty block, and
 * one whose last run is a break, with a break of its own so the line keeps its height; so does
 * this.
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
 * The writing area before Tiptap has mounted (§369; the defect §362's addendum fixed in the pages'
 * editor). Tiptap builds its editor only in the browser, after hydration, and until then this
 * area was an empty `div`, zero pixels tall: the moment it mounted, the English box and "Salvează"
 * under it moved down by the whole text — a prefilled sample measured 4,240 pixels on a desktop
 * and 16,987 on a 320-pixel phone — and a press in that moment landed on the gap.
 *
 * So the stand-in is the text itself, drawn with the editor's own box and the editor's own rules,
 * which makes it as tall as the editor that replaces it rather than merely as tall as an empty
 * one. It is `aria-hidden` and holds nothing to focus, press or follow; it goes in the same render
 * that brings Tiptap's element in, so nothing below moves.
 */
function WritingAreaStandIn({ doc }: { doc: LegalEditorDoc }) {
  // An empty document is one empty paragraph in ProseMirror, a line tall.
  const blocks: readonly LegalBlock[] = doc.content.length > 0 ? doc.content : [{ type: "paragraph" }];
  return (
    <Box
      aria-hidden
      data-testid="legal-body-reserved"
      // The text rules Tiptap injects for `.ProseMirror` — typed spaces keep their width, no ligatures — so a line breaks where the editor's does.
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
 * The editor a legal document is written in (`DECISIONS.md` §279; the owner, 2026-09-22: "this
 * declaration must be WYSIWYG").
 *
 * ## Why this is its own island and not the pages' editor
 *
 * `content/rich-text/ui/RichTextEditor.tsx` writes Tiptap JSON into its hidden field, and a
 * legal document does not store Tiptap JSON — it stores `{ sections: [{ heading?, paragraphs }] }`,
 * which is what is hashed, approved, merged per participant and drawn into the PDF they sign
 * (`editor-doc.ts` argues why that must not change). Threading a second serializer and a second
 * toolbar allowlist through sixteen hundred lines written for a page would make both harder to
 * read than two files that each do one thing (`AGENTS.md` §1.5, rules 2 and 3).
 *
 * ## What it offers, and why so little
 *
 * A heading, a paragraph, a line break, a link and a picture — exactly what the stored format
 * carries. **Bold, italic and lists are deliberately absent**: the body has nowhere to put them,
 * so a button for them would produce formatting that the save silently drops. What the club sees
 * here is what the public page and the signed PDF will show, which is the whole ask.
 *
 * ## How it reaches the server
 *
 * A hidden input holds the same `## Heading` / blank-line / `[words](url)` text the textarea
 * posted, under the same field name, updated on every keystroke. The Server Action, the
 * validation, the hash and the PDF are untouched. If this island never mounts, the hidden input
 * still carries the text it was handed, so a save writes the document back unchanged rather than
 * blanking a legal text.
 */
function LegalBodyEditorIsland({
  name,
  initialText,
  label,
  accessibleSuffix,
  help,
  labels,
}: {
  /** The form field the text is posted as — the same name the textarea used. */
  name: string;
  /** The stored body as text, from `bodyToText`. */
  initialText: string;
  label: string;
  /** Which language this is, for the accessible name: two editors sit on the same screen. */
  accessibleSuffix?: string;
  help: string;
  /** Translated control names. Passed in, because a client island cannot read the catalogue. */
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
  // The document the editor opens, read once: Tiptap takes it at creation and the stand-in draws it until then.
  const [initialDoc] = useState(() => textToEditorDoc(initialText));
  const [linkDraft, setLinkDraft] = useState<string | null>(null);
  const [imageDraft, setImageDraft] = useState<{ src: string; alt: string } | null>(null);
  const [imageInvalid, setImageInvalid] = useState(false);
  const accessibleName = accessibleSuffix ? `${label} — ${accessibleSuffix}` : label;

  const editor = useEditor({
    // Next renders this tree on the server first and Tiptap needs a DOM; without this the
    // editor is built during SSR and hydration mismatches.
    immediatelyRender: false,
    extensions: [
      StarterKit.configure({
        /*
          Stated as what StarterKit ships that a legal body does not have a place for. Every one
          of these would be a button whose result `editorDocToText` throws away — worse than no
          button, because the club would believe the document says something it does not.
        */
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
        // The one thing a page's editor turns off and this one needs: an address or a signature
        // block is one paragraph with the breaks the author typed (`body-text.ts`).
        hardBreak: {},
        heading: { levels: [2] },
        link: {
          // A click inside the editor should move the caret, not leave the form.
          openOnClick: false,
          protocols: ["http", "https", "mailto"],
        },
      }),
      /*
        A picture is written `![alt](https://…)` in the stored text and drawn as a picture here.
        `allowBase64` is off and there is no upload: the address is typed, https only, which is
        the same rule `inline.ts` enforces when the page reads it back.
      */
      Image.configure({ allowBase64: false, inline: false }),
    ],
    content: initialDoc,
    onUpdate: ({ editor: current }) => setText(editorDocToText(current.getJSON())),
    // The name belongs on the element somebody's cursor lands in — ProseMirror owns that DOM, so
    // it is set here rather than on the React wrapper, where a screen reader would not find it.
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
        {/*
          Material glyphs, one face for all (§361; the owner, of the picture's emoji: "I hate this
          image icon!"). The heading and the paragraph keep words — "H2" and "Text" are the pair
          every word processor's style list offers — because the glyphs Material has for "a block
          of text" are lines of text, which is what "align left" looks like in the pages' editor.
        */}
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
            <Button onClick={applyImage}>{labels.imageApply}</Button>
            <Button color="inherit" onClick={() => setImageDraft(null)}>
              {labels.imageCancel}
            </Button>
          </Stack>
        )}

        {/* The writing area itself (`WRITING_AREA_BOX`, `WRITING_AREA_TEXT`), and its stand-in until Tiptap has mounted. */}
        <Box sx={{ "& .tiptap": { ...WRITING_AREA_BOX, ...WRITING_AREA_TEXT, outline: "none" } }}>
          {!editor && <WritingAreaStandIn doc={initialDoc} />}
          <EditorContent editor={editor} />
        </Box>
      </Paper>
      <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 0.5 }}>
        {help}
      </Typography>
      <input type="hidden" name={name} value={text} readOnly />
      {/* A legal text is never saved empty (`service.ts#assertTranslationsUsable`), so the browser
          refuses an empty one first, with its bubble at this box — a hidden field cannot carry
          the constraint (§315). */}
      <ValidityProxy name={name} label={accessibleName} required={text.trim() === ""} />
    </Box>
  );
}

/**
 * After a refused submit the text comes back as it was typed (`DECISIONS.md` §315): the
 * recalled text is the starting point, keyed on the answer so the island re-mounts from it.
 * A legal body runs to tens of kilobytes, which is why this is the action's returned state
 * and not a cookie.
 */
export default function LegalBodyEditor(props: ComponentProps<typeof LegalBodyEditorIsland>) {
  const recall = useRecall();
  const recalled = recall.value(props.name);
  return <LegalBodyEditorIsland key={recall.generation} {...props} initialText={recalled ?? props.initialText} />;
}
