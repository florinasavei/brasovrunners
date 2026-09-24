"use client";

import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import { type ComponentProps, useState } from "react";
import { BOXED_DISCLOSURE_SX } from "@/shared/ui/disclosure";
import { recalledJson, useRecall } from "@/shared/forms/recall";
import ValidityProxy from "@/shared/forms/ValidityProxy";
import { useTwinFold } from "@/shared/ui/LocaleTabPanels";
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
 * After a refused submit the document is the one that was posted (§315) — typed into the
 * editor, or carried unchanged by the hidden field — keyed on the answer so the fold and the
 * editor inside it re-mount from it. Tens of kilobytes of text, which is why the values come
 * back as the action's returned state and not in a cookie.
 *
 * The summary line carries a `ValidityProxy` for the field: inert until something makes it
 * required — the create page's "Creează și publică", for a summary publication needs — and then
 * the box the browser points its bubble at, since a hidden field cannot be pointed at.
 *
 * **Open in one language, open in the other** (§363; the owner: "I would like to keep the
 * expand/collapsed state while changing the language tab in the event editor"). The fold's state
 * is its strip's (`useTwinFold`), keyed by its name without the language, so the Romanian
 * description and the English one open and close together. The twin that opened behind a hidden
 * tab mounts its editor when its tab comes forward, not before: two Tiptap instances for one
 * press would be §96's cost back, for a language nobody is looking at yet.
 *
 * **Once mounted, the editor stays** — a closed fold hides it, it does not unmount it. Before
 * §363 closing the fold swapped the editor for the hidden field holding the stored document, so
 * text typed, then folded away, was quietly replaced by what the page was loaded with at the
 * save; with the twin closing along with it, that would have been a whole language's typing lost
 * to a click in the other one.
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
  // Mounted the first time the fold is open where it can be seen, and kept (see above). Derived
  // during render — React's "storing information from previous renders" — so the render that opens
  // the fold is the one that draws the editor.
  const [mounted, setMounted] = useState(false);
  if (!mounted && fold.open && fold.shown) setMounted(true);
  const recall = useRecall();
  const stored = readRichText(editor.initialBody);

  return (
    <Box
      component="details"
      /*
        The shared state drives the attribute and the attribute's `toggle` feeds the state: a press
        on the summary, a refusal opening the folds around a box (`revealField`, §336), or the
        twin's change arriving from the other panel all end in one `set`, which is a no-op when the
        value is already there. Absent until something sets it, so the server's HTML is unchanged.
      */
      open={fold.open || undefined}
      onToggle={(event) => fold.setOpen((event.currentTarget as HTMLDetailsElement).open)}
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
        {mounted ? <RichTextEditor {...editor} /> : <input type="hidden" name={editor.name} value={JSON.stringify(stored)} readOnly />}
      </Box>
    </Box>
  );
}
