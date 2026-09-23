"use client";

import Typography from "@mui/material/Typography";
import { useCallback, useSyncExternalStore } from "react";
import { useRecall } from "@/shared/forms/recall";

/**
 * One sentence about the type that is currently chosen (§170; the owner, on the paragraph that
 * described all seven at once: "textul ăsta trebuie să fie collapsed și trebuie să apară doar
 * la concurs, nu la toate").
 *
 * The helper under "Tip eveniment" used to explain every type in one block of six lines, which
 * is a wall to read while choosing and wrong for six of the seven answers once chosen. This
 * shows the line for the chosen one; the full comparison stays one press away in the fold
 * beside it, which is where a comparison belongs.
 *
 * The same subscription as `OnlyForType`, and for the same reason: MUI's Select keeps its value
 * on a hidden input and fires no native change event, so the honest subscription is a mutation
 * observer on that input's `value` attribute — renewed after a refused submit re-mounts the
 * select with the type that was posted (§305).
 */
export default function TypeNote({
  selectName,
  initialType,
  notes,
}: {
  selectName: string;
  initialType: string;
  /** One sentence per type, keyed by the value the select posts. */
  notes: Readonly<Record<string, string>>;
}) {
  const recall = useRecall();
  const fallback = recall.value(selectName) ?? initialType;
  const subscribe = useCallback(
    (notify: () => void) => {
      const input = document.querySelector<HTMLInputElement>(`input[name="${selectName}"]`);
      if (!input) return () => undefined;
      const observer = new MutationObserver(notify);
      observer.observe(input, { attributes: true, attributeFilter: ["value"] });
      return () => observer.disconnect();
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [selectName, recall.generation],
  );
  const current = useSyncExternalStore(
    subscribe,
    () => document.querySelector<HTMLInputElement>(`input[name="${selectName}"]`)?.value ?? fallback,
    () => fallback,
  );

  const note = notes[current] ?? notes[fallback];
  if (!note) return null;
  return (
    <Typography variant="body2" color="text.secondary">
      {note}
    </Typography>
  );
}
