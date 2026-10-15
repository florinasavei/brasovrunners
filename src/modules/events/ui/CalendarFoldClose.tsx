"use client";

import { useEffect } from "react";

/**
 * Escape and a press outside close the event page's «Adaugă în calendar» panel (`DECISIONS.md` §778,
 * amending §772). The fold itself is a native `<details>` and works with scripts off, the panel being plain
 * CSS; this island only adds what a dropdown is expected to do once there is a script. It draws nothing:
 * it finds the fold by its id and listens while the fold is open. Escape returns focus to the pill when it
 * was inside the panel, so a keyboard user is not dropped at the top of the page.
 */
export default function CalendarFoldClose({ foldId }: { foldId: string }) {
  useEffect(() => {
    const fold = document.getElementById(foldId);
    if (!(fold instanceof HTMLDetailsElement)) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || !fold.open) return;
      const inside = fold.contains(document.activeElement);
      fold.open = false;
      if (inside) fold.querySelector<HTMLElement>(":scope > summary")?.focus();
    };
    const onPress = (event: Event) => {
      if (fold.open && event.target instanceof Node && !fold.contains(event.target)) fold.open = false;
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onPress);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onPress);
    };
  }, [foldId]);
  return null;
}
