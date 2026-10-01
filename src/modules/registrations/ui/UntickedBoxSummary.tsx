"use client";

import Alert from "@mui/material/Alert";
import MuiLink from "@mui/material/Link";
import { useEffect, useRef, useState } from "react";

/**
 * The error summary for a required acceptance box left unticked (§NNN): one line, a link to the box.
 *
 * It is the page's summary in both ways it can appear. After a press the server refused
 * (`?invalid=accept`) the page renders it with `initial`, so it is in the HTML with no script. With
 * a script, it listens on the form that holds the box: when the browser finds the box required and
 * unticked (`invalid`), the summary shows and takes focus at once, with no navigation — MUI hides
 * the native input, and the browser's own bubble for it does not show on a phone. The native
 * `required` still stops the submit; only its bubble is replaced. Ticking the box takes the
 * summary away. Strings in, never elements (AGENTS.md §14.1).
 */
export default function UntickedBoxSummary({
  boxId,
  summaryId,
  message,
  initial = false,
}: {
  /** The box's `id`: what the link points at and what the form's `invalid` event is matched to. */
  boxId: string;
  /** The summary's own `id`, the target of the redirect's fragment on the pages that use one. */
  summaryId: string;
  /** The sentence, already translated; it is the link's text. */
  message: string;
  /** Shown from the first paint: the server refused an unticked box. */
  initial?: boolean;
}) {
  const [shown, setShown] = useState(initial);
  const [presses, setPresses] = useState(0);
  const summary = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const form = document.getElementById(boxId)?.closest("form");
    if (!form) return;
    // `invalid` does not bubble: caught on the way down, before the browser looks for a box to focus.
    const onInvalid = (event: Event) => {
      if ((event.target as HTMLElement | null)?.id !== boxId) return;
      event.preventDefault();
      setShown(true);
      // Take focus only when the box is the first invalid control; otherwise the browser's own
      // bubble for the earlier field stays and is not dismissed by the summary.
      if (form.querySelector(":invalid") === event.target) setPresses((count) => count + 1);
    };
    const onChange = (event: Event) => {
      const target = event.target as HTMLInputElement | null;
      if (target?.id === boxId && target.checked) setShown(false);
    };
    form.addEventListener("invalid", onInvalid, true);
    form.addEventListener("change", onChange);
    return () => {
      form.removeEventListener("invalid", onInvalid, true);
      form.removeEventListener("change", onChange);
    };
  }, [boxId]);

  // Each refused press brings the reader to the summary, as the server's own redirect does.
  useEffect(() => {
    if (presses > 0) summary.current?.focus();
  }, [presses]);

  if (!shown) return null;
  return (
    <Alert ref={summary} severity="error" id={summaryId} role="alert" tabIndex={-1} sx={{ mb: 3, scrollMarginTop: 16 }} data-testid="unticked-box-summary">
      <MuiLink href={`#${boxId}`}>{message}</MuiLink>
    </Alert>
  );
}
