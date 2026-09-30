"use client";

import Box from "@mui/material/Box";
import { type MouseEvent, type ReactNode, useEffect, useRef, useState } from "react";
import { type DraftPreviewView, type FromFrame, readPreviewMessage, type ToFrame } from "./draft-preview-messages";

type Answer =
  | { outcome: "forbidden" }
  | { outcome: "notFound" }
  | { outcome: "refused"; error: string; fields: string[] }
  | { outcome: "ready"; card: ReactNode; page: ReactNode; form: ReactNode; missing: Record<string, string[]> };

/**
 * The inside of the editor's «Previzualizare» frame (§579): a page of the site's own layout — its
 * theme, its fonts, its words in the frame's language, at the frame's own width, so a phone's
 * breakpoints are a phone's — that draws what the preview action answers and nothing else.
 *
 * It waits for the editor's values (`postMessage`, same origin, from the window that holds it
 * alone), posts them to `previewEventDraftAction` with its own language, and paints the card or the
 * page the server rendered with the listing's and the page's own components. It asks for nothing by
 * itself: no request on load, none on a timer, one per press the editor relays.
 *
 * A preview is not a site: a press on a link or a button inside it goes nowhere (the editor stays
 * where it is), and a form inside it sends nothing — the registration form of «Formular» (§NNN)
 * has no action and a disabled send button besides, and Enter in one of its boxes is stopped here.
 */
export default function EventDraftFrame({ action, locale }: { action: (form: FormData) => Promise<Answer>; locale: string }) {
  const [answer, setAnswer] = useState<Answer | null>(null);
  const [view, setView] = useState<DraftPreviewView>("card");
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const parent = window.parent;
    if (parent === window) return;
    const post = (message: FromFrame) => parent.postMessage(message, window.location.origin);
    let latest = 0;
    const onMessage = async (event: MessageEvent) => {
      if (event.origin !== window.location.origin || event.source !== parent) return;
      const message = readPreviewMessage<ToFrame>(event.data);
      if (!message) return;
      setView(message.view);
      if (message.type !== "br-draft-preview:render") return;
      const request = ++latest;
      const form = new FormData();
      for (const [name, value] of message.entries) form.append(name, value);
      form.set("previewLocale", locale);
      try {
        const answered = await action(form);
        if (request !== latest) return;
        setAnswer(answered);
        post({
          type: "br-draft-preview:result",
          snapshot: message.snapshot,
          outcome: answered.outcome,
          ...(answered.outcome === "refused" ? { error: answered.error, fields: answered.fields } : {}),
          ...(answered.outcome === "ready" ? { missing: answered.missing } : {}),
        });
      } catch {
        if (request === latest) post({ type: "br-draft-preview:result", snapshot: message.snapshot, outcome: "failed" });
      }
    };
    window.addEventListener("message", onMessage);
    post({ type: "br-draft-preview:ready" });
    return () => window.removeEventListener("message", onMessage);
  }, [action, locale]);

  // The frame is as tall as what it draws: the editor sizes it, so the preview never scrolls inside a scroll.
  useEffect(() => {
    const box = root.current;
    const parent = window.parent;
    if (!box || parent === window) return;
    const report = () =>
      parent.postMessage({ type: "br-draft-preview:height", height: Math.ceil(box.getBoundingClientRect().bottom + window.scrollY) + 24 } satisfies FromFrame, window.location.origin);
    const observer = new ResizeObserver(report);
    observer.observe(box);
    return () => observer.disconnect();
  }, []);

  const stop = (event: MouseEvent) => {
    const target = event.target as Element | null;
    // A fold (`<summary>`) still opens: it is part of how the page reads.
    if (target?.closest("summary")) return;
    if (target?.closest("a, button")) event.preventDefault();
  };

  return (
    <Box ref={root} id="draft-preview-frame" data-testid="draft-preview-frame" onClickCapture={stop} onSubmitCapture={(event) => event.preventDefault()}>
      {answer?.outcome === "ready" ? answer[view] : null}
    </Box>
  );
}
