"use client";

import { useEffect, useRef } from "react";
import { slugFromTitle } from "./slug";

/** The browser's own value setter, so React — and MUI's floating label — hear the write. */
function writeValue(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  setter?.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

/**
 * The create page's page address, filled from the title until the person writes one (§350; the
 * weekly group run is type, title, summary, date, place, the repeat tick, then "Creează și
 * publică" — nobody should have to invent `alergare-de-luni` by hand as well).
 *
 * For each language: while its address box has never been typed into, every keystroke in the
 * title rewrites the address (`slugFromTitle`). The first keystroke of the person's own in the
 * address box — a trusted `input` event, which the writes below are not — hands the box over for
 * good. A box that arrives filled (a refused create coming back, §315) is the person's already.
 * Renders nothing; the server validates the address as it always has.
 */
export default function SlugFromTitle({ locales }: { locales: readonly string[] }) {
  const anchor = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const form = anchor.current?.closest("form");
    if (!form) return;
    const cleanups = locales.map((locale) => {
      const title = form.querySelector<HTMLInputElement>(`input[name="translations.${locale}.title"]`);
      const slug = form.querySelector<HTMLInputElement>(`input[name="translations.${locale}.slug"]`);
      if (!title || !slug) return () => undefined;
      let owned = slug.value.trim() !== "";
      const onSlug = (event: Event) => {
        if (event.isTrusted) owned = true;
      };
      const onTitle = () => {
        if (!owned) writeValue(slug, slugFromTitle(title.value));
      };
      slug.addEventListener("input", onSlug);
      title.addEventListener("input", onTitle);
      return () => {
        slug.removeEventListener("input", onSlug);
        title.removeEventListener("input", onTitle);
      };
    });
    return () => cleanups.forEach((cleanup) => cleanup());
  }, [locales]);

  return <span ref={anchor} hidden />;
}
