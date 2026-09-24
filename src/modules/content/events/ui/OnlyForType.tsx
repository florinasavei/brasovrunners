"use client";

import Box from "@mui/material/Box";
import { type ReactNode, useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useRecall } from "@/shared/forms/recall";
import { REVEAL_EVENT } from "@/shared/ui/fold";

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

/** The boxes whose constraints the browser checks on submit; a tick or a hidden input has none that matter here. */
const CHECKED_BOXES = "input:not([type=hidden]):not([type=checkbox]):not([type=radio]), textarea";
/** Marks a box made read-only here, so only those are handed back. */
const RELAXED = "data-relaxed-while-hidden";
/** Marks a block that is hidden right now (`ShownWhen` renders it); a box is relaxed while any block around it says so. */
const HIDDEN_BLOCK = "data-hidden-block";

/**
 * Every box under `root` read-only while a hidden block holds it, and handed back once none does.
 * Read off the DOM rather than kept per block, so a block inside another (the "Pe site" fields
 * inside the race-only registration block) never hands back a box its outer block still hides.
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
 * The block `OnlyForType` and `OnlyForMode` draw (§NNN, found by review): shown while the answer
 * wants it, hidden otherwise — and while hidden, nothing in it can stop the save.
 *
 * Hidden, not removed, so what was typed is still posted and switching back finds it. But a hidden
 * box keeps its `min`, `max` and `pattern`, and one left out of range — a link typed as
 * `www.club.ro` under "La organizator" before a switch to "Pe site" — made the browser refuse the
 * submit and then fail to focus a box with `display: none`: Salvează did nothing and said nothing.
 * So every box in a hidden block is **read-only** while it is hidden: the standard bars a read-only
 * control from constraint validation and still posts its value. The service ignores what the
 * choice hides (`ignoreHiddenFields`, before its schema), and checks as typed only what every
 * choice keeps.
 *
 * A refusal about a box in here while it is hidden — one of the kept boxes, which the server
 * checks — arrives as `REVEAL_EVENT` from the box (`ActionForm`), and the block shows itself
 * until the answer changes, so the refusal names a box the reader can see and fix. The reveal
 * belongs to the answer it was made under and is **cleared when the answer changes**: switching
 * the mode away and back later hides the block again rather than finding an old reveal waiting.
 */
export function ShownWhen({ shown, answer, children }: { shown: boolean; answer: string; children: ReactNode }) {
  const block = useRef<HTMLDivElement>(null);
  const { generation } = useRecall();
  const [revealedFor, setRevealedFor] = useState<string | null>(null);
  // The answer the reveal was last checked against: a new answer drops the reveal, during render
  // (React's "adjusting state when a prop changes"), so no frame shows the stale one.
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
    // The generation: a refused save re-mounts the boxes from what was posted, without the attribute.
  }, [visible, answer, generation]);

  return (
    <Box ref={block} data-hidden-block={visible ? undefined : ""} sx={{ display: visible ? "block" : "none" }}>
      {children}
    </Box>
  );
}

/**
 * Shows its children while the form's type select says one of `type` (`DECISIONS.md` §71):
 * the gun time is a race's field and nobody planning a Sunday run should see it; since §111
 * the registration block and the programme are hidden the same way on a group run. A client
 * island with one observer on the select, chosen over a server round-trip because the select
 * is MUI's and the form is one save. The children are always in the DOM — hidden, not removed
 * — so a value typed before the type was changed is still posted; the service ignores a race
 * start on anything but a race, and the registration block on a group run. While hidden, its
 * boxes cannot block the save (`ShownWhen`).
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
