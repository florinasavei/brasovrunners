"use client";

import PrintIcon from "@mui/icons-material/Print";
import Button from "@mui/material/Button";

/**
 * "Print" — the one thing a page meant for paper cannot do without JavaScript (§NNN).
 *
 * A client island for a single call, and it earns it on the one page that is printed and
 * carried: the emergency sheet. It takes a label and nothing else — no row, no name, no field
 * of a participant crosses into it (`tests/privacy/admin-client-boundary.test.ts`) — and it hides
 * itself on the paper it produces. With JavaScript off the browser's own print still works.
 */
export default function PrintButton({ label }: { label: string }) {
  return (
    <Button
      type="button"
      variant="outlined"
      startIcon={<PrintIcon />}
      onClick={() => window.print()}
      sx={{ minHeight: 44, "@media print": { display: "none" } }}
    >
      {label}
    </Button>
  );
}
