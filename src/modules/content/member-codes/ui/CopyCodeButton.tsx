"use client";

import CheckIcon from "@mui/icons-material/Check";
import ContentCopyIcon from "@mui/icons-material/ContentCopy";
import Button from "@mui/material/Button";
import { useState } from "react";
import { copyText } from "./copy-text";

/** How long the button says «Copiat» (§674): two seconds, then its word again. */
const COPIED_FOR_MS = 2000;

/**
 * «Copiază codul» (§552): the site's one clipboard island — the members' codes, «Ce le spui» and,
 * since §674, the calendar's address. The text itself is in the server's HTML, in a box a person
 * can select and copy without JavaScript; this puts it on the clipboard in one press and says so,
 * glyph beside the word. A clipboard the browser refuses (an insecure context, an old browser)
 * selects the text in the box named by `selectId` instead (`copy-text.ts`), so the press is never
 * silent where there is a box to select.
 */
export default function CopyCodeButton({
  code,
  label,
  copiedLabel,
  selectId,
}: {
  code: string;
  label: string;
  copiedLabel: string;
  /** The `id` of the read-only `<input>` that shows `code`, selected when the clipboard is refused. */
  selectId?: string;
}) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      type="button"
      variant="outlined"
      size="small"
      sx={{ minHeight: 44, gap: 0.75, flexShrink: 0 }}
      onClick={async () => {
        const box = selectId ? document.getElementById(selectId) : null;
        const outcome = await copyText(code, box instanceof HTMLInputElement ? box : null);
        if (outcome !== "copied") return;
        setCopied(true);
        window.setTimeout(() => setCopied(false), COPIED_FOR_MS);
      }}
      aria-live="polite"
      data-testid="copy-code"
    >
      {copied ? <CheckIcon aria-hidden="true" sx={{ fontSize: 18 }} /> : <ContentCopyIcon aria-hidden="true" sx={{ fontSize: 18 }} />}
      {copied ? copiedLabel : label}
    </Button>
  );
}
