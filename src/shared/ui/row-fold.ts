/**
 * One list row that folds open onto its own boxes (§842; the owner, 2026-10-21, of the roles and the
 * checkpoints editors: «they look like they are from a different app, not consistent at all»).
 *
 * The backoffice's list of things a person edits — the event's to-dos (§749), the volunteers' roles,
 * the route's checkpoints — is one shape: a `<ul>` of rows, each row a `<details>` whose `<summary>`
 * is the row **in words** (the name, a chip or two of facts, the pencil at the end), and whose body
 * holds the boxes. A row reads like the rows around it, a press anywhere on it opens the boxes in
 * place, and nothing is a wall of inputs until it is asked for. The three objects here are what every
 * such row spreads, so they all change together — as `BOXED_DISCLOSURE_SX` does for the cards (§269).
 *
 * `ROW_SX` is the `<li>`: a hairline between rows, none after the last. `LINE_SX` is the one line:
 * the words, the facts and the pencil in three columns on a wide screen, the facts under the words on
 * a phone. `SUMMARY_SX` is the line as a `<summary>`: the marker gone (the pencil is the picture, §521),
 * a hover wash, the cursor. `PENCIL_SX` places the pencil in its column.
 */
export const ROW_SX = { borderBottom: 1, borderColor: "divider", "&:last-of-type": { borderBottom: 0 } } as const;

export const LINE_SX = {
  display: "grid",
  gridTemplateColumns: { xs: "minmax(0, 1fr) 28px", sm: "minmax(0, 1fr) auto 28px" },
  gridTemplateAreas: { xs: '"words words" "facts pen"', sm: '"words facts pen"' },
  alignItems: "center",
  columnGap: 1,
  rowGap: 0.25,
  minHeight: 44,
  py: 0.5,
} as const;

export const SUMMARY_SX = {
  ...LINE_SX,
  cursor: "pointer",
  listStyle: "none",
  "&::-webkit-details-marker": { display: "none" },
  "&::marker": { content: '""' },
  "&:hover": { bgcolor: "action.hover" },
} as const;

export const PENCIL_SX = { gridArea: "pen", color: "text.secondary", justifySelf: "end" } as const;

/** The facts' column: chips that wrap, right-aligned beside the words on a wide screen. */
export const FACTS_SX = { gridArea: "facts", display: "flex", flexWrap: "wrap", alignItems: "center", gap: 0.5, justifyContent: { sm: "flex-end" } } as const;
