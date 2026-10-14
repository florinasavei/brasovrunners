import type { ComponentProps } from "react";
import GlyphButton from "./GlyphButton";

/**
 * The one-press tick (§752's pattern, made the rule by §766; the owner, 2026-10-14, of a button that
 * flips a setting: «nu mai folosi niciodată» that kind of element): a plain submit drawn as the house's
 * checkbox with its words beside it. The glyph is the box — 24 pixels in a 44-pixel row — and the state
 * is in `aria-checked` and in the glyph, never in the colour alone.
 *
 * It goes inside a form that posts the state it wants (a hidden `on` holding the other value than the one
 * drawn), so it works with scripts off, and the action behind the form is the one that was always there.
 * Inside an `ActionForm` it asks first, when the setting is one that deserves it, exactly as the button it
 * replaces did. Where the choice is saved with other fields, use `CheckboxField` in the save form instead.
 *
 * The words name the setting, the same whether it is ticked or not («Verificarea anti-bot pornită»), never
 * the verb that would flip it: a tick that said «Oprește» while it was drawn ticked was the toggle button
 * again. A Server Component renders it: `GlyphButton` makes the icon, so no element crosses the boundary.
 *
 * `VolunteersCard` and `EventTodoCard` draw the same pattern with their own copy of this row's styles
 * (§752, §765); they can adopt it when they are next touched.
 */
const TICK_ROW_SX = {
  minHeight: 44,
  justifyContent: "flex-start",
  textAlign: "left",
  textTransform: "none",
  fontWeight: 400,
  fontSize: "1rem",
  color: "text.primary",
  px: 0.5,
  borderRadius: 1,
  "& .MuiButton-startIcon": { mr: 1, ml: 0 },
  "& .MuiButton-startIcon > *:nth-of-type(1)": { fontSize: 24 },
} as const;

type Props = Omit<ComponentProps<typeof GlyphButton>, "icon" | "type" | "role" | "aria-checked" | "color" | "variant" | "sx"> & {
  /** The setting as saved: drawn ticked or empty. */
  checked: boolean;
};

export default function TickButton({ checked, children, ...props }: Props) {
  return (
    <GlyphButton
      {...props}
      type="submit"
      icon={checked ? "tickOn" : "tickOff"}
      role="checkbox"
      aria-checked={checked}
      color={checked ? "success" : "inherit"}
      sx={TICK_ROW_SX}
    >
      {children}
    </GlyphButton>
  );
}
