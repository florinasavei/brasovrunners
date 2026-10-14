"use client";

import Alert from "@mui/material/Alert";
import { useEffect, useRef, useState } from "react";
import { BIB_DESIGN_FORM_PREFIX } from "@/modules/registrations/bib-design-query";

/**
 * The warning under the header's picture (§750; the owner, 2026-10-13): while a picture is chosen in
 * «Imagine în locul benzii colorate» and «Numele evenimentului» is ticked, the picture hides the
 * event's name — the band's words are not printed over a picture — and the club is told in plain words,
 * with the way out: «Bandă cu sponsori» for a sponsors' strip.
 *
 * A client island only because both inputs change under the club's hands: the picture's hidden field
 * (which `BibPictureField` fires `change` on, like the preview listens to) and the checkbox. It reads
 * the form the way the preview does and subscribes with the same two listeners on the `<form>`; the
 * server gives it the stored state, so the line is right before any script runs. Text, no element, is
 * what crosses from the Server Component.
 */
export default function BibHeaderWarning({
  message,
  initial,
  fields = { picture: `${BIB_DESIGN_FORM_PREFIX}headerImageSrc`, title: `${BIB_DESIGN_FORM_PREFIX}showEventTitle` },
  testId = "bib-header-warning",
}: {
  message: string;
  initial: boolean;
  /** The picture's field and the title's tick it reads; a volunteer badge's designer passes its own (§NNN). */
  fields?: { picture: string; title: string };
  testId?: string;
}) {
  const root = useRef<HTMLDivElement>(null);
  const [shown, setShown] = useState(initial);

  useEffect(() => {
    const form = root.current?.closest("form");
    if (!form) return;
    const read = () => {
      const data = new FormData(form);
      const picture = data.get(fields.picture);
      setShown(typeof picture === "string" && picture.trim() !== "" && data.get(fields.title) === "on");
    };
    read();
    form.addEventListener("input", read);
    form.addEventListener("change", read);
    return () => {
      form.removeEventListener("input", read);
      form.removeEventListener("change", read);
    };
  }, [fields.picture, fields.title]);

  return (
    <div ref={root} data-testid={testId} hidden={!shown}>
      <Alert severity="warning" variant="outlined" sx={{ py: 0 }}>
        {message}
      </Alert>
    </div>
  );
}
