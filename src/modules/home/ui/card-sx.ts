/**
 * The home page's cards, in one place (§NNN; `docs/REDESIGN.md` § The visual system: «Cards: 16 px
 * radius, one soft shadow, the photo on top, a tag pill»). Plain objects, as `events/ui/card-layout.ts`
 * is, whose whole-card tap these follow (§486): the title's link is stretched over the card, so a
 * thumb anywhere on it opens the event, and the card wears the focus ring while the keyboard is on
 * that link. Every colour a theme token.
 */

/** The card: the radius and the one soft shadow of the plan; the box its title's cover measures. */
export const HOME_CARD_SX = {
  position: "relative",
  isolation: "isolate",
  height: "100%",
  display: "flex",
  flexDirection: "column",
  borderRadius: "16px",
  overflow: "hidden",
  bgcolor: "background.paper",
  border: 1,
  borderColor: "divider",
  boxShadow: 1,
  "&:has(h3 a:focus-visible)": { outline: "2px solid", outlineColor: "primary.main", outlineOffset: 2 },
} as const;

/** The picture's box on a card: the tag pill sits over its corner. */
export const HOME_CARD_PICTURE_SX = { position: "relative", flexShrink: 0 } as const;

/**
 * A card's title: the event's page, at least 44 pixels to a thumb (BR-REQ-041-01 criterion 6) and,
 * through its `::after`, the whole card — the round arrow and the words beside it are inside the
 * press. The link keeps its colour visited or not; the ring is the card's where `:has` is supported.
 */
export const HOME_CARD_TITLE_SX = {
  m: 0,
  fontSize: "1.125rem",
  lineHeight: 1.3,
  overflowWrap: "anywhere",
  "& a": {
    display: "flex",
    alignItems: "center",
    minHeight: 44,
    color: "text.primary",
    textDecoration: "none",
    position: "static",
    "&:visited": { color: "text.primary" },
    "&:hover": { textDecoration: "underline" },
    "&:focus-visible": { textDecoration: "underline", outline: "2px solid", outlineColor: "primary.main", outlineOffset: 2, "@supports selector(:has(a))": { outline: "none" } },
    "&::after": { content: '""', position: "absolute", inset: 0, zIndex: 2 },
  },
} as const;

/** A card's body under its picture: the room a short card is given goes to its foot, where the arrow is. */
export const HOME_CARD_BODY_SX = { display: "flex", flexDirection: "column", gap: 0.5, p: 2, flex: 1 } as const;
