"use client";

import { useEffect, useRef } from "react";
import { stravaFrameHeight } from "../domain/strava-frame-height";

/**
 * Makes Strava's frame as tall as its card (§NNN): listens for the height message the frame posts
 * (see `strava-frame-height.ts`) and sets the height of the frame beside it. Strava's card posts it
 * once, as soon as its own page is ready, so the listener goes on BEFORE the frame has an address:
 * the server draws the frame with `data-src` only, and this sets `src` after `addEventListener`.
 * Strings across the boundary only (§370); renders a hidden marker; the frame is found next to it,
 * never by searching the document (the same route twice on a page stays two frames).
 */
export default function StravaFrameHeight({ namespace }: { namespace: string }) {
  const marker = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const frame = marker.current?.parentElement?.querySelector<HTMLIFrameElement>("iframe[data-strava-ns]");
    if (!frame) return;
    const onMessage = (event: MessageEvent) => {
      const height = stravaFrameHeight(event, namespace, frame.contentWindow);
      if (height !== null) frame.style.height = `${height}px`;
    };
    window.addEventListener("message", onMessage);
    const src = frame.dataset.src;
    if (src && !frame.getAttribute("src")) frame.setAttribute("src", src);
    return () => window.removeEventListener("message", onMessage);
  }, [namespace]);
  return <span ref={marker} hidden />;
}
