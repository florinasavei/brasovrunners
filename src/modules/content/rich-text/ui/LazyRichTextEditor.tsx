"use client";

import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import { type ComponentProps, useState } from "react";
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
 */
export default function LazyRichTextEditor({
  summary,
  emptyHint,
  ...editor
}: ComponentProps<typeof RichTextEditor> & { summary: string; emptyHint: string }) {
  const [open, setOpen] = useState(false);
  const stored = readRichText(editor.initialBody);

  return (
    <Box
      component="details"
      onToggle={(event) => setOpen((event.currentTarget as HTMLDetailsElement).open)}
      sx={{ border: 1, borderColor: "divider", borderRadius: 1, px: 1.5, "& > summary": { cursor: "pointer", py: 1.25, minHeight: 44, listStyle: "revert" } }}
    >
      <Typography component="summary" variant="body2" sx={{ fontWeight: 600 }}>
        {summary}
        {isRichTextEmpty(stored) && (
          <Typography component="span" variant="body2" color="text.secondary" sx={{ ml: 1, fontWeight: 400 }}>
            {emptyHint}
          </Typography>
        )}
      </Typography>
      <Box sx={{ pb: 1.5 }}>
        {open ? <RichTextEditor {...editor} /> : <input type="hidden" name={editor.name} value={JSON.stringify(stored)} readOnly />}
      </Box>
    </Box>
  );
}
