import HelpOutlineIcon from "@mui/icons-material/HelpOutlineOutlined";
import Box from "@mui/material/Box";
import type { ReactNode } from "react";
import { CHOICE_CARD_SX, CHOICE_INPUT_SX, paletteWash } from "@/shared/ui/choice-card";
import { TAP_TARGET } from "@/shared/ui/tap-target";
import { HOVER_OK } from "@/theme/motion";
import RoleDescription from "./RoleDescription";

/** The «?» is a 44-pixel round target at the chip's right end; the label leaves its room free so the name never runs under it. */
const HELP_SIZE = 44;

/**
 * The words under the tick start after it: the label's padding (12 px), the native box (22 px) and the gap (10 px), written once so the
 * role's description lines up under its name and not under the box.
 */
const TEXT_INDENT = "44px";

/**
 * The chips of one group of roles: a wrap row (§780 amended; the owner, 2026-10-16: «nu-mi place designul pt asta»). Each chip is as wide
 * as its name, so a short name leaves room for the next one on the same line; a long name wraps inside its own chip (`maxWidth: 100%`,
 * `minWidth: 0`) and a chip whose «?» is open takes the whole row (`flex-basis: 100%`, in the chip's own rule).
 */
export function RoleChipRow({ children }: { children: ReactNode }) {
  return (
    <Box sx={{ display: "flex", flexWrap: "wrap", gap: 1 }} data-testid="volunteer-role-chips">
      {children}
    </Box>
  );
}

/**
 * One role on the volunteers' page, as a chip — a pill (§780 amended, amending §761, §765, §773; the owner, 2026-10-16: «nu-mi place designul
 * pt asta», then «colapsată descrierea și cu o cuinița de semnul întrebării»). The whole pill's face is the checkbox's `<label>`: the small
 * native box visible at the left (`CHOICE_INPUT_SX` — the tick is the state, never the colour alone), then the role's name, then, only when the
 * club ticked «Arată public câți voluntari mai sunt necesari» (§773), the count words after a middle dot. A press on the name or the words
 * ticks the box, the label being at least 44 pixels tall. The pill's outline and tint follow `:checked`, its keyboard ring `:focus-visible`, in
 * CSS alone (`:has`): no script, no island, so it works with scripts off and a refused post comes back with the ticks it had (`ticked`, from
 * the sealed draft, §142; the form is a plain Server Action form, not `ActionForm`, so the recall's context is empty and the server's
 * word is the whole of it).
 *
 * What is shared with the feedback page's `BranchChoice`: the surface's hover border, the primary border on `:checked`, the keyboard ring
 * (`CHOICE_CARD_SX`) and the box (`CHOICE_INPUT_SX`). What is added here: the one-pixel border and the full radius of a pill, the stronger
 * tint (12 %, the category header's own disc) and an inset ring on `:checked`, so a ticked pill reads as two pixels without moving its words.
 *
 * The name's first letter is capitalised by CSS (`::first-letter` on an inline-block span): the club's typed text is stored as typed.
 *
 * A role with a description (§765) has a round «?» at the pill's right end, OUTSIDE the label — a press on it never ticks the box — as the
 * `<summary>` of a native `<details>`, closed by default and working with scripts off. Open, the chip takes the whole row and the
 * description shows under the name (`RoleDescription`, flush; a link in it works). A role without one has no «?».
 *
 * The box is named by the role's name alone and described by the count words and the description (`aria-labelledby`, `aria-describedby`),
 * so a screen reader says the role first and the rest after it — as `CheckboxField` did with its `help`.
 *
 * A Server Component with no state.
 */
export default function VolunteerRoleChip({
  id,
  name,
  needs,
  ticked,
  doc,
  words,
  helpLabel,
}: {
  /** The role's id: the box's value, and the base of every id the chip carries. */
  id: string;
  /** The role's name in the page's language. */
  name: string;
  /** The count words («mai e nevoie de 1 persoană»), already worded, or null: the club did not tick §773's setting, or the role has no number (§784). */
  needs: string | null;
  /** The role was ticked before a refusal. */
  ticked: boolean;
  /** The description's document in the page's language, or null (`RoleDescription`). */
  doc: unknown;
  /** Its plain words. */
  words: string | null;
  /** «Ce presupune rolul {name}» / "What the role {name} involves": the «?»'s accessible name. */
  helpLabel: string;
}) {
  const base = `volunteer-role-${id}`;
  const described = doc !== null && doc !== undefined && words !== null && words.trim() !== "";
  const descriptionId = `${base}-description`;
  const checked = CHOICE_CARD_SX["&:has(input:checked)"];
  return (
    <Box
      data-testid="volunteer-role-option"
      sx={{
        ...CHOICE_CARD_SX,
        // A pill: one pixel of border, the full radius; an open description is text under the name, so its box is a rounded rectangle.
        border: 1,
        borderRadius: "999px",
        position: "relative",
        minWidth: 0,
        maxWidth: "100%",
        // The border lights only under the label: the «?» is a separate target, and a pointer on it is not a pointer on the role.
        [HOVER_OK]: { "&:hover": { borderColor: "divider" }, "&:has(label:hover)": { borderColor: "primary.main" } },
        "&:has(input:checked)": { ...checked, bgcolor: paletteWash("primary", 12), boxShadow: "inset 0 0 0 1px var(--mui-palette-primary-main)" },
        "&:has(details[open])": { flexBasis: "100%", borderRadius: 3 },
      }}
    >
      <Box
        component="label"
        data-testid="volunteer-role-label"
        sx={{
          ...TAP_TARGET,
          display: "flex",
          alignItems: "center",
          gap: 1.25,
          py: 0.75,
          pl: 1.5,
          pr: described ? `${HELP_SIZE}px` : 2,
          cursor: "pointer",
          boxSizing: "border-box",
          "& input": { ...CHOICE_INPUT_SX },
        }}
      >
        <input
          type="checkbox"
          id={base}
          name="roleIds"
          value={id}
          defaultChecked={ticked}
          aria-labelledby={`${base}-name`}
          aria-describedby={[needs ? `${base}-needs` : null, described ? descriptionId : null].filter(Boolean).join(" ") || undefined}
        />
        <Box component="span" sx={{ minWidth: 0, flex: 1, overflowWrap: "anywhere" }}>
          <Box
            component="span"
            id={`${base}-name`}
            data-testid="volunteer-role-name"
            // Only the first letter, by CSS (§780): `::first-letter` applies to a block-level box, which an inline-block span is.
            sx={{ display: "inline-block", fontWeight: 600, "&::first-letter": { textTransform: "uppercase" } }}
          >
            {name}
          </Box>
          {needs && (
            <>
              <Box component="span" aria-hidden="true" sx={{ color: "text.secondary", mx: 0.75 }}>
                {"·"}
              </Box>
              <Box component="span" id={`${base}-needs`} data-testid="volunteer-role-needs" sx={{ color: "text.secondary", fontSize: "0.875rem" }}>
                {needs}
              </Box>
            </>
          )}
        </Box>
      </Box>
      {described && (
        // «Descrierea rolului» (§765) behind a «?»: a native fold, outside the label (a label may hold neither a link nor a fold). The summary
        // is drawn over the label's reserved right padding; closed, the fold has no height of its own.
        // Closed, the «?» is centred on the pill, clear of the curved end when the name wraps to several lines; open, it stays beside the name's first line.
        <Box
          component="details"
          data-testid="volunteer-role-description"
          sx={{
            "& > summary": { position: "absolute", top: 0, right: 0 },
            "&:not([open]) > summary": { top: "50%", transform: "translateY(-50%)" },
          }}
        >
          <Box
            component="summary"
            aria-label={helpLabel}
            data-testid="volunteer-role-help"
            sx={{
              width: HELP_SIZE,
              height: HELP_SIZE,
              boxSizing: "border-box",
              display: "grid",
              placeItems: "center",
              borderRadius: "50%",
              cursor: "pointer",
              listStyle: "none",
              color: "text.secondary",
              "&::-webkit-details-marker": { display: "none" },
              "&::marker": { content: '""' },
              [HOVER_OK]: { "&:hover": { color: "primary.main" } },
              "&:focus-visible": { outline: "2px solid var(--mui-palette-primary-main)", outlineOffset: "-4px" },
              "details[open] > &": { color: "primary.main" },
            }}
          >
            <HelpOutlineIcon aria-hidden="true" sx={{ fontSize: 24 }} />
          </Box>
          <Box sx={{ pl: TEXT_INDENT, pr: 2, pb: 1.25 }}>
            <RoleDescription doc={doc} words={words} bodyId={descriptionId} />
          </Box>
        </Box>
      )}
    </Box>
  );
}
