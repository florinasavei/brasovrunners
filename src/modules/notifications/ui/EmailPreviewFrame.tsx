"use client";

import Box from "@mui/material/Box";
import { useCallback, useEffect, useRef, useState } from "react";
import GlyphButton from "@/shared/ui/GlyphButton";
import { TAP_TARGET } from "@/shared/ui/tap-target";

/** The frame as a window onto the email: the height the email previews have had since §91. */
export const EMAIL_PREVIEW_WINDOW_PX = 620;

type Props = {
  /** The email as the template rendered it: a whole document, with an `<html>` and styles of its own. */
  html: string;
  /** The frame's title, for a screen reader. */
  title: string;
  labels: { enlarge: string; shrink: string };
};

/**
 * An email preview that can be enlarged (§946; the owner, of the composer's «Cum arată emailul»: «ar trebui sa pot
 * mari sectiunea asta»).
 *
 * As drawn, the frame is a 620-pixel window onto the email, scrolled inside while the page scrolls around it — and a
 * message with its words, the QR block, the buttons and the footer is three windows long. «Mărește» makes the frame as
 * tall as the email, so the page's own scroll reads all of it; «Micșorează» returns the window.
 *
 * **The window keeps every restriction (`sandbox=""`, §91).** The height of a document in such a frame cannot be read
 * from outside it, so the enlarged frame holds the same document under `sandbox="allow-same-origin"`: still no script,
 * no form, no popup and no navigation of the page around it — the one thing added is that this component may read the
 * document's height. A frame's restrictions are fixed when its document loads, so the frame is made anew on the switch
 * (`key`).
 *
 * Measured on every load — the composer replaces the document as the words change — and whenever the frame's own box
 * changes: its width, since an email wraps on a narrow screen, and its height once a measure is drawn, since a
 * scrollbar that is gone widens the page it stood on. The email is a standards-mode document whose root has no height
 * of its own (`templates.ts`), so the root's box is the content's: it also shrinks when words are deleted.
 */
export default function EmailPreviewFrame({ html, title, labels }: Props) {
  const [enlarged, setEnlarged] = useState(false);
  // The email's own height, read from the frame while enlarged; null until its document has loaded.
  const [whole, setWhole] = useState<number | null>(null);
  const frame = useRef<HTMLIFrameElement | null>(null);

  const measure = useCallback(() => {
    const root = frame.current?.contentDocument?.documentElement;
    if (!root) return;
    const height = Math.ceil(root.getBoundingClientRect().height);
    // Nothing yet: the frame's first, empty document, before the email's own has loaded.
    if (height > 0) setWhole(height);
  }, []);

  useEffect(() => {
    const element = frame.current;
    if (!enlarged || !element || typeof ResizeObserver === "undefined") return;
    // The frame's own box: its width when the page's changes, its height when a measure was drawn. The email is
    // measured again each time, and a measure that finds the same height changes nothing and ends there.
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [enlarged, measure]);

  // Never smaller than the window: an email shorter than it is already whole.
  const height = enlarged && whole ? Math.max(EMAIL_PREVIEW_WINDOW_PX, whole) : EMAIL_PREVIEW_WINDOW_PX;

  return (
    <Box data-testid="email-preview" data-enlarged={enlarged ? "true" : "false"}>
      <Box sx={{ display: "flex", justifyContent: "flex-end", mb: 0.5 }}>
        <GlyphButton
          type="button"
          icon={enlarged ? "shrink" : "enlarge"}
          variant="text"
          size="small"
          onClick={() => {
            setWhole(null);
            setEnlarged((now) => !now);
          }}
          sx={TAP_TARGET}
          data-testid="email-preview-size"
        >
          {enlarged ? labels.shrink : labels.enlarge}
        </GlyphButton>
      </Box>
      {/* The border is the wrapper's, so the frame's height is the email's own, whatever the page's box sizing. */}
      <Box sx={{ border: 1, borderColor: "divider", borderRadius: 1, overflow: "hidden" }}>
        {/* Sandboxed: an email has its own `<html>` and styles and must not inherit the backoffice's (§91). */}
        <Box
          component="iframe"
          key={enlarged ? "whole" : "window"}
          ref={frame}
          srcDoc={html}
          sandbox={enlarged ? "allow-same-origin" : ""}
          title={title}
          onLoad={enlarged ? measure : undefined}
          sx={{ display: "block", width: "100%", height, border: 0 }}
        />
      </Box>
    </Box>
  );
}
