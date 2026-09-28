"use client";

import EditNoteIcon from "@mui/icons-material/EditNote";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import { type ComponentProps, useEffect, useRef, useState } from "react";
import { BOXED_DISCLOSURE_SX, FOLD_GLYPH_SX } from "@/shared/ui/disclosure";
import { recalledJson, useRecall } from "@/shared/forms/recall";
import ValidityProxy from "@/shared/forms/ValidityProxy";
import { useTwinFold } from "@/shared/ui/LocaleTabPanels";
import { isRichTextEmpty, readRichText, type RichTextDoc } from "../domain/schema";
import { fillIsFor, RICH_TEXT_FILL_EVENT, type RichTextFillDetail } from "./fill-event";
import RichTextEditor from "./RichTextEditor";

/**
 * A rich-text editor that mounts only when its fold first opens (§96): six Tiptap instances at
 * once made the event editor slow on a phone. Until then a hidden field posts the stored document
 * unchanged. After a refused submit it re-mounts from the posted document (§315).
 *
 * The `ValidityProxy` gives the browser's bubble a target, since a hidden field cannot have one.
 * The fold's state is shared with its other-language twin (`useTwinFold`, §363), but a twin
 * mounts only when its tab is shown. Once mounted the editor stays: unmounting would drop typed
 * text in favour of the stored document.
 */
export default function LazyRichTextEditor(props: ComponentProps<typeof RichTextEditor> & { summary: string; emptyHint: string }) {
  const recall = useRecall();
  const recalled = recall.value(props.name);
  return (
    <LazyRichTextEditorIsland
      key={recall.generation}
      {...props}
      initialBody={recalled === undefined ? props.initialBody : recalledJson(recalled, props.initialBody)}
    />
  );
}

function LazyRichTextEditorIsland({
  summary,
  emptyHint,
  ...editor
}: ComponentProps<typeof RichTextEditor> & { summary: string; emptyHint: string }) {
  const fold = useTwinFold(editor.name);
  // Derived during render, so the render that opens the fold draws the editor.
  const [mounted, setMounted] = useState(false);
  if (!mounted && fold.open && fold.shown) setMounted(true);
  const recall = useRecall();
  // A translation that arrived while the fold was shut (§464); once mounted, the editor listens itself.
  const [filled, setFilled] = useState<RichTextDoc | null>(null);
  const hidden = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (mounted) return;
    const onFill = (event: Event) => {
      const detail = (event as CustomEvent<RichTextFillDetail>).detail;
      if (fillIsFor(detail, editor.name, hidden.current)) setFilled(detail.doc);
    };
    window.addEventListener(RICH_TEXT_FILL_EVENT, onFill);
    return () => window.removeEventListener(RICH_TEXT_FILL_EVENT, onFill);
  }, [mounted, editor.name]);
  // §350's tab marks re-read the form on `input`.
  useEffect(() => {
    if (filled) hidden.current?.dispatchEvent(new Event("input", { bubbles: true }));
  }, [filled]);
  const stored = filled ?? readRichText(editor.initialBody);

  return (
    <Box
      component="details"
      /*
        State drives the attribute and `toggle` feeds the state back (a press, `revealField` §336,
        the twin); a repeated `set` is a no-op. Absent until set, so the server HTML is unchanged.
      */
      open={fold.open || undefined}
      onToggle={(event) => fold.setOpen((event.currentTarget as HTMLDetailsElement).open)}
      sx={BOXED_DISCLOSURE_SX}
      data-rich-text-fold={editor.name}
      id={recall.idOf(editor.name)}
    >
      <Typography component="summary" variant="body2" sx={{ fontWeight: 600 }}>
        <ValidityProxy name={editor.name} label={summary} />
        <EditNoteIcon aria-hidden sx={FOLD_GLYPH_SX} />
        {summary}
        {isRichTextEmpty(stored) && (
          <Typography component="span" variant="body2" color="text.secondary" sx={{ ml: 1, fontWeight: 400 }}>
            {emptyHint}
          </Typography>
        )}
      </Typography>
      <Box>
        {mounted ? (
          // `override`, not `initialBody`: otherwise a recalled document drops a pending translation.
          <RichTextEditor {...editor} override={filled} />
        ) : (
          <input ref={hidden} type="hidden" name={editor.name} value={JSON.stringify(stored)} readOnly />
        )}
      </Box>
    </Box>
  );
}
