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
 */
export default function FilterAutoApply({ ticked }: { ticked: string[] }) {
  const anchor = useRef<HTMLSpanElement>(null);
  const router = useRouter();
  const [, startTransition] = useTransition();

  useEffect(() => {
    const form = anchor.current?.closest("form");
    if (!form) return;
    form.dataset.enhanced = "true";
    const apply = () => {
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
  }, [router]);

  const key = ticked.join("&");
  useEffect(() => {
    const form = anchor.current?.closest("form");
    if (!form) return;
    const state = new Set(key ? key.split("&") : []);
    for (const box of form.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')) {
      box.checked = state.has(`${box.name}=${box.value}`);
    }
  }, [key]);

  return <span ref={anchor} hidden />;
}
