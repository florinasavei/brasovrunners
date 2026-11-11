"use client";

import { type ReactNode, useEffect, useRef } from "react";
import { mayReconfirmNow } from "../domain/reconfirm-press";

/**
 * The one thing this island does: press «Da, vin la cursă» once, by itself, when a person opens the email's «Vin» — the
 * manage page at `#reconfirm` — in a browser (the decision «Cere reconfirmarea»: one press counts). The «Da, vin» link
 * page's pattern (`rsvp/ui/AutoConfirm.tsx`; the owner, 2026-10-19: «Asta ar trebui să se auto-bifeze când deschid»).
 * It wraps the page's form — drawn by the Server Component with its button, so without JavaScript the button stands and
 * works — and, after hydration, calls the form's `requestSubmit()`, which is the very press: the POST in `actions.ts`
 * reads the token, never spends it, records the first moment and lands on `?reconfirm=1#reconfirm`, where the page shows
 * the noted answer and draws no island.
 *
 * **Why the GET is still safe** (AGENTS.md §12.8, BR-REQ-036-02 criterion 4): the GET renders and writes nothing. A
 * scanner that fetches the link without running its scripts, and a browser without JavaScript, see the button and count
 * nobody; this file presses only at `#reconfirm`, while the page is not prerendered and its tab is shown
 * (`mayReconfirmNow`). **Accepted residual risk**, as on the link page: a mail scanner that renders the page in a real
 * browser, with scripts, can count somebody; the answer changes nothing about the registration. Once only: a ref
 * remembers the press, so React's double effect, a re-render or the tab shown again never sends a second one; the server
 * draws the island only for the link's own registration with its question open and no answer or refusal in the address.
 *
 * It earns being a client file because pressing a button needs a browser; it draws nothing of its own.
 */
export default function ReconfirmOnArrival({ children }: { children: ReactNode }) {
  const wrapper = useRef<HTMLDivElement>(null);
  const pressed = useRef(false);

  useEffect(() => {
    if (pressed.current) return;
    const form = wrapper.current?.querySelector("form");
    if (!form) return;

    const press = () => {
      const page = { hash: window.location.hash, prerendering: (document as Document & { prerendering?: boolean }).prerendering, visibilityState: document.visibilityState };
      if (pressed.current || !mayReconfirmNow(page)) return;
      pressed.current = true;
      stop();
      form.requestSubmit();
    };
    const stop = () => {
      document.removeEventListener("visibilitychange", press);
      document.removeEventListener("prerenderingchange", press);
    };
    document.addEventListener("visibilitychange", press);
    document.addEventListener("prerenderingchange", press);
    press();
    return stop;
  }, []);

  return (
    <div ref={wrapper} data-testid="manage-reconfirm-auto">
      {children}
    </div>
  );
}
