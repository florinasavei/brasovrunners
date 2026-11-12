/**
 * The colour of the surface a piece of the backoffice stands on, as a CSS variable (§NNN).
 *
 * A cell pinned over the columns that scroll under it (`AdminTable`'s row verbs) has to be opaque,
 * and opaque in the colour of what is behind the table: the page, or — inside a `Panel` or a boxed
 * fold — the card. A table cannot see which, so the card says it: `ON_CARD_SX` beside its own
 * `bgcolor`, and anything inside reads `ADMIN_TABLE_SURFACE`, which falls back to the page.
 *
 * MUI's own palette variables, never a literal (`theme/brand.ts` holds the colours), and plain
 * strings, so they cross from a Server Component into MUI's client components.
 */
export const SURFACE_VARIABLE = "--br-surface";

/** For a card (`bgcolor: "background.paper"`): what stands inside it stands on the card. */
export const ON_CARD_SX = { [SURFACE_VARIABLE]: "var(--mui-palette-background-paper)" } as const;

/** The surface behind a backoffice table: the card that said so, else the page. */
export const ADMIN_TABLE_SURFACE = `var(${SURFACE_VARIABLE}, var(--mui-palette-background-default))`;
