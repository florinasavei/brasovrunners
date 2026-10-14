"use client";

import { type ReactNode, useCallback, useSyncExternalStore } from "react";
import { useRecall } from "@/shared/forms/recall";
import { ShownWhen } from "./OnlyForType";

/** The form's radio group `name`: the value checked now, or null with none checked. */
function chosen(name: string): string | null {
  return document.querySelector<HTMLInputElement>(`input[type="radio"][name="${name}"]:checked`)?.value ?? null;
}

/**
 * Shows its children while the form's radio group `name` says `value` (§NNN: the bib's «O poză încărcată»
 * and the picture field that means something only with it). `OnlyWhenTicked`'s twin over a native radio
 * group (`RadioField`): the same `ShownWhen`, so the children stay in the DOM — hidden, never removed,
 * still posted, read-only while hidden — and a refusal about one of them reveals the block.
 *
 * A native radio fires `change` on the one newly checked, and it bubbles: one listener on the document
 * hears the whole group, renewed on every answer of a kept form (§315), when the group re-mounts.
 */
export default function OnlyWhenChosen({ name, value, initial, children }: { name: string; value: string; initial: string; children: ReactNode }) {
  const recall = useRecall();
  // After a refusal the posted form is the truth.
  const fallback = (recall.has ? recall.value(name) : undefined) ?? initial;
  const subscribe = useCallback(
    (notify: () => void) => {
      const onChange = (event: Event) => {
        if (event.target instanceof HTMLInputElement && event.target.name === name) notify();
      };
      document.addEventListener("change", onChange);
      return () => document.removeEventListener("change", onChange);
    },
    // The generation is what renews the subscription after a re-mount of the group.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [name, recall.generation],
  );
  const current = useSyncExternalStore(subscribe, () => chosen(name) ?? fallback, () => fallback);
  return (
    <ShownWhen shown={current === value} answer={current}>
      {children}
    </ShownWhen>
  );
}
