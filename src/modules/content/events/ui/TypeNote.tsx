"use client";

import Typography from "@mui/material/Typography";
import { useCallback, useSyncExternalStore } from "react";
import { useRecall } from "@/shared/forms/recall";

/**
 * One sentence about the chosen type (§170); the full comparison stays in the fold beside it.
 * Subscribes like `OnlyForType`: MUI's Select fires no native change, so a mutation observer on
 * its hidden input, renewed after a refused submit re-mounts it (§315).
 */
export default function TypeNote({
  selectName,
  initialType,
  notes,
  warning = false,
}: {
  selectName: string;
  initialType: string;
  /** One sentence per type, keyed by the value the select posts. */
  notes: Readonly<Record<string, string>>;
  /** Amber rather than grey: a sentence about who a change reaches (§350). */
  warning?: boolean;
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
    <Typography variant="body2" color={warning ? "warning.main" : "text.secondary"} data-testid={warning ? "type-change-warning" : undefined}>
      {note}
    </Typography>
  );
}
