"use client";

import { usePathname } from "next/navigation";
import { useEffect } from "react";
import { fragmentId, openFoldsAround } from "./fold";

/**
 * Opens the backoffice fold the address's `#fragment` names (`DECISIONS.md` §336): a link to
 * `/admin/pages/contact#contact-recipients` — a row of «Sarcini» → «Club» (§516) — lands on that
 * panel open, not on its closed summary.
 *
 * The one piece of the fold rule the server cannot decide — a fragment never reaches it — so it
 * is a client island with nothing to draw, rendered once by the backoffice shell. It runs on
 * arrival, on every navigation between backoffice pages (the shell stays mounted, so the
 * pathname is what re-runs it), on `hashchange`, which a plain in-page `<a href="#…">` fires, and
 * on a press of an in-page link to the fragment the address already carries (§NNN) — the browser
 * fires no `hashchange` for that, so a fold the reader had closed, or a page scrolled away, stayed
 * as it was and «Invită pe email» «nu merge». It reads no query (`useSearchParams` would make the
 * public pages that render it wait for the client): a link to another address of the same page is a plain
 * `<a>`, a full load the arrival run answers. The two delayed re-runs after arrival stop at the reader's
 * first wheel, touch or key, so a reader who scrolls on is never pulled back. Everything else about a fold
 * stays a `<details>` that works with JavaScript off.
 */
export default function OpenFoldFromHash() {
  const pathname = usePathname();
  useEffect(() => {
    // `pressed`: the reader pressed a link to this fragment, so the target comes into view even if nothing needed opening.
    const reveal = (pressed: boolean) => {
      const id = fragmentId(window.location.hash);
      if (!id) return;
      const target = document.getElementById(id);
      if (!target) return;
      // Scrolled when something opened (a fold that opened above the target may have moved it), when a
      // link to it was pressed, or when it is off the screen — a load of `?eventId=…#panel`
      // can leave the page at the top on a phone (§NNN). A target already in view is left alone.
      const opened = openFoldsAround(target) > 0;
      const box = target.getBoundingClientRect();
      if (opened || pressed || box.top < 0 || box.top >= window.innerHeight) target.scrollIntoView({ block: "start" });
    };
    const onHashChange = () => reveal(false);
    const onClick = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const link = event.target instanceof Element ? event.target.closest("a[href]") : null;
      if (!link) return;
      const href = new URL(link.getAttribute("href") ?? "", window.location.href);
      if (href.hash === "") return;
      const address = (where: { pathname: string; search: string }) => where.pathname + where.search;
      if (href.hash === window.location.hash && address(href) === address(window.location)) {
        // The very address on screen: no `hashchange`, no navigation — answered at once. Any other
        // in-page link is a plain `<a>`, a full load the arrival run answers.
        window.setTimeout(() => reveal(true), 0);
      }
    };
    reveal(false);
    // Once more shortly after: a phone's page is still taking its shape (fonts, the sticky header) and
    // the browser's own scroll to the fragment may have run before it, or been undone by it (§NNN).
    const later = [window.setTimeout(() => reveal(false), 300), window.setTimeout(() => reveal(false), 1000)];
    const stopLater = () => later.forEach((timer) => window.clearTimeout(timer));
    // A reader who scrolls or touches the page within that second keeps their place: the re-runs stop.
    const reader = ["wheel", "touchstart", "keydown"] as const;
    reader.forEach((type) => window.addEventListener(type, stopLater, { once: true, passive: true }));
    window.addEventListener("hashchange", onHashChange);
    document.addEventListener("click", onClick);
    return () => {
      stopLater();
      reader.forEach((type) => window.removeEventListener(type, stopLater));
      window.removeEventListener("hashchange", onHashChange);
      document.removeEventListener("click", onClick);
    };
  }, [pathname]);
  return null;
}
