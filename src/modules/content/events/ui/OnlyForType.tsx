"use client";

import Box from "@mui/material/Box";
import { type ReactNode, useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useRecall } from "@/shared/forms/recall";
import { REVEAL_EVENT } from "@/shared/ui/fold";

/**
 * What one of the form's MUI selects says now, by its posted `name`. MUI's Select fires no native
 * change, so a mutation observer on its hidden input's value is the subscription — renewed on each
 * recall generation, since a refused submit re-mounts the select with the posted value (§315).
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

/** The boxes whose constraints the browser checks on submit; a tick or a hidden input has none that matter here. */
const CHECKED_BOXES = "input:not([type=hidden]):not([type=checkbox]):not([type=radio]), textarea";
/** Marks a box made read-only here, so only those are handed back. */
const RELAXED = "data-relaxed-while-hidden";
/** Marks a block that is hidden right now (`ShownWhen` renders it); a box is relaxed while any block around it says so. */
const HIDDEN_BLOCK = "data-hidden-block";

/**
 * Every box under `root` read-only while any hidden block holds it, handed back once none does.
 * Read off the DOM, so a nested hidden block never releases a box its outer block still hides.
 */
function relaxHiddenBoxes(root: HTMLElement): void {
  for (const box of root.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>(CHECKED_BOXES)) {
    const hidden = box.closest(`[${HIDDEN_BLOCK}]`) !== null;
    if (hidden && !box.readOnly) {
      box.readOnly = true;
      box.setAttribute(RELAXED, "");
    } else if (!hidden && box.hasAttribute(RELAXED)) {
      box.readOnly = false;
      box.removeAttribute(RELAXED);
    }
  }
}

/**
 * The block `OnlyForType` and `OnlyForMode` draw (§350): hidden, not removed, so typed values
 * still post. While hidden every box in it is read-only — a read-only control is barred from
 * constraint validation but still posts — because an out-of-range hidden box made the browser
 * refuse the submit and fail to focus it: Salvează silently did nothing. The service ignores what
 * the choice hides (`ignoreHiddenFields`). A server refusal about a box in here arrives as
 * `REVEAL_EVENT` (`ActionForm`) and shows the block until the answer changes.
 */
export function ShownWhen({ shown, answer, children }: { shown: boolean; answer: string; children: ReactNode }) {
  const block = useRef<HTMLDivElement>(null);
  const { generation } = useRecall();
  const [revealedFor, setRevealedFor] = useState<string | null>(null);
  // A new answer drops the reveal during render (React's "adjusting state when a prop changes"),
  // so no frame shows the stale one.
  const [revealAnswer, setRevealAnswer] = useState(answer);
  if (revealAnswer !== answer) {
    setRevealAnswer(answer);
    setRevealedFor(null);
  }
  const visible = shown || revealedFor === answer;

  useEffect(() => {
    const element = block.current;
    if (!element) return;
    relaxHiddenBoxes(element);
    if (visible) return;
    // Boxes mounted while hidden — a programme row, a picker's input — are relaxed as they arrive.
    const observer = new MutationObserver(() => relaxHiddenBoxes(element));
    observer.observe(element, { childList: true, subtree: true });
    const onReveal = () => setRevealedFor(answer);
    element.addEventListener(REVEAL_EVENT, onReveal);
    return () => {
      observer.disconnect();
      element.removeEventListener(REVEAL_EVENT, onReveal);
    };
    // A refused save re-mounts the boxes from what was posted, without the attribute.
  }, [visible, answer, generation]);

  return (
    <Box ref={block} data-hidden-block={visible ? undefined : ""} sx={{ display: visible ? "block" : "none" }}>
      {children}
    </Box>
  );
}

/**
 * Shows its children while the type select is one of `type` (§71, §111): e.g. the gun time only
 * for a race, no registration or programme on a group run. Hidden, never removed, so values typed
 * before a type change still post; the service ignores what the type excludes, and hidden boxes
 * cannot block the save (`ShownWhen`).
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
  return (
    <ShownWhen shown={shown} answer={current}>
      {children}
    </ShownWhen>
  );
}
