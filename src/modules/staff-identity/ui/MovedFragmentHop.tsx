"use client";

import { useEffect } from "react";
import { resolveMovedFragment } from "@/i18n/moved-paths";

/**
 * The one hop the server cannot make (§NNN): an old link to a card by its `#fragment` —
 * `/admin/emails#contact-recipients`, the old «Termene» fold — arrives here through the 308 of
 * `moved-paths.ts`, fragment and all, but the card now lives on another tab of «Setări». This reads
 * the table in `MOVED_FRAGMENTS` and replaces the address with that tab, the fragment kept, so the
 * reader lands on the card, open. `replace`, not a push: the dead address is not left in the history
 * for Back to return to. Nothing to draw; with JavaScript off the reader lands on this tab, whose row
 * names the card's new one.
 */
export default function MovedFragmentHop() {
  useEffect(() => {
    const next = resolveMovedFragment(window.location.pathname, window.location.hash);
    if (next) window.location.replace(next);
  }, []);
  return null;
}
