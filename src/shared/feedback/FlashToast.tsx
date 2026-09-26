"use client";

import { useEffect, useReducer } from "react";
import { FLASH_COOKIE, type NoticeKind } from "./notice";
import { flashCookiePresent } from "./public-toasts";
import ToastRegion, { type DrawnToast } from "./ToastRegion";

/**
 * One flashed toast on a public page (§427), drawn by the backoffice's own `ToastRegion` (§384).
 *
 * Mounted by `PublicFlash` only on the page a public action redirected to, and only when that
 * action left its flash — never in a layout, so every other page of the site ships none of it.
 * It receives the sentence already translated on the server: this island reads no catalogue.
 *
 * The region renders empty on the server and the first client render, and the toast appears in an
 * effect after the page painted, so a screen reader announces it (a region that arrives already
 * holding its sentence often is not) and nothing runs inside the press that led here (§371).
 * Shown once: only while the browser still holds the cookie, which it then clears — a refresh
 * finds no cookie on the server, and a page restored from the router's cache finds none here.
 */
export default function FlashToast({ kind, sentence, closeLabel }: { kind: NoticeKind; sentence: string; closeLabel: string }) {
  // A reducer that only replaces: the one toast, or none — as the provider's queue holds it.
  const [toast, setToast] = useReducer((_shown: DrawnToast | null, next: DrawnToast | null) => next, null);

  useEffect(() => {
    let present = false;
    try {
      present = flashCookiePresent(document.cookie, FLASH_COOKIE);
      if (present) document.cookie = `${FLASH_COOKIE}=; Max-Age=0; path=/`;
    } catch {
      // A browser that refuses cookies to scripts: no toast, and the page's banner says it all.
    }
    if (present) setToast({ id: 1, kind, sentence });
  }, [kind, sentence]);

  return <ToastRegion toast={toast} closeLabel={closeLabel} onDismiss={() => setToast(null)} />;
}
