"use client";

import Box from "@mui/material/Box";
import { type ReactNode, useSyncExternalStore } from "react";

/**
 * Shows its children while the form's type select says `type` (`DECISIONS.md` §71): the gun
 * time is a race's field and nobody planning a Sunday run should see it. A client island with
 * one observer on the select, chosen over a server round-trip because the select is MUI's and
 * the form is one save. The children are always in the DOM — hidden, not removed — so a value
 * typed before the type was changed is still posted; the service ignores a race start on
 * anything but a race.
 */
export default function OnlyForType({
  type,
  selectName,
  initialType,
  children,
}: {
  type: string;
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

  return <Box sx={{ display: current === type ? "block" : "none" }}>{children}</Box>;
}
