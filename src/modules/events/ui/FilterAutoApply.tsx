"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useTransition } from "react";

/**
 * The listing's filter panel, applied on each tick (§413) — an enhancement, never the mechanism.
 *
 * The panel is a plain GET form a Server Component renders: with no script, ticking boxes and
 * pressing «Aplică» loads the same address this island would push. With a script this
 * island, mounted inside the form, hides that button (`data-enhanced` on the form) and turns each
 * change into a soft navigation to the address the form would have submitted — `FormData` over the
 * form's own fields, so the two can never build different addresses — keeping the page where it is.
 *
 * `ticked` is the state the server rendered, as `name=value` pairs. A soft navigation keeps the
 * form's DOM, and with it every box a reader ticked by hand: once the address changes some other
 * way — an active chip's ✕, "Șterge filtrele", the back button — each box is set to what the
 * address now says.
 *
 * Takes strings only, and renders an empty span: nothing crosses the boundary but data (§370).
 *
 * **The panel stays open across the first tick** (§549). The bare listing and calendar are static
 * pages the CDN answers, and a filtered address is their live twin — another route to the router
 * (`i18n/live-twin.ts`) — so the first tick, and the way back to no filter, mount the page afresh,
 * and the `<details>` would shut under the reader's finger. The tick itself says the panel was
 * open: it is remembered here, in the island's own module (which a soft navigation keeps), and the
 * next mount opens its panel again, once.
 *
 * **Which panel** (§NNN): the listing draws two — the cards ahead's and the past section's, inside
 * that section's own fold — so what is remembered is the `scope` that was ticked, and only that
 * panel reopens; the other is left as its page drew it. The past panel's fold sits inside the
 * section's `<details>`: `closest("details")` from the form is the panel's own fold, and reopening it
 * opens every fold around it too, so a reader who unticked the section's last box is not left with
 * its fold shut over the panel they were using.
 */
let reopenAfterTick: { scope: string; at: number } | null = null;

/** A tick that has not landed in this long is not coming: the memory of it is dropped, never kept for a later page. */
const REOPEN_WINDOW_MS = 10_000;

/**
 * Whether this panel is the one that was ticked, and the memory spent either way once the page that
 * answers the tick has committed (§NNN). If the ticked panel no longer renders — the reader unticked
 * the past section's last box and nothing is left to narrow — no instance consumes the value, and a
 * stale "past" would open a past panel mounted later from a shared link or the back button. So the
 * value is consumed by its own scope, dropped once it is old, and cleared after this commit's effects
 * have all run, whichever instance asked.
 */
function takeReopen(scope: string): boolean {
  const mine = reopenAfterTick !== null && reopenAfterTick.scope === scope && Date.now() - reopenAfterTick.at < REOPEN_WINDOW_MS;
  setTimeout(() => {
    reopenAfterTick = null;
  }, 0);
  return mine;
}

/** The panel's own fold, and every `<details>` around it, open. */
function openFolds(fold: HTMLDetailsElement | null) {
  for (let details = fold; details; details = details.parentElement?.closest("details") ?? null) details.open = true;
}

export default function FilterAutoApply({ scope, ticked }: { scope: string; ticked: string[] }) {
  const anchor = useRef<HTMLSpanElement>(null);
  const router = useRouter();
  const [, startTransition] = useTransition();

  useEffect(() => {
    const form = anchor.current?.closest("form");
    if (!form) return;
    form.dataset.enhanced = "true";
    if (takeReopen(scope)) openFolds(form.closest("details"));
    const apply = () => {
      reopenAfterTick = { scope, at: Date.now() };
      const params = new URLSearchParams();
      for (const [name, value] of new FormData(form)) if (typeof value === "string") params.append(name, value);
      const action = form.getAttribute("action") ?? window.location.pathname;
      const query = params.toString();
      startTransition(() => router.push(query ? `${action}?${query}` : action, { scroll: false }));
    };
    form.addEventListener("change", apply);
    return () => {
      form.removeEventListener("change", apply);
      delete form.dataset.enhanced;
    };
  }, [router, scope]);

  const key = ticked.join("&");
  useEffect(() => {
    const form = anchor.current?.closest("form");
    if (!form) return;
    // The tick landed on this same page (no fresh mount): nothing left to reopen later — but a fold
    // around the panel may have followed the new state shut (the past section's, §NNN).
    if (takeReopen(scope)) openFolds(form.closest("details"));
    const state = new Set(key ? key.split("&") : []);
    for (const box of form.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')) {
      box.checked = state.has(`${box.name}=${box.value}`);
    }
  }, [key, scope]);

  return <span ref={anchor} hidden />;
}
