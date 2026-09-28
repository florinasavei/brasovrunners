"use client";

import { createContext, type ReactNode, useContext } from "react";
import type { TranslateOutcome } from "../service";

/** The Server Action the buttons call (`admin/translate/actions.ts#translateFieldAction`). */
export type TranslateAction = (input: unknown) => Promise<TranslateOutcome>;

/**
 * What the backoffice layout tells the buttons (`DECISIONS.md` §464, §482). The whole context is
 * `null` when the role writes no club words. `action` null (no key) or `spent` (§497): no per-box
 * buttons, but the whole-record button stays drawn, greyed, saying why and linking `setupHref` /
 * `costsHref` — a missing button cannot be found.
 */
export type TranslateOffer = {
  action: TranslateAction | null;
  setupHref: string | null;
  spent?: boolean;
  costsHref?: string | null;
};

/**
 * Decided by the layout on the server; a courtesy only — the action re-checks (BR-REQ-060-01).
 * The action travels in context so the islands import no server session or database.
 */
const TranslateContext = createContext<TranslateOffer | null>(null);

export default function TranslateProvider({ offer, children }: { offer: TranslateOffer | null; children: ReactNode }) {
  return <TranslateContext.Provider value={offer}>{children}</TranslateContext.Provider>;
}

export function useTranslateOffer(): TranslateOffer | null {
  return useContext(TranslateContext);
}

export function useTranslateAction(): TranslateAction | null {
  return useContext(TranslateContext)?.action ?? null;
}
