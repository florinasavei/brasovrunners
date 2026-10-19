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
 * **Why the page's GET is still safe** (AGENTS.md §12.8, BR-REQ-036-02 criterion 4): the GET renders and writes nothing. A scanner that
 * fetches the page without running its scripts, and a browser without JavaScript, see the button and count nobody; a browser that does
 * run this file presses only when it is not prerendering the page and the tab is shown (`mayCountNow` — it waits for the tab to be
 * shown). **Accepted residual risk:** a link sandbox that renders the page in a real browser, with scripts, looks like a shown tab and
 * does press; the person's own click then reads «Ești deja numărat» and their browser is not remembered. The owner accepted it for
 * «auto-bifeze când deschid»; «Nu mai vin» in the same email takes the answer back. Once only: a ref remembers the press,
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

  return (
    <div ref={wrapper} data-testid="rsvp-auto-confirm">
      {children}
    </div>
  );
}
