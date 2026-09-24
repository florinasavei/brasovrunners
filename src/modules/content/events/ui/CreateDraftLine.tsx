"use client";

import Typography from "@mui/material/Typography";
import { type RefObject, useEffect, useRef, useState } from "react";
import { paintedScheduler } from "@/shared/forms/after-paint";
import { useRecall } from "@/shared/forms/recall";

/**
 * Whether the checkbox posting `name` in the form around `anchor` is ticked, read off the form as
 * it changes — and again after a refused submit, when the tick re-mounts from the posted value
 * (§315) without firing a `change`.
 */
function useTicked(anchor: RefObject<HTMLElement | null>, name: string): boolean {
  const { generation } = useRecall();
  const [ticked, setTicked] = useState(false);
  useEffect(() => {
    const form = anchor.current?.closest("form");
    if (!form) return;
    const read = () => setTicked(new FormData(form).get(name) === "on");
    read();
    // The whole form is read, and every box's `change` asks — the one a save button's press makes
    // on the box it leaves too — so after the frame, once for a burst (§371).
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
 * The create page's Salvare line (§350): "Se creează ca ciornă", and — while "Repetă evenimentul"
 * is ticked in the Recurență box — "și datele seriei din următoarele opt săptămâni", read off the
 * form as it changes, so what the press will make is said before the press.
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
 * A fold's closed line that follows one tick of the form (§350): the create page's Recurență box
 * reads "Nu se repetă" until "Repetă evenimentul" is ticked and "Se repetă" once it is, so the
 * closed box never contradicts the box open under it. A span, because it sits inside the fold's
 * heading.
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
