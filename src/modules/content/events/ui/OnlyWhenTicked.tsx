"use client";

import { type ReactNode, useCallback, useSyncExternalStore } from "react";
import { useRecall } from "@/shared/forms/recall";
import { ShownWhen } from "./OnlyForType";

/** The form's checkbox by the name it posts. */
function tick(name: string): HTMLInputElement | null {
  return document.querySelector<HTMLInputElement>(`input[type="checkbox"][name="${name}"]`);
}

/**
 * Shows its children while the form's checkbox `name` is ticked (§NNN: «Folosește lista ascunsă» and
 * the three fields that mean something only with it on). `OnlyForMode`'s twin, over a checkbox: the
 * same `ShownWhen`, so the children stay in the DOM — hidden, never removed, still posted, read-only
 * while hidden so a box out of range never blocks the save — and a refusal about one of them reveals
 * the block. The server validates them independently of this (`fields.ts#hiddenListBandRule`).
 *
 * A native checkbox fires `change`, which is the subscription; it is renewed on every answer of a
 * kept form (§315), because the box re-mounts from what was posted.
 */
export default function OnlyWhenTicked({ name, initiallyTicked, children }: { name: string; initiallyTicked: boolean; children: ReactNode }) {
  const recall = useRecall();
  // After a refusal the posted form is the truth: an unticked box posted nothing.
  const fallback = recall.has ? recall.value(name) === "on" : initiallyTicked;
  const subscribe = useCallback(
    (notify: () => void) => {
      const box = tick(name);
      if (!box) return () => undefined;
      box.addEventListener("change", notify);
      return () => box.removeEventListener("change", notify);
    },
    // The generation is what renews the subscription after a re-mount of the box.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [name, recall.generation],
  );
  const ticked = useSyncExternalStore(subscribe, () => tick(name)?.checked ?? fallback, () => fallback);
  return (
    <ShownWhen shown={ticked} answer={ticked ? "on" : "off"}>
      {children}
    </ShownWhen>
  );
}
