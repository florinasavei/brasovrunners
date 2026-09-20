"use client";

import Typography from "@mui/material/Typography";
import { useSyncExternalStore } from "react";

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
 * observer on that input's `value` attribute.
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
  const current = useSyncExternalStore(
    (notify) => {
      const input = document.querySelector<HTMLInputElement>(`input[name="${selectName}"]`);
      if (!input) return () => undefined;
      const observer = new MutationObserver(notify);
      observer.observe(input, { attributes: true, attributeFilter: ["value"] });
      return () => observer.disconnect();
    },
    () => document.querySelector<HTMLInputElement>(`input[name="${selectName}"]`)?.value ?? initialType,
    () => initialType,
  );

  const note = notes[current] ?? notes[initialType];
  if (!note) return null;
  return (
    <Typography variant="body2" color="text.secondary">
      {note}
    </Typography>
  );
}
