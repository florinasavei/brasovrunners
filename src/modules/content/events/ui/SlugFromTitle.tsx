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
 * Fills each language's page address from its title until the person types in the address box
 * (§350). Only a trusted `input` event hands the box over (our own writes are not trusted); a box
 * that arrives filled (a refused create, §315) is already the person's. Renders nothing.
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
