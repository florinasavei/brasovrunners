"use client";

import AddCircleIcon from "@mui/icons-material/AddCircle";
import RemoveCircleIcon from "@mui/icons-material/RemoveCircle";
import Box from "@mui/material/Box";
import type { SvgIconProps } from "@mui/material/SvgIcon";
import ToggleButton from "@mui/material/ToggleButton";
import Tooltip from "@mui/material/Tooltip";
import type { ComponentType } from "react";

/** The size every glyph on an editor's toolbar is drawn at; a text label fills the same line. */
export const TOOLBAR_GLYPH_PX = 20;

/** What a button shows: a Material glyph, or — for the few things a short word says best — the word. */
type Face =
  | {
      /**
       * The glyph, as the component itself: one file per glyph from `@mui/icons-material`, never
       * the barrel (§90). A component and not an element, so every button draws it the same size
       * — and a component, not a name, because the two editors that use this are client islands
       * already: nothing crosses the server boundary here (`action-icons.ts` is for the buttons a
       * Server Component renders).
       */
      icon: ComponentType<SvgIconProps>;
      /**
       * A small plus or minus badge in the glyph's corner: "add a row" is the rows glyph with a plus,
       * "delete the column" the columns glyph with a minus. Material has no glyph of its own for
       * the four table verbs, and four different pictures for two verbs on two things would be
       * four things to learn instead of two.
       */
      mark?: "add" | "remove";
      text?: never;
    }
  | {
      /** "H2", "H3", "Text": a heading level is read faster as its name than as any picture. */
      text: string;
      icon?: never;
      mark?: never;
    };

/**
 * One button on a text editor's toolbar, on the bar over a selection, or on a table's bar — the
 * pages' editor and the legal documents' editor alike (§NNN; the owner, of `/admin/legal`'s
 * toolbar, 2026-09-24: "I hate this image icon!").
 *
 * The toolbars drew their buttons from characters — "🔗", "🖼", "↶", "⊞", "+↓" — and an emoji is
 * whatever the reader's system font makes of it: a tiny grey picture on Windows, a broken box on
 * the owner's machine once (the reason the pages' editor fell back to words in 2026-09-18), and
 * the arrows and box-drawing characters read as noise. A Material glyph is the same picture on
 * every machine, at a size this component chooses.
 *
 * **One face for every button.** Glyphs at `TOOLBAR_GLYPH_PX`, in the button's own colour —
 * MUI's `action.active`, the text colour once pressed — and a text label in the same colour at
 * the glyph's height, so "H2" beside the bold glyph reads as one row. 44 px square at least,
 * because these screens are worked on a phone too (BR-REQ-041-01 criterion 6).
 *
 * **The name is said three ways**: `aria-label` for a screen reader, and a tooltip for everyone
 * else — on hover with a mouse, on a long press with a thumb (MUI's `enterTouchDelay`). The
 * tooltip is `disableInteractive`: it never takes the pointer, so it cannot sit over the next
 * button in a wrapped row and swallow the click meant for it.
 *
 * `ToggleButton` rather than `IconButton` because most of these are states, not actions — it
 * renders `aria-pressed`, which is how a screen reader says "bold is on" — and undo or redo pass
 * `active={false}`, which reads as a button that is simply never pressed. `onMouseDown` prevents
 * the default so a press does not first take focus out of the editor: losing the selection would
 * make "bold" apply to nothing.
 */
export default function ToolbarButton({
  label,
  active,
  onClick,
  ...face
}: {
  /** The control's full name: its accessible name and its tooltip. */
  label: string;
  active: boolean;
  onClick: () => void;
} & Face) {
  const Icon = face.icon;
  const Mark = face.mark === "add" ? AddCircleIcon : face.mark === "remove" ? RemoveCircleIcon : null;
  return (
    <Tooltip title={label} disableInteractive>
      <ToggleButton
        value={label}
        selected={active}
        aria-label={label}
        size="small"
        onMouseDown={(event) => event.preventDefault()}
        onClick={onClick}
        sx={{ minWidth: 44, minHeight: 44, px: 1, lineHeight: 1 }}
      >
        {Icon ? (
          <Box component="span" sx={{ position: "relative", display: "inline-flex" }}>
            <Icon sx={{ fontSize: TOOLBAR_GLYPH_PX }} />
            {Mark && (
              <Mark
                data-mark={face.mark}
                sx={{
                  position: "absolute",
                  right: -6,
                  bottom: -6,
                  fontSize: 14,
                  borderRadius: "50%",
                  // The sign is knocked out of a filled disc, and a ring of the surface around it
                  // cuts it from the glyph, so it reads as a badge rather than as a stroke of the
                  // rows or the columns underneath.
                  bgcolor: "background.paper",
                }}
              />
            )}
          </Box>
        ) : (
          <Box
            component="span"
            sx={{ fontSize: 15, fontWeight: 700, lineHeight: `${TOOLBAR_GLYPH_PX}px`, textTransform: "none" }}
          >
            {face.text}
          </Box>
        )}
      </ToggleButton>
    </Tooltip>
  );
}
