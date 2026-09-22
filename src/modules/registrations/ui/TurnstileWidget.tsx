"use client";

import Box from "@mui/material/Box";
import { useEffect, useRef } from "react";
import { TURNSTILE_SCRIPT_URL } from "../turnstile";

/**
 * Cloudflare Turnstile, rendered explicitly and reset on every attempt (`DECISIONS.md` §185).
 *
 * The form used Cloudflare's implicit mode: `<div class="cf-turnstile">` in the server's markup
 * and `api.js` loaded beside it. That works exactly once. `api.js` scans the document when it
 * loads and never again, and the token it produces is **single use** — so the moment a
 * submission comes back with anything wrong on it, the server re-renders the form, React reuses
 * the same empty div, no script load happens, no widget is drawn, and the visitor is left with
 * "tick the box again" printed above nothing to tick. Every attempt after the first then fails
 * on a missing token, whatever else they fix. The owner, with a screenshot of exactly that:
 * "faza asta cu robotul man!!! implementeaza corect!!"
 *
 * So: explicit rendering. The script is injected once per document — `data-turnstile` marks it,
 * because two copies of `api.js` is a Cloudflare error, not a second widget — the widget is
 * drawn into this element when the script is ready, and `reset()` is called whenever `attempt`
 * changes. The server passes its own render time as `attempt`, which is a new value on every
 * response and therefore on every failed submission.
 *
 * A client island of about thirty lines, which is what §1.5 asks a client island to justify:
 * nothing here can be done on the server, because the thing being fixed is what happens to the
 * DOM after the server has answered.
 */

type TurnstileApi = {
  render: (element: HTMLElement, options: { sitekey: string; language?: string }) => string;
  reset: (widgetId?: string) => void;
  remove: (widgetId: string) => void;
};

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

export default function TurnstileWidget({
  siteKey,
  locale,
  attempt,
}: {
  siteKey: string;
  locale: string;
  /** Any value that changes on every server render; the widget is reset when it does. */
  attempt: string;
}) {
  const holder = useRef<HTMLDivElement | null>(null);
  const widgetId = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    const draw = () => {
      if (cancelled || !holder.current || !window.turnstile) return;
      // Already drawn: the token has been spent, so ask for a fresh challenge rather than a
      // second widget — `render` into an occupied element is a Cloudflare error.
      if (widgetId.current !== null) {
        window.turnstile.reset(widgetId.current);
        return;
      }
      widgetId.current = window.turnstile.render(holder.current, { sitekey: siteKey, language: locale });
    };

    if (window.turnstile) {
      draw();
      return () => {
        cancelled = true;
      };
    }

    const selector = "script[data-turnstile]";
    const existing = document.querySelector<HTMLScriptElement>(selector);
    const script = existing ?? document.createElement("script");
    if (!existing) {
      script.src = `${TURNSTILE_SCRIPT_URL}?render=explicit`;
      script.async = true;
      script.defer = true;
      script.dataset.turnstile = "true";
      document.head.append(script);
    }
    script.addEventListener("load", draw);
    return () => {
      cancelled = true;
      script.removeEventListener("load", draw);
    };
  }, [siteKey, locale, attempt]);

  /*
    Hand the widget back when this island goes away (§284).

    Cloudflare keeps its own registry keyed by the id `render` returned, and it does not notice
    the element leaving the document — so a form unmounted by a client navigation left an orphan
    behind, which is the console's "Cannot find Widget cf-chl-widget-…, consider using
    turnstile.remove() to clean up a widget". The next mount then drew a *second* widget beside
    the ghost, and the token a submission carried was whichever of them the API answered for.

    Its own effect with no dependencies, so it runs on unmount and never between attempts: the
    effect above deliberately keeps one widget alive and `reset()`s it, because a fresh challenge
    is the point and a fresh widget is not.
  */
  useEffect(
    () => () => {
      const id = widgetId.current;
      widgetId.current = null;
      if (!id || !window.turnstile) return;
      try {
        window.turnstile.remove(id);
      } catch {
        // A widget Cloudflare has already forgotten is not a failure worth a console line of
        // ours on top of theirs.
      }
    },
    [],
  );

  // `min-height` so the form does not jump when the challenge draws itself a moment later.
  return <Box ref={holder} sx={{ minHeight: 65 }} />;
}
