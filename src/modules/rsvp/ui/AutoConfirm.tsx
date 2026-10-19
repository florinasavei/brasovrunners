"use client";

import { type ReactNode, useEffect, useRef } from "react";
import { mayCountNow } from "../domain/auto-confirm";

/**
 * The one thing this island does: press «Da, vin» once, by itself, when a person opens the link in a browser (§812, amending §811; the
 * owner, 2026-10-19: «Asta ar trebui să se auto-bifeze când deschid»). It wraps the page's form — drawn by the Server Component with its
 * button, so without JavaScript the button stands and works — and, after hydration, calls the form's `requestSubmit()`, which is the very
 * press: the POST in `actions.ts` spends the link, counts the answer, remembers the browser and lands on the event page's `#vin`. The
 * button's own pending label («Te numărăm…») shows while it runs.
 *
 * **Why the page's GET is still safe** (AGENTS.md §12.8, BR-REQ-036-02 criterion 4): the GET renders and writes nothing. A mail scanner
 * fetches it and does not run this file; a browser that does run it presses only when the page is one a person is looking at
 * (`mayCountNow`: not prerendering, not in a background tab — it waits for the tab to be shown). Once only: a ref remembers the press,
 * so React's double effect in development, a re-render, or the tab being shown and hidden again never sends a second one.
 *
 * It earns being a client file because pressing a button needs a browser; it draws nothing of its own.
 */
export default function AutoConfirm({ children }: { children: ReactNode }) {
  const wrapper = useRef<HTMLDivElement>(null);
  const pressed = useRef(false);

  useEffect(() => {
    if (pressed.current) return;
    const form = wrapper.current?.querySelector("form");
    if (!form) return;

    const press = () => {
      if (pressed.current || !mayCountNow({ prerendering: (document as Document & { prerendering?: boolean }).prerendering, visibilityState: document.visibilityState })) return;
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

  return <div ref={wrapper}>{children}</div>;
}
