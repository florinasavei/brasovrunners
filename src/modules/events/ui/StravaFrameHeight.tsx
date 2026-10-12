"use client";

import { useEffect } from "react";
import { stravaFrameHeight } from "../domain/strava-frame-height";

/**
 * Makes Strava's frame as tall as its card (§NNN): listens for the height message the frame posts
 * (see `strava-frame-height.ts`) and sets the height of the frame that carries `data-strava-ns`.
 * Strings across the boundary only (§370); renders nothing. Without scripts the frame keeps the
 * fallback height the server gave it.
 */
export default function StravaFrameHeight({ namespace }: { namespace: string }) {
  useEffect(() => {
    const frame = Array.from(document.querySelectorAll<HTMLIFrameElement>("iframe[data-strava-ns]")).find(
      (candidate) => candidate.dataset.stravaNs === namespace,
    );
    if (!frame) return;
    const onMessage = (event: MessageEvent) => {
      const height = stravaFrameHeight(event, namespace, frame.contentWindow);
      if (height !== null) frame.style.height = `${height}px`;
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [namespace]);
  return null;
}
