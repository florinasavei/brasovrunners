"use client";

import GlyphButton from "@/shared/ui/GlyphButton";

type Fields = { namedItem(name: string): unknown };

/**
 * §NNN (amending §377): write each recommended value into its box of the form this button sits
 * in, and nothing else — no submit, no action; «Salvează termenele» still does the saving, with
 * its question first (§384). The boxes are uncontrolled (`RecallField`), so setting `.value` is
 * what the browser posts next. Exported for the unit test.
 */
export function fillRecommended(elements: Fields, values: Readonly<Record<string, number>>): void {
  for (const [name, value] of Object.entries(values)) {
    const box = elements.namedItem(name);
    if (box && typeof box === "object" && "value" in box) (box as { value: string }).value = String(value);
  }
}

export default function FillRecommendedButton({ values, label }: { values: Readonly<Record<string, number>>; label: string }) {
  return (
    <GlyphButton
      type="button"
      variant="outlined"
      icon="reset"
      data-testid="deadlines-fill-recommended"
      onClick={(event) => {
        const form = event.currentTarget.closest("form");
        if (form) fillRecommended(form.elements, values);
      }}
    >
      {label}
    </GlyphButton>
  );
}
