"use client";

import CheckIcon from "@mui/icons-material/Check";
import ContentCopyIcon from "@mui/icons-material/ContentCopy";
import Button from "@mui/material/Button";
import { useState } from "react";

/**
 * «Copiază codul» (§552): the one client island of the members' codes — the code itself is in the
 * server's HTML, in a monospace box a person can select and copy without JavaScript; this puts it on
 * the clipboard in one press and says so, glyph beside the word. A clipboard the browser refuses
 * (an insecure context, an old browser) changes nothing: the box is still there to select.
 */
export default function CopyCodeButton({ code, label, copiedLabel }: { code: string; label: string; copiedLabel: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      type="button"
      variant="outlined"
      size="small"
      sx={{ minHeight: 44, gap: 0.75, flexShrink: 0 }}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(code);
          setCopied(true);
          window.setTimeout(() => setCopied(false), 2500);
        } catch {
          // Nothing to say: the code stays selectable in its box.
        }
      }}
      aria-live="polite"
      data-testid="copy-code"
    >
      {copied ? <CheckIcon aria-hidden="true" sx={{ fontSize: 18 }} /> : <ContentCopyIcon aria-hidden="true" sx={{ fontSize: 18 }} />}
      {copied ? copiedLabel : label}
    </Button>
  );
}
