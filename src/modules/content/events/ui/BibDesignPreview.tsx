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
 * The two picture places (`BibPictureField`, §560) fire `change` on their hidden fields when a
 * picture or its crop changes, so they join the same listener.
 *
 * **The press paints first (§371).** The moment a box changes the picture dims and says it is
 * being redrawn — before the settle and the request — and comes back when the new one has loaded.
 */
export default function BibDesignPreview({
  eventId,
  locale,
  initialSrc,
  labels,
  member = false,
}: {
  eventId: string;
  locale: string;
  /** The address of the bib as stored, computed on the server. */
  initialSrc: string;
  labels: { alt: string; caption: string; pending: string };
  /** A member's bib (§NNN): the same sample with the members' header and label. */
  member?: boolean;
}) {
  const root = useRef<HTMLElement>(null);
  const [src, setSrc] = useState(initialSrc);
  /** A change is on its way: dimmed until the new picture loads (or the address did not move). */
  const [pending, setPending] = useState(false);
  const shown = useRef(initialSrc);

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
      const next = bibPreviewUrl({
        eventId,
        locale,
        number: get("event.bibStartNumber"),
        colour: get("event.bibColour"),
        design: readBibDesignForm(get),
        member,
      });
      // The same address loads nothing, so nothing would ever say it arrived.
      if (next === shown.current) setPending(false);
      shown.current = next;
      setSrc(next);
    };
    const onChange = (event: Event) => {
      const target = event.target;
      if (!(target instanceof HTMLInputElement || target instanceof HTMLSelectElement)) return;
      if (!isBibDesignInput(target.name)) return;
      setPending(true);
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
  }, [eventId, locale, member]);

  return (
    <Box ref={root} component="figure" sx={{ m: 0, maxWidth: 320 }} data-testid={member ? "bib-design-preview-member" : "bib-design-preview"} aria-busy={pending || undefined}>
      {/* The paper's own proportion (A5, 990×700, §338) is declared, so the box keeps its height
          while a fresh picture is on its way and the panel below does not jump. No border and no
          rounded corner of its own: the picture draws the paper's edge itself (`bib-image.tsx`,
          A5 bibs §338), and a second frame round it read as a double line with its corners
          clipped. */}
      <Box
        component="img"
        src={src}
        alt={labels.alt}
        width={BIB_IMAGE.width}
        height={BIB_IMAGE.height}
        loading="lazy"
        decoding="async"
        onLoad={() => setPending(false)}
        onError={() => setPending(false)}
        sx={{ display: "block", width: "100%", height: "auto", opacity: pending ? 0.55 : 1, transition: "opacity 120ms" }}
      />
      <Typography component="figcaption" variant="caption" color="text.secondary" sx={{ display: "block", mt: 0.5 }} aria-live="polite">
        {pending ? labels.pending : labels.caption}
      </Typography>
    </Box>
  );
}
