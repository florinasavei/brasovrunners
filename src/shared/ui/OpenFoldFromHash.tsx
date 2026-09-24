"use client";

import { usePathname } from "next/navigation";
import { useEffect } from "react";
import { fragmentId, openFoldsAround } from "./fold";

/**
 * Opens the backoffice fold the address's `#fragment` names (`DECISIONS.md` §NNN): a link to
 * `/admin/emails#contact-recipients` lands on that panel open, not on its closed summary.
 *
 * The one piece of the fold rule the server cannot decide — a fragment never reaches it — so it
 * is a client island with nothing to draw, rendered once by the backoffice shell. It runs on
 * arrival, on every navigation between backoffice pages (the shell stays mounted, so the
 * pathname is what re-runs it), and on `hashchange`, which a plain in-page `<a href="#…">`
 * fires. Everything else about a fold stays a `<details>` that works with JavaScript off.
 */
export default function OpenFoldFromHash() {
  const pathname = usePathname();
  useEffect(() => {
    const reveal = () => {
      const id = fragmentId(window.location.hash);
      if (!id) return;
      const target = document.getElementById(id);
      // Scrolled again only when something opened: the browser already scrolled to a target
      // it could see, and a fold that opened above it may have moved it.
      if (openFoldsAround(target) > 0) target?.scrollIntoView({ block: "start" });
    };
    reveal();
    window.addEventListener("hashchange", reveal);
    return () => window.removeEventListener("hashchange", reveal);
  }, [pathname]);
  return null;
}
