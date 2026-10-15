import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import type { ReactNode } from "react";
import { CHOICE_CARD_SX, CHOICE_INPUT_SX } from "@/shared/ui/choice-card";
import { TAP_TARGET } from "@/shared/ui/tap-target";
import RoleDescription from "./RoleDescription";

/**
 * The words under the tick start after it: the label's padding (12 px), the native box (22 px) and the gap (12 px), written once so the
 * role's description lines up under its name and not under the box.
 */
const TILE_TEXT_INDENT = "46px";

/**
 * The tiles of one group of roles, as a responsive grid (§780): one column on a phone — a 320-pixel screen has no room for two — and
 * two from the tablet width. `minmax(0, 1fr)` so a long role name wraps inside its tile instead of stretching the column past the page.
 */
export function RoleTileGrid({ children }: { children: ReactNode }) {
  return (
    <Box sx={{ display: "grid", gridTemplateColumns: { xs: "minmax(0, 1fr)", sm: "repeat(2, minmax(0, 1fr))" }, gap: { xs: 1.25, sm: 1.5 } }} data-testid="volunteer-role-grid">
      {children}
    </Box>
  );
}

/**
 * One role on the volunteers' page, as a selectable tile (§780, amending §761, §765, §773; the owner, 2026-10-15: «Și aici aș vrea mai
 * multe separatoare și un design mai frumos pentru roluri»): the house's selectable card (`CHOICE_CARD_SX`, the surface the feedback
 * page's `BranchChoice` draws, §676), around a native checkbox named `roleIds`. The whole tile is the checkbox's `<label>` — a press on the
 * name or on the count line ticks it, the label being at least 44 pixels tall — and the tile's outline and tint follow `:checked`, its
 * keyboard ring `:focus-visible`, in CSS alone: no script, no island, so it works with scripts off and a refused post comes back with
 * the ticks it had (`ticked`, from the sealed draft, §142; the form is a plain Server Action form, not `ActionForm`, so the recall's
 * context is empty here and the server's word is the whole of it).
 *
 * The box is named by the role's name alone and described by the count line and the description (`aria-labelledby`,
 * `aria-describedby`), so a screen reader says the role first and the rest after it — as `CheckboxField` did with its `help`.
 *
 * The count line («mai sunt locuri» / «mai e nevoie de N persoane», §773) sits under the NAME, aligned with it, not under the box. The
 * role's description (§765) sits under that, outside the label: it may hold a link and a native fold («Detalii»), and a label may not
 * hold either — a press on its words reads or opens it, never ticks the role; the blank space around it ticks, the label's press area
 * being stretched over the tile (`::after`) and the description's wrapper letting presses through except on its own content.
 *
 * A Server Component with no state.
 */
export default function VolunteerRoleTile({
  id,
  name,
  needs,
  ticked,
  doc,
  words,
  detailsLabel,
}: {
  /** The role's id: the box's value, and the base of every id the tile carries. */
  id: string;
  /** The role's name in the page's language. */
  name: string;
  /** The count line, already worded for the club's setting (`needs()` in `VolunteerBox`). */
  needs: string;
  /** The role was ticked before a refusal. */
  ticked: boolean;
  /** The description's document in the page's language, or null (`RoleDescription`). */
  doc: unknown;
  /** Its plain words. */
  words: string | null;
  /** «Detalii» / "Details". */
  detailsLabel: string;
}) {
  const base = `volunteer-role-${id}`;
  const described = doc !== null && doc !== undefined && words !== null && words.trim() !== "";
  const descriptionId = `${base}-description`;
  return (
    <Box data-testid="volunteer-role-option" sx={{ ...CHOICE_CARD_SX, display: "flex", flexDirection: "column", minWidth: 0, position: "relative" }}>
      <Box
        component="label"
        data-testid="volunteer-role-label"
        sx={{
          ...TAP_TARGET,
          display: "flex",
          alignItems: "flex-start",
          gap: 1.5,
          p: 1.5,
          cursor: "pointer",
          "& input": { ...CHOICE_INPUT_SX, mt: "1px", position: "relative", zIndex: 1 },
          // The label's press area reaches over the whole tile (the tile is the positioned box), so the blank space under a short name
          // beside a taller neighbour ticks the box too. The box and the words (and the description, below) are a layer above it, so each is its
          // own hit target; a press on any of them still reaches the label.
          "&::after": { content: '""', position: "absolute", inset: 0 },
        }}
      >
        <input
          type="checkbox"
          id={base}
          name="roleIds"
          value={id}
          defaultChecked={ticked}
          aria-labelledby={`${base}-name`}
          aria-describedby={[`${base}-needs`, described ? descriptionId : null].filter(Boolean).join(" ")}
        />
        <Box component="span" sx={{ minWidth: 0, flex: 1, position: "relative", zIndex: 1 }}>
          <Typography id={`${base}-name`} component="span" sx={{ display: "block", fontWeight: 600, overflowWrap: "anywhere" }}>
            {name}
          </Typography>
          <Typography id={`${base}-needs`} component="span" variant="body2" color="text.secondary" data-testid="volunteer-role-needs" sx={{ display: "block", mt: 0.25 }}>
            {needs}
          </Typography>
        </Box>
      </Box>
      {described && (
        // «Descrierea rolului» (§765): the editor's document, folded «Detalii» past about three lines, under the name.
        <Box sx={{ pl: TILE_TEXT_INDENT, pr: 1.5, pb: 0.5, position: "relative", zIndex: 1, pointerEvents: "none", "& > *": { pointerEvents: "auto" } }}>
          <RoleDescription doc={doc} words={words} detailsLabel={detailsLabel} bodyId={descriptionId} flush />
        </Box>
      )}
    </Box>
  );
}
