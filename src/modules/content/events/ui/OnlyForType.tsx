"use client";

import Box from "@mui/material/Box";
import { type ReactNode, useSyncExternalStore } from "react";

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
  // MUI's Select keeps its value on a hidden input and fires no native change event; the
  // value attribute is what changes, so a mutation observer is the honest subscription.
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

  const shown = typeof type === "string" ? current === type : type.includes(current);
  return <Box sx={{ display: shown ? "block" : "none" }}>{children}</Box>;
}
