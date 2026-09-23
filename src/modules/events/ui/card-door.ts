import { TAP_TARGET } from "@/shared/ui/tap-target";

/**
 * The "Descrierea completă a evenimentului" button on a listing card (`DECISIONS.md` §305),
 * shared by the series card and the single-date card so the two read alike.
 *
 * Quieter than a call to action (the owner: "'Full description' buttons should be smaller and
 * not in caps"): sentence case, a smaller type, tight padding — it is a door to a page, not the
 * registration button. The height stays at the 44 pixels BR-REQ-041-01 criterion 6 asks of
 * every control a thumb must hit; what shrinks is what the eye sees, not what the finger gets.
 */
export const CARD_DOOR_SX = {
  ...TAP_TARGET,
  textTransform: "none",
  fontSize: "0.8125rem",
  fontWeight: 500,
  lineHeight: 1.3,
  px: 1.5,
  py: 0.25,
} as const;
