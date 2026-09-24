"use client";

import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import { useEffect, useRef, useState } from "react";
import { bibPreviewUrl, isBibDesignInput, readBibDesignForm } from "@/modules/registrations/bib-design-query";
import { BIB_IMAGE } from "@/modules/registrations/bib-geometry";

/** How long the boxes may keep changing before the picture is asked for again. */
const SETTLE_MS = 300;

/**
 * The bib as it would print, redrawn while the design panel's boxes change and before anything
 * is saved (the owner: "la BID îmi trebuie un preview aici").
 *
 * One `<img>`, whose `src` is the picture route in sample mode with the form's current values
 * in the query string — so the picture is `bib-image.tsx`'s, the same card the sheet prints
 * (§180), never a drawing of its own. The Server Component gives it the first `src`, from the
 * stored design, so the picture is on the page before any script runs; the island's whole job
 * is to rebuild that `src` when a box changes.
 *
 * It reads the form the way the save does: `new FormData(form)` on the `<form>` it sits in,
 * gathered by `readBibDesignForm` — the reader `admin/actions.ts` uses — so what is previewed is
 * exactly what would be posted. The boxes are the panel's (`event.bibDesign.*`), the band's
 * colour and the start number, which live in the same form a little above the panel; a
 * keystroke in the title changes no bib and asks for no picture. Native `input` and `change`
 * bubble from every one of those controls (checkboxes, native selects, radios and a number
 * box), so one listener on the form is the subscription, and no global state is kept anywhere.
 */
export default function BibDesignPreview({
  eventId,
  locale,
  initialSrc,
  labels,
}: {
  eventId: string;
  locale: string;
  /** The address of the bib as stored, computed on the server. */
  initialSrc: string;
  labels: { alt: string; caption: string };
}) {
  const root = useRef<HTMLElement>(null);
  const [src, setSrc] = useState(initialSrc);

  useEffect(() => {
    const form = root.current?.closest("form");
    if (!form) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const redraw = () => {
      const data = new FormData(form);
      const get = (name: string) => {
        const value = data.get(name);
        return typeof value === "string" ? value : null;
      };
      setSrc(
        bibPreviewUrl({
          eventId,
          locale,
          number: get("event.bibStartNumber"),
          colour: get("event.bibColour"),
          design: readBibDesignForm(get),
        }),
      );
    };
    const onChange = (event: Event) => {
      const target = event.target;
      if (!(target instanceof HTMLInputElement || target instanceof HTMLSelectElement)) return;
      if (!isBibDesignInput(target.name)) return;
      clearTimeout(timer);
      timer = setTimeout(redraw, SETTLE_MS);
    };
    form.addEventListener("input", onChange);
    form.addEventListener("change", onChange);
    return () => {
      clearTimeout(timer);
      form.removeEventListener("input", onChange);
      form.removeEventListener("change", onChange);
    };
  }, [eventId, locale]);

  return (
    <Box ref={root} component="figure" sx={{ m: 0, maxWidth: 320 }} data-testid="bib-design-preview">
      {/* The paper's own proportion (A5, 990×700, §NNN) is declared, so the box keeps its height
          while a fresh picture is on its way and the panel below does not jump. */}
      <Box
        component="img"
        src={src}
        alt={labels.alt}
        width={BIB_IMAGE.width}
        height={BIB_IMAGE.height}
        loading="lazy"
        decoding="async"
        sx={{ display: "block", width: "100%", height: "auto", borderRadius: 1, border: 1, borderColor: "divider" }}
      />
      <Typography component="figcaption" variant="caption" color="text.secondary" sx={{ display: "block", mt: 0.5 }}>
        {labels.caption}
      </Typography>
    </Box>
  );
}
