"use client";

import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import { type ComponentProps, useState } from "react";
import { BOXED_DISCLOSURE_SX } from "@/shared/ui/disclosure";
import { recalledJson, useRecall } from "@/shared/forms/recall";
import ValidityProxy from "@/shared/forms/ValidityProxy";
import { isRichTextEmpty, readRichText } from "../domain/schema";
import RichTextEditor from "./RichTextEditor";

/**
 * A rich-text editor that mounts only when its section is opened (`DECISIONS.md` §96).
 *
 * The event editor carries the description, the short description and the rules in each of
 * two languages: six Tiptap instances if all mount at once, which is what made the editor
 * take seconds to become interactive on a phone. The rules are the one most organizers never
 * write, so they sit behind a summary; until it is opened, the stored document is posted as is
 * from a hidden field, so a save that never touched the rules never changes them either.
 *
 * After a refused submit the document is the one that was posted (§306) — typed into the
 * editor, or carried unchanged by the hidden field — keyed on the answer so the fold and the
 * editor inside it re-mount from it. Tens of kilobytes of text, which is why the values come
 * back as the action's returned state and not in a cookie.
 *
 * The summary line carries a `ValidityProxy` for the field: inert until something makes it
 * required — the create page's "Creează și publică", for a summary publication needs — and then
 * the box the browser points its bubble at, since a hidden field cannot be pointed at.
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
  const [open, setOpen] = useState(false);
  const recall = useRecall();
  const stored = readRichText(editor.initialBody);

  return (
    <Box
      component="details"
      onToggle={(event) => setOpen((event.currentTarget as HTMLDetailsElement).open)}
      sx={BOXED_DISCLOSURE_SX}
      data-rich-text-fold={editor.name}
      id={recall.idOf(editor.name)}
    >
      <Typography component="summary" variant="body2" sx={{ fontWeight: 600 }}>
        <ValidityProxy name={editor.name} label={summary} />
        {summary}
        {isRichTextEmpty(stored) && (
          <Typography component="span" variant="body2" color="text.secondary" sx={{ ml: 1, fontWeight: 400 }}>
            {emptyHint}
          </Typography>
        )}
      </Typography>
      <Box>
        {open ? <RichTextEditor {...editor} /> : <input type="hidden" name={editor.name} value={JSON.stringify(stored)} readOnly />}
      </Box>
    </Box>
  );
}
