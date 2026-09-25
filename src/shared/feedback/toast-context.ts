"use client";

import { createContext, useContext } from "react";
import type { FormNotice } from "./notice";

/**
 * The one door to the toasts (`ToastProvider`): `useToast()` hands back `show`, and a form or an
 * island that has something to say calls it with a notice. Separate from the provider so a
 * client component can import the hook without pulling `next-intl` — `ActionForm` reads no
 * catalogue of its own, and the provider is the one island that does (`client-messages.ts`).
 *
 * Outside a provider — the public site, a unit render — `show` is a no-op, so a form that is
 * handed a notice where no toast can be drawn does nothing rather than throwing.
 */
export type ToastApi = { show: (notice: FormNotice) => void };

const noop: ToastApi = { show: () => undefined };

export const ToastContext = createContext<ToastApi>(noop);

export function useToast(): ToastApi {
  return useContext(ToastContext);
}
