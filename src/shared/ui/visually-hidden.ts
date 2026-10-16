/**
 * Text a screen reader reads and the eye never sees — the `sx` of a visually hidden element. The sizes are `'1px'`
 * strings, not the number 1: MUI's `sx` turns the number 1 into a hundred per cent of the parent.
 */
export const VISUALLY_HIDDEN = {
  position: "absolute",
  width: "1px",
  height: "1px",
  p: 0,
  m: "-1px",
  overflow: "hidden",
  clip: "rect(0 0 0 0)",
  whiteSpace: "nowrap",
  border: 0,
} as const;
