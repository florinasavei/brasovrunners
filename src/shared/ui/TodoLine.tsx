import Box from "@mui/material/Box";
import type { ComponentProps, ReactNode } from "react";
import { ACTION_ICONS } from "./action-icons";
import GlyphButton from "./GlyphButton";
import { LINE_SX, PENCIL_SX, ROW_SX, SUMMARY_SX } from "./row-fold";

/** The glyph drawn here as a component, by name from the verbs' registry (§318): a Server Component may render one, never pass one. */
const PencilIcon = ACTION_ICONS.edit;

/** The tick: a 44-pixel square, the glyph alone and larger (its words are its accessible name and its tooltip). */
const TICK_SX = { minWidth: 44, width: 44, height: 44, p: 0, borderRadius: 1, "& .MuiButton-startIcon": { m: 0 }, "& .MuiButton-startIcon > *:nth-of-type(1)": { fontSize: 24 } } as const;

/** A reader's line: the words and the facts, no tick and no pencil — nothing on it is a control. */
const READ_LINE_SX = { ...LINE_SX, gridTemplateColumns: { xs: "minmax(0, 1fr)", sm: "minmax(0, 1fr) auto" }, gridTemplateAreas: { xs: '"words" "facts"', sm: '"words facts"' } } as const;

type Props = {
  /** The row's address (`#…`): the backoffice shell's `OpenFoldFromHash` (§336) opens the folds around it on arrival. */
  id?: string;
  /** The testids' stem: `<stem>-item` on the row, `<stem>-tick-form`, `<stem>-edit` (the fold) and `<stem>-edit-toggle` (its line). */
  testIdPrefix: string;
  /** The line's id, posted by the tick as `itemId` and drawn as `data-item-id`. */
  itemId: string;
  done: boolean;
  /** The words' column (`gridArea: "words"`): the line's text and, once ticked, who ticked it. */
  words: ReactNode;
  /** The facts' column (`gridArea: "facts"`): the chips. */
  facts: ReactNode;
  /** What a person who may write the list gets: the tick, and the line as the summary of its fold. Absent, the row is a reader's. */
  edit?: {
    /** The tick's Server Action: it posts `itemId` and the state it wants, `done` = `1` or `0` — never a toggle. */
    tickAction: NonNullable<ComponentProps<"form">["action"]>;
    /** The hidden fields every form of the list carries (the language, the filter to keep). */
    hidden: ReactNode;
    /** The tick's accessible name, naming the line («Bifează: …»), and its one word as the tooltip («Bifează»). */
    tickLabel: string;
    tickTitle: string;
    /** The fold's key: the line's words, so a save that changed them draws the fold closed. */
    foldKey: string;
    /** The line's tooltip, the verb its pencil stands for («Modifică»). */
    foldTitle: string;
    /** The fold's body: the line's boxes, then its delete. */
    body: ReactNode;
  };
};

/**
 * One line of a to-do list (§749, drawn by §752; shared by §842's wave 2): the event's «Sarcini» and the club's «De făcut» are
 * the same row, so the two read alike. A tick box, then the line in words — the text, the small facts on the right and the pencil
 * — which is the `<summary>` of the line's own fold (`row-fold.ts`): a press anywhere on it opens the boxes in place.
 *
 * The tick is a form of its own that posts the state it wants (`done` = `1` or `0`), so it works with scripts off and two people
 * ticking the same line never undo each other. It sits beside the fold, never inside it: HTML forms do not nest, and the tick is
 * one press on a closed line. A reader's row is the line alone — no tick, no pencil, nothing that looks like a control.
 *
 * A Server Component of plain forms; the actions behind it decide by role (BR-REQ-060-01), whatever this draws.
 */
export default function TodoLine({ id, testIdPrefix, itemId, done, words, facts, edit }: Props) {
  if (!edit) {
    return (
      <Box component="li" id={id} data-testid={`${testIdPrefix}-item`} data-item-id={itemId} sx={ROW_SX}>
        <Box sx={READ_LINE_SX}>
          {words}
          {facts}
        </Box>
      </Box>
    );
  }

  return (
    <Box component="li" id={id} data-testid={`${testIdPrefix}-item`} data-item-id={itemId} sx={{ ...ROW_SX, display: "flex", alignItems: "flex-start", gap: 0.5 }}>
      {/* The tick posts the state it wants, not a toggle: a form, so it works with scripts off. */}
      <Box component="form" action={edit.tickAction} sx={{ flex: "none" }} data-testid={`${testIdPrefix}-tick-form`}>
        {edit.hidden}
        <input type="hidden" name="itemId" value={itemId} />
        <input type="hidden" name="done" value={done ? "0" : "1"} />
        <GlyphButton
          type="submit"
          icon={done ? "tickOn" : "tickOff"}
          role="checkbox"
          aria-checked={done}
          aria-label={edit.tickLabel}
          title={edit.tickTitle}
          color={done ? "success" : "inherit"}
          sx={TICK_SX}
        />
      </Box>
      {/* The row's line is the summary of its edit form: a press anywhere on it, or on the pencil, opens it in place.
          Keyed on the words, so a save that changed them draws the fold closed. */}
      <Box component="details" key={edit.foldKey} data-testid={`${testIdPrefix}-edit`} sx={{ flex: 1, minWidth: 0 }}>
        <Box component="summary" title={edit.foldTitle} data-testid={`${testIdPrefix}-edit-toggle`} sx={SUMMARY_SX}>
          {words}
          {facts}
          <PencilIcon aria-hidden fontSize="small" sx={PENCIL_SX} />
        </Box>
        {edit.body}
      </Box>
    </Box>
  );
}
