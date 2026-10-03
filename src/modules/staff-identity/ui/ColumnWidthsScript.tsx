"use client";

import { useCallback, useSyncExternalStore } from "react";
import { earlyWidthsScript } from "./column-widths-script";

/**
 * The pre-paint script of a resized table (§NNN, `column-widths-script.ts`), right after its
 * `</table>`.
 *
 * A client component only so that it exists in the server's HTML and the hydration that adopts it,
 * and in nothing the browser renders itself: on a soft navigation (a sort, a page turned) React
 * would create the `<script>` on the client, where it never runs and React warns that it never
 * will. There `ColumnWidths` lays the table out in a layout effect before that commit paints, so
 * nothing jumps without it. It receives the table's id, a string, and nothing else.
 */
export default function ColumnWidthsScript({ tableId }: { tableId: string }) {
  const hydrated = useSyncExternalStore(
    useCallback(() => () => {}, []),
    () => true,
    () => false,
  );
  if (hydrated) return null;
  return <script data-column-widths-script={tableId} dangerouslySetInnerHTML={{ __html: earlyWidthsScript(tableId) }} />;
}
