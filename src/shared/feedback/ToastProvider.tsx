"use client";

import { useLocale, useTranslations } from "next-intl";
import { type ReactNode, useCallback, useEffect, useMemo, useReducer, useRef } from "react";
import { countForm } from "@/i18n/count-form";
import { EMPTY_TOAST_QUEUE, FLASH_COOKIE, type FormNotice, toastQueueReducer } from "./notice";
import { type ToastApi, ToastContext } from "./toast-context";
import ToastRegion from "./ToastRegion";

/**
 * The backoffice's toasts (`DECISIONS.md` §384; the owner: "I need more toasts and confirmation
 * dialogs in the app!"), mounted once in the admin layout.
 *
 * One at a time: a notice that arrives while another is showing waits its turn
 * (`toastQueueReducer`), so two quick saves are two sentences read one after the other rather
 * than one drawn over the other. Each stays `TOAST_AUTO_HIDE_MS`, or until its close button, and
 * a click elsewhere on the page never dismisses it — a volunteer at the desk pressing the next
 * row's button must not lose the sentence about the last one.
 *
 * `role="status"`: a polite live region, so a screen reader hears "Modificările au fost salvate."
 * after the press without being interrupted, and nothing steals the focus — the page's own state
 * (the banner, the boxes) is where the focus belongs. The region is mounted once, empty, with the
 * provider, and the toast is drawn inside it: a region inserted already holding its sentence is
 * one many screen readers never announce, while a change inside a region they already know is.
 *
 * **Where it sits.** At the bottom, above the footer's sticky bar — two 44-pixel lines on a phone
 * (`SiteFooter`) — and above the event editor's sticky save row, which stands on that bar: the
 * toast must never cover the primary button of the form that just produced it (measured at
 * 320 px by `tests/e2e/toasts-and-confirms.spec.ts`).
 *
 * **The words** come from `Feedback.toast`, the one namespace this island reads
 * (`STAFF_CLIENT_MESSAGES`): a `saved` code is the key, and a code whose sentence counts
 * something has three keys — `one`, `few`, `other` — picked by `countForm` from the notice's
 * `count`, never an ICU plural. A code with no sentence yet falls back to the generic "saved", so
 * a new action tomorrow toasts something rather than crashing the page;
 * `tests/unit/shared/feedback-catalogue.test.ts` is what insists on the sentence.
 *
 * **The flash** (`flash.ts`): the notice the last redirect left in its cookie, shown once and
 * the cookie cleared here, in the browser — so the next render reads none, and a refresh shows
 * nothing. Cleared by the island rather than the server, because a Server Component cannot
 * delete a cookie during its render and the page the redirect lands on is a render, not an action.
 *
 * **INP** (§371): nothing here runs inside a press. A toast is dispatched from an effect after
 * the action answered — for a flash, after the redirected page painted — and the Snackbar mounts
 * then, not in the press's task.
 */
export default function ToastProvider({ flash, children }: { flash: FormNotice | null; children: ReactNode }) {
  const [queue, dispatch] = useReducer(toastQueueReducer, EMPTY_TOAST_QUEUE);
  const t = useTranslations("Feedback");
  const locale = useLocale();

  const show = useCallback((notice: FormNotice) => dispatch({ type: "show", notice }), []);
  const dismiss = useCallback(() => dispatch({ type: "dismiss" }), []);
  const api = useMemo<ToastApi>(() => ({ show }), [show]);

  // Once per flash object: the layout hands the same object until the next server render, and a
  // re-render of this island for any other reason must not repeat the sentence.
  const shownFlash = useRef<FormNotice | null>(null);
  useEffect(() => {
    if (!flash || shownFlash.current === flash) return;
    shownFlash.current = flash;
    dispatch({ type: "show", notice: flash });
    try {
      document.cookie = `${FLASH_COOKIE}=; Max-Age=0; path=/`;
    } catch {
      // A browser that refuses the write shows the toast once more on refresh, which is the
      // lesser failure; the cookie expires by itself in a minute.
    }
  }, [flash]);

  const sentence = (notice: FormNotice): string => {
    const values = notice.values ?? {};
    const base = `toast.${notice.key}`;
    if (t.has(`${base}.other`)) {
      const count = Number.isFinite(Number(values.count)) ? Number(values.count) : 0;
      return t(`${base}.${countForm(count, locale)}`, { ...values, count: String(count) });
    }
    if (t.has(base)) return t(base, values);
    return t("toast.saved");
  };

  const current = queue.current;

  return (
    <ToastContext.Provider value={api}>
      {children}
      {/* The live region, always here and empty between toasts; the toast is drawn inside it. */}
      <ToastRegion
        toast={current ? { id: current.id, kind: current.kind, sentence: sentence(current) } : null}
        closeLabel={t("close")}
        onDismiss={dismiss}
      />
    </ToastContext.Provider>
  );
}
