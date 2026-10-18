"use client";

import { type FoldNode, openFoldsAround } from "@/shared/ui/fold";
import GlyphButton from "@/shared/ui/GlyphButton";

type Fields = { namedItem(name: string): unknown };

/**
 * §456 (amending §377): write each recommended value into its box of the form this button sits
 * in, and nothing else — no submit, no action; «Salvează termenele» still does the saving, with
 * its question first (§384). The boxes are uncontrolled (`RecallField`), so setting `.value` is
 * what the browser posts next. Says which boxes it changed, so the folds that hold them can open
 * (below). Exported for the unit test.
 */
export function fillRecommended(elements: Fields, values: Readonly<Record<string, number>>): string[] {
  const changed: string[] = [];
  for (const [name, value] of Object.entries(values)) {
    const box = elements.namedItem(name);
    if (box && typeof box === "object" && "value" in box) {
      const target = box as { value: string };
      if (target.value !== String(value)) changed.push(name);
      target.value = String(value);
    }
  }
  return changed;
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
        if (!form) return;
        // The boxes sit in closed folds (§377 amended): a value filled in where nobody can see it is
        // a value nobody checks before the question, so the folds around what changed open.
        for (const name of fillRecommended(form.elements, values)) openFoldsAround(form.elements.namedItem(name) as FoldNode | null);
      }}
    >
      {label}
    </GlyphButton>
  );
}
