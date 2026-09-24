"use client";

import Typography from "@mui/material/Typography";
import { useEffect, useRef, useState } from "react";

/**
 * The create page's Salvare line (§NNN): "Se creează ca ciornă", and — while "Repetă evenimentul"
 * is ticked in the Recurență box — "și datele seriei din următoarele opt săptămâni", read off the
 * form as it changes, so what the press will make is said before the press.
 */
export default function CreateDraftLine({ draft, withSeries, repeatName }: { draft: string; withSeries: string; repeatName: string }) {
  const anchor = useRef<HTMLParagraphElement>(null);
  const [repeats, setRepeats] = useState(false);
  useEffect(() => {
    const form = anchor.current?.closest("form");
    if (!form) return;
    const read = () => setRepeats(new FormData(form).get(repeatName) === "on");
    read();
    form.addEventListener("change", read);
    return () => form.removeEventListener("change", read);
  }, [repeatName]);
  return (
    <Typography ref={anchor} variant="body2" data-testid="create-draft-line">
      {repeats ? `${draft} ${withSeries}` : draft}
    </Typography>
  );
}
