"use client";

import Box from "@mui/material/Box";
import { type ReactNode, useCallback, useSyncExternalStore } from "react";
import { useRecall } from "@/shared/forms/recall";

/**
 * What one of the form's MUI selects says right now, by the `name` it posts.
 *
 * MUI's Select keeps its value on a hidden input and fires no native change event; the value
 * attribute is what changes, so a mutation observer is the honest subscription. After a refused
 * submit the select re-mounts with the value that was posted (§315), so the subscription is
 * renewed on every answer — an observer on the old, removed input would never hear the new one —
 * and the server render reads the recalled value rather than the page's.
 *
 * `OnlyForType` below reads the type select with it; the notice beside the save button reads
 * the status select (`EventNoticeFields`, §331).
 */
export function useSelectedValue(selectName: string, initialValue: string): string {
  const recall = useRecall();
  const fallback = recall.value(selectName) ?? initialValue;
  const subscribe = useCallback(
    (notify: () => void) => {
      const input = document.querySelector<HTMLInputElement>(`input[name="${selectName}"]`);
      if (!input) return () => undefined;
      const observer = new MutationObserver(notify);
      observer.observe(input, { attributes: true, attributeFilter: ["value"] });
      return () => observer.disconnect();
    },
    // The generation is what renews the subscription after a re-mount of the select.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [selectName, recall.generation],
  );
  return useSyncExternalStore(
    subscribe,
    () => document.querySelector<HTMLInputElement>(`input[name="${selectName}"]`)?.value ?? fallback,
    () => fallback,
  );
}

/**
 * Shows its children while the form's type select says one of `type` (`DECISIONS.md` §71):
 * the gun time is a race's field and nobody planning a Sunday run should see it; since §111
 * the registration block and the programme are hidden the same way on a group run. A client
 * island with one observer on the select, chosen over a server round-trip because the select
 * is MUI's and the form is one save. The children are always in the DOM — hidden, not removed
 * — so a value typed before the type was changed is still posted; the service ignores a race
 * start on anything but a race, and the registration block on a group run.
 */
export default function OnlyForType({
  type,
  selectName,
  initialType,
  children,
}: {
  /** One type, or the types the children belong to. */
  type: string | readonly string[];
  selectName: string;
  initialType: string;
  children: ReactNode;
}) {
  const current = useSelectedValue(selectName, initialType);
  const shown = typeof type === "string" ? current === type : type.includes(current);
  return <Box sx={{ display: shown ? "block" : "none" }}>{children}</Box>;
}
