"use client";

import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import { useEffect, useRef, useState } from "react";
import { bibPreviewUrl, isBibDesignInput, readBibDesignForm } from "@/modules/registrations/bib-design-query";
import { BIB_IMAGE } from "@/modules/registrations/bib-geometry";

/** How long the boxes may keep changing before the picture is asked for again. */
const SETTLE_MS = 300;

/**
 * The bib as it would print, redrawn as the design boxes change, before saving. One `<img>` whose
 * `src` is the picture route in sample mode with the form's values in the query, so the picture is
 * `bib-image.tsx`'s own (§180). The form is read with `readBibDesignForm`, the reader the save
 * uses; one `input`/`change` listener on the form is the whole subscription.
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
      {/* A5's proportion (§338) is declared so the box keeps its height while a picture loads. No
          frame of its own: the picture draws the paper's edge. */}
      <Box
        component="img"
        src={src}
        alt={labels.alt}
        width={BIB_IMAGE.width}
        height={BIB_IMAGE.height}
        loading="lazy"
        decoding="async"
        sx={{ display: "block", width: "100%", height: "auto" }}
      />
      <Typography component="figcaption" variant="caption" color="text.secondary" sx={{ display: "block", mt: 0.5 }}>
        {labels.caption}
      </Typography>
    </Box>
  );
}
