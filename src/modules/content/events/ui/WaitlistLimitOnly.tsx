"use client";

import { type ReactNode, useCallback, useEffect, useRef, useSyncExternalStore } from "react";
import { useRecall } from "@/shared/forms/recall";
import { choiceAfterTyping, WAITLIST_CHOICE_FIELD, WAITLIST_LENGTH_FIELD, type WaitlistChoice } from "../waitlist-choice";
import { ShownWhen } from "./OnlyForType";

/** The select «Lista de așteptare» posts from: a native one, so the island may set its answer. */
function choiceSelect(): HTMLSelectElement | null {
  return document.querySelector<HTMLSelectElement>(`select[name="${WAITLIST_CHOICE_FIELD}"]`);
}

/**
 * What «Lista de așteptare» says right now (§NNN). `useSelectedValue`'s twin for a native select,
 * which fires a `change` event where MUI's own select only rewrites a hidden input; renewed on every
 * answer of a kept form (§315), because the select re-mounts from what was posted.
 */
function useWaitlistChoice(initialChoice: WaitlistChoice): string {
  const recall = useRecall();
  const fallback = recall.value(WAITLIST_CHOICE_FIELD) ?? initialChoice;
  const subscribe = useCallback(
    (notify: () => void) => {
      const select = choiceSelect();
      if (!select) return () => undefined;
      select.addEventListener("change", notify);
      return () => select.removeEventListener("change", notify);
    },
    // The generation is what renews the subscription after a re-mount of the select.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [recall.generation],
  );
  return useSyncExternalStore(subscribe, () => choiceSelect()?.value ?? fallback, () => fallback);
}

/**
 * The number under «Limitată la un număr de locuri» (§NNN, the owner: «dacă pun 0 să se bifeze
 * automat listă infinită»), shown only while that is the answer — `OnlyForMode`'s sibling, over the
 * waiting list's select, through the same `ShownWhen`, so the box is read-only while hidden and its
 * `min` never stops the save.
 *
 * One rule of its own: a box left empty or at 0 under «Limitată» switches the select to
 * «Nelimitată» there and then, so the box hides and the save stores no limit. Judged when the box
 * is left (`change`), not on every key, so emptying "20" to type "15" does not hide the box under
 * the thumb; a box the browser cannot read as a number (`badInput`) is left for the browser to
 * refuse. The server applies the same rule without JavaScript (`service.ts#ignoreHiddenFields`), so
 * a 0 typed here is never stored as "no waiting list": only «Fără listă de așteptare» stores that.
 */
export default function WaitlistLimitOnly({ initialChoice, children }: { initialChoice: WaitlistChoice; children: ReactNode }) {
  const current = useWaitlistChoice(initialChoice);
  const block = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const element = block.current;
    if (!element) return;
    const onChange = (event: Event) => {
      const box = event.target;
      if (!(box instanceof HTMLInputElement) || box.name !== WAITLIST_LENGTH_FIELD) return;
      const select = choiceSelect();
      if (!select) return;
      const next = choiceAfterTyping(select.value, box.value, box.validity.badInput);
      if (next === select.value) return;
      // Emptied, so «Limitată» chosen again opens on a box the save accepts (its `min` is 1). Through
      // the native setter and an `input` event, so React's onChange runs and MUI lowers the label.
      if (next === "UNLIMITED" && box.value !== "") {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(box, "");
        box.dispatchEvent(new Event("input", { bubbles: true }));
      }
      select.value = next;
      select.dispatchEvent(new Event("change", { bubbles: true }));
    };
    element.addEventListener("change", onChange);
    return () => element.removeEventListener("change", onChange);
  }, []);

  return (
    <ShownWhen shown={current === "LIMITED"} answer={current}>
      <div ref={block} data-testid="waitlist-limit">
        {children}
      </div>
    </ShownWhen>
  );
}
