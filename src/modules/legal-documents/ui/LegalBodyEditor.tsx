"use client";

import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import ToggleButton from "@mui/material/ToggleButton";
import Typography from "@mui/material/Typography";
import Image from "@tiptap/extension-image";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { type ComponentProps, useState } from "react";
import { useRecall } from "@/shared/forms/recall";
import { editorDocToText, textToEditorDoc } from "../domain/editor-doc";

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
    content: textToEditorDoc(initialText),
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
        <Stack direction="row" spacing={0.5} sx={{ flexWrap: "wrap", gap: 0.5, mb: 1 }}>
          <Control
            label={labels.heading}
            text="H2"
            active={editor?.isActive("heading", { level: 2 }) ?? false}
            onClick={() => editor?.chain().focus().toggleHeading({ level: 2 }).run()}
          />
          <Control
            label={labels.paragraph}
            text="¶"
            active={editor?.isActive("paragraph") ?? false}
            onClick={() => editor?.chain().focus().setParagraph().run()}
          />
          <Control
            label={labels.link}
            text="🔗"
            active={editor?.isActive("link") ?? false}
            onClick={() => setLinkDraft((open) => (open === null ? (editor?.getAttributes("link").href ?? "") : null))}
          />
          <Control
            label={labels.image}
            text="🖼"
            active={imageDraft !== null}
            onClick={() => setImageDraft((open) => (open === null ? { src: "", alt: "" } : null))}
          />
          <Control label={labels.undo} text="↶" active={false} onClick={() => editor?.chain().focus().undo().run()} />
          <Control label={labels.redo} text="↷" active={false} onClick={() => editor?.chain().focus().redo().run()} />
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

        <Box
          sx={{
            "& .tiptap": { minHeight: 280, outline: "none", px: 1, py: 0.5 },
            "& .tiptap p": { my: 1.5, fontSize: "1rem", lineHeight: 1.6 },
            "& .tiptap h2": { fontSize: "1.25rem", mt: 3, mb: 1 },
            "& .tiptap a": { color: "primary.main", textDecoration: "underline" },
            "& .tiptap img": { maxWidth: "100%", height: "auto", borderRadius: 1 },
          }}
        >
          <EditorContent editor={editor} />
        </Box>
      </Paper>
      <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 0.5 }}>
        {help}
      </Typography>
      <input type="hidden" name={name} value={text} readOnly />
    </Box>
  );
}

/** One toolbar button: 44px because this screen is worked on a phone like every other. */
function Control({
  label,
  text,
  active,
  onClick,
}: {
  label: string;
  text: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <ToggleButton
      value={label}
      selected={active}
      aria-label={label}
      title={label}
      size="small"
      // Keeps the caret where it is: a toolbar press must not take the selection with it.
      onMouseDown={(event) => event.preventDefault()}
      onClick={onClick}
      sx={{ minWidth: 44, minHeight: 44, px: 1, lineHeight: 1 }}
    >
      {text}
    </ToggleButton>
  );
}

/**
 * After a refused submit the text comes back as it was typed (`DECISIONS.md` §305): the
 * recalled text is the starting point, keyed on the answer so the island re-mounts from it.
 * A legal body runs to tens of kilobytes, which is why this is the action's returned state
 * and not a cookie.
 */
export default function LegalBodyEditor(props: ComponentProps<typeof LegalBodyEditorIsland>) {
  const recall = useRecall();
  const recalled = recall.value(props.name);
  return <LegalBodyEditorIsland key={recall.generation} {...props} initialText={recalled ?? props.initialText} />;
}
