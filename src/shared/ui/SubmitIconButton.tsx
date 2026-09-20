"use client";

import Button from "@mui/material/Button";
import { ACTION_ICONS, type ActionIconName } from "./action-icons";

/**
 * An ordinary submit button that wears a glyph (§170; the owner, on the publication row:
 * "am nevoie de iconițe și aici").
 *
 * A client component for one reason: the icon. A Server Component may not hand an element
 * across the boundary as a prop — see `CheckboxField` for what that costs — so it hands a
 * name and this makes the element. There is no state here and no handler; it is a plain
 * `type="submit"` inside whatever form the caller already rendered, and the Server Action
 * behind it is untouched.
 */
export default function SubmitIconButton({
  label,
  icon,
  variant = "outlined",
  color = "primary",
  size = "small",
}: {
  label: string;
  icon?: ActionIconName;
  variant?: "text" | "outlined" | "contained";
  color?: "primary" | "error" | "warning";
  size?: "small" | "medium";
}) {
  const Icon = icon ? ACTION_ICONS[icon] : null;
  return (
    <Button
      type="submit"
      variant={variant}
      color={color}
      size={size}
      sx={{ minHeight: 44 }}
      startIcon={Icon ? <Icon fontSize="small" /> : undefined}
    >
      {label}
    </Button>
  );
}
