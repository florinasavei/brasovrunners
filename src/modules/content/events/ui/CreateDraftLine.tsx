"use client";

import Typography from "@mui/material/Typography";
import { type RefObject, useEffect, useRef, useState } from "react";
import { paintedScheduler } from "@/shared/forms/after-paint";
import { useRecall } from "@/shared/forms/recall";

/**
 * Whether the checkbox `name` in the form around `anchor` is ticked, re-read on change and after
 * a refused submit re-mounts it from the posted value without a `change` (§315).
 */
function useTicked(anchor: RefObject<HTMLElement | null>, name: string): boolean {
  const { generation } = useRecall();
  const [ticked, setTicked] = useState(false);
  useEffect(() => {
    const form = anchor.current?.closest("form");
    if (!form) return;
    const read = () => setTicked(new FormData(form).get(name) === "on");
    read();
    // Read after the frame, once per burst (§371): a save press fires `change` on the box it leaves.
    const scheduler = paintedScheduler(read);
    form.addEventListener("change", scheduler.schedule);
    return () => {
      form.removeEventListener("change", scheduler.schedule);
      scheduler.cancel();
    };
  }, [anchor, name, generation]);
  return ticked;
}

/**
 * The create page's Salvare line (§350): "Se creează ca ciornă", plus the series' dates while
 * "Repetă evenimentul" is ticked, so the press's result is said before the press.
 */
export default function CreateDraftLine({ draft, withSeries, repeatName }: { draft: string; withSeries: string; repeatName: string }) {
  const anchor = useRef<HTMLParagraphElement>(null);
  const repeats = useTicked(anchor, repeatName);
  return (
    <Typography ref={anchor} variant="body2" data-testid="create-draft-line">
      {repeats ? `${draft} ${withSeries}` : draft}
    </Typography>
  );
}

/**
 * A fold's closed line that follows one tick (§350), so the closed box never contradicts the
 * open one. A span: it sits inside the fold's heading.
 */
export function TickedLine({ name, off, on }: { name: string; off: string; on: string }) {
  const anchor = useRef<HTMLSpanElement>(null);
  const ticked = useTicked(anchor, name);
  return (
    <span ref={anchor} data-testid="ticked-line">
      {ticked ? on : off}
    </span>
  );
}
